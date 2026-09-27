// 再試行・打ち切り・エラーの種類・ページ送り・設定。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoff, MAX_RATE_LIMIT_WAIT_MS, rateLimitWait } from '../src/http';
import {
  ApiError,
  AuthenticationError,
  ConflictError,
  ConnectionError,
  NotFoundError,
  PagePromise,
  PermissionError,
  PlanLimitError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  VERSION,
  WebhookAdmin,
  WebhookAdminError,
} from '../src/index';
import { client, empty, fakeFetch, hang, json } from './helpers';

const send = (wh: WebhookAdmin, opts = {}) => wh.messages.send({ consumer: 'c', event_type: 'e', payload: 1 }, opts);

/** 偽の時計で p を最後まで進める（再試行の待ちを飛ばす） */
async function settle<T>(p: PromiseLike<T>): Promise<{ value?: T; error?: unknown }> {
  const out = Promise.resolve(p).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return out;
}

describe('client options', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends Authorization, Accept and User-Agent with the SDK version', async () => {
    const f = fakeFetch(json(200, { items: [], next_cursor: null }));
    await client(f.fn).consumers.list();
    expect(f.calls[0]!.headers).toMatchObject({
      authorization: 'Bearer sk_test_abc',
      accept: 'application/json',
      'user-agent': `webhookadmin-node/${VERSION}`,
    });
  });

  it('reads the API key from WEBHOOK_ADMIN_API_KEY', async () => {
    vi.stubEnv('WEBHOOK_ADMIN_API_KEY', 'sk_live_env');
    const f = fakeFetch(json(200, { items: [], next_cursor: null }));
    await new WebhookAdmin(undefined, { fetch: f.fn }).consumers.list();
    expect(f.calls[0]!.headers.authorization).toBe('Bearer sk_live_env');
  });

  it('throws without an API key', () => {
    vi.stubEnv('WEBHOOK_ADMIN_API_KEY', '');
    expect(() => new WebhookAdmin()).toThrow(WebhookAdminError);
    expect(() => new WebhookAdmin('')).toThrow(/WEBHOOK_ADMIN_API_KEY/);
  });

  it('default base URL is https://api.webhookadmin.com, trailing slashes are removed', async () => {
    const f = fakeFetch(json(200, { items: [], next_cursor: null }));
    const wh = new WebhookAdmin('sk_test_x', { fetch: f.fn });
    expect(wh.baseUrl).toBe('https://api.webhookadmin.com');
    await wh.consumers.list();
    expect(f.calls[0]!.url.href).toBe('https://api.webhookadmin.com/v1/consumers');
    expect(new WebhookAdmin('sk_test_x', { baseUrl: 'http://localhost:8787//', fetch: f.fn }).baseUrl).toBe('http://localhost:8787');
  });

  it('uses globalThis.fetch by default, called without a this binding', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', function (this: unknown) {
      seen.push(this);
      return Promise.resolve(json(200, { items: [], next_cursor: null }));
    });
    await new WebhookAdmin('sk_test_x').consumers.list();
    expect(seen).toEqual([undefined]);
  });

  it('throws when fetch is not available', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => new WebhookAdmin('sk_test_x')).toThrow(/fetch is not available/);
  });
});

describe('errors', () => {
  const cases: [number, string, new (...a: never[]) => WebhookAdminError][] = [
    [400, 'bad_json', ValidationError],
    [401, 'unauthorized', AuthenticationError],
    [402, 'plan_limit', PlanLimitError],
    [403, 'forbidden', PermissionError],
    [404, 'not_found', NotFoundError],
    [409, 'conflict', ConflictError],
    [413, 'too_large', ValidationError],
    [422, 'invalid', ValidationError],
    [418, 'teapot', ApiError],
  ];
  for (const [status, code, cls] of cases) {
    it(`${status} → ${cls.name}`, async () => {
      const f = fakeFetch(json(status, { error: code, message: `m ${status}` }, { 'cf-ray': 'ray-1' }));
      const e = (await send(client(f.fn)).catch((x) => x)) as WebhookAdminError;
      expect(e).toBeInstanceOf(cls);
      expect(e).toBeInstanceOf(WebhookAdminError);
      expect(e.name).toBe(cls.name);
      expect(e).toMatchObject({ status, code, message: `m ${status}`, requestId: 'ray-1', fields: undefined });
      expect(f.calls).toHaveLength(1);
    });
  }

  it('422 carries fields; x-request-id wins over cf-ray', async () => {
    const f = fakeFetch(
      json(422, { error: 'invalid', message: 'bad', fields: { url: 'https only' } }, { 'x-request-id': 'req_1', 'cf-ray': 'r' }),
    );
    const e = (await client(f.fn)
      .endpoints.create({ consumer_id: 'c', url: 'http://x' })
      .catch((x) => x)) as ValidationError;
    expect(e.fields).toEqual({ url: 'https only' });
    expect(e.requestId).toBe('req_1');
  });

  it('a non-JSON error body falls back to HTTP <status>', async () => {
    const f = fakeFetch(new Response('<html>bad gateway</html>', { status: 502 }), new Response('null', { status: 400 }));
    const wh = client(f.fn, { maxRetries: 0 });
    const e = (await wh.messages.get('m').catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 502, code: undefined, message: 'HTTP 502', requestId: undefined });
    const e2 = (await wh.messages.get('m').catch((x) => x)) as ValidationError;
    expect(e2).toMatchObject({ status: 400, message: 'HTTP 400' });
  });

  it('invalid JSON in a 2xx response is an ApiError and is not retried', async () => {
    const f = fakeFetch(new Response('{oops', { status: 200, headers: { 'cf-ray': 'r2' } }));
    const e = (await client(f.fn)
      .messages.get('m')
      .catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 200, requestId: 'r2' });
    expect(e.message).toMatch(/Invalid JSON/);
    expect(f.calls).toHaveLength(1);
  });

  it('errors keep the cause', async () => {
    const boom = new TypeError('fetch failed');
    const f = fakeFetch(boom);
    const e = (await client(f.fn, { maxRetries: 0 })
      .messages.get('m')
      .catch((x) => x)) as ConnectionError;
    expect(e).toBeInstanceOf(ConnectionError);
    expect(e.cause).toBe(boom);
    expect(e.message).toBe('Connection error: fetch failed');
    expect(e.status).toBeUndefined();
  });

  it('error classes can be constructed directly', () => {
    const e = new RateLimitError('slow');
    expect(e).toMatchObject({ name: 'RateLimitError', message: 'slow', status: undefined, retryAfter: undefined });
    expect(new WebhookAdminError('x').cause).toBeUndefined();
  });

  it('a non-Error rejection is still a ConnectionError', async () => {
    const f = fakeFetch(() => Promise.reject('down'));
    const e = await client(f.fn, { maxRetries: 0 })
      .messages.get('m')
      .catch((x) => x);
    expect(e).toBeInstanceOf(ConnectionError);
    expect(e.message).toBe('Connection error: down');
  });
});

describe('retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries 5xx with exponential backoff, then succeeds', async () => {
    const f = fakeFetch(json(500, { error: 'internal', message: 'x' }), json(503, {}), json(200, { id: 'msg_1' }));
    const r = await settle(client(f.fn).messages.get('msg_1'));
    expect(r.value).toEqual({ id: 'msg_1' });
    expect(f.calls).toHaveLength(3);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const f = fakeFetch(json(500, { error: 'internal', message: 'down' }));
    const r = await settle(client(f.fn, { maxRetries: 3 }).messages.get('m'));
    expect(r.error).toBeInstanceOf(ApiError);
    expect(f.calls).toHaveLength(4);
  });

  it('maxRetries per request overrides the client', async () => {
    const f = fakeFetch(json(500, {}));
    await settle(client(f.fn, { maxRetries: 5 }).messages.get('m', { maxRetries: 0 }));
    expect(f.calls).toHaveLength(1);
  });

  it('send reuses the same Idempotency-Key on every retry', async () => {
    const f = fakeFetch(new TypeError('socket hang up'), json(502, {}), json(202, { id: 'msg_1', deliveries: 1 }));
    const r = await settle(send(client(f.fn)));
    expect(r.value).toEqual({ id: 'msg_1', deliveries: 1 });
    const keys = new Set(f.calls.map((c) => c.headers['idempotency-key']));
    expect(f.calls).toHaveLength(3);
    expect(keys.size).toBe(1);
  });

  it('retries network errors for safe requests', async () => {
    const f = fakeFetch(new TypeError('ECONNRESET'), json(200, { items: [], next_cursor: null }));
    const r = await settle(client(f.fn).consumers.list());
    expect(r.value).toEqual({ items: [], next_cursor: null });
    expect(f.calls).toHaveLength(2);
  });

  it('does not retry 5xx or network errors for requests that are not safe to repeat', async () => {
    for (const reply of [json(500, {}), new TypeError('ECONNRESET')]) {
      const f = fakeFetch(reply);
      const wh = client(f.fn);
      const ops: (() => Promise<unknown>)[] = [
        () => wh.consumers.create({ external_id: 'x' }),
        () => wh.endpoints.create({ consumer_id: 'c', url: 'https://x' }),
        () => wh.endpoints.rotateSecret('ep'),
        () => wh.endpoints.sendTest('ep'),
        () => wh.deliveries.retry('d'),
      ];
      for (const op of ops) expect((await settle(op())).error).toBeInstanceOf(WebhookAdminError);
      expect(f.calls).toHaveLength(ops.length);
    }
  });

  it('does not retry 4xx', async () => {
    for (const s of [400, 401, 403, 404, 409, 422]) {
      const f = fakeFetch(json(s, { error: 'x', message: 'y' }));
      await settle(client(f.fn).messages.get('m'));
      expect(f.calls).toHaveLength(1);
    }
  });

  it('429 is retried for any request, waiting retry-after seconds', async () => {
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'slow down' }, { 'retry-after': '7' }), json(201, { id: 'con_1' }));
    const wh = client(f.fn);
    const p = wh.consumers.create({ external_id: 'x' });
    await vi.advanceTimersByTimeAsync(6_999);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ id: 'con_1' });
    expect(f.calls).toHaveLength(2);
  });

  it('429 without retry-after waits until x-ratelimit-reset', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const reset = Math.floor(Date.now() / 1000) + 12;
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'x' }, { 'x-ratelimit-reset': String(reset) }), json(200, { id: 'm' }));
    const p = client(f.fn).messages.get('m');
    await vi.advanceTimersByTimeAsync(11_999);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(f.calls).toHaveLength(2);
  });

  it('429 without either header uses backoff', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'x' }), json(200, { id: 'm' }));
    const p = client(f.fn).messages.get('m');
    await vi.advanceTimersByTimeAsync(499);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(f.calls).toHaveLength(2);
  });

  it('429 is thrown as RateLimitError with retryAfter once retries run out', async () => {
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'x' }, { 'retry-after': '1' }));
    const r = await settle(client(f.fn, { maxRetries: 1 }).messages.get('m'));
    expect(r.error).toBeInstanceOf(RateLimitError);
    expect((r.error as RateLimitError).retryAfter).toBe(1);
    expect(f.calls).toHaveLength(2);
  });

  it('429 asking to wait longer than a minute is thrown at once', async () => {
    const f = fakeFetch(json(429, { error: 'rate_limited', message: 'x' }, { 'retry-after': '3600' }));
    const r = await settle(client(f.fn).messages.get('m'));
    expect(r.error).toBeInstanceOf(RateLimitError);
    expect(f.calls).toHaveLength(1);
  });
});

describe('timeout and abort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out each attempt, retries safe requests, then throws TimeoutError', async () => {
    const f = fakeFetch(hang);
    const p = settle(client(f.fn, { timeout: 1000, maxRetries: 1 }).messages.get('m'));
    const r = await p;
    expect(r.error).toBeInstanceOf(TimeoutError);
    expect(r.error).toBeInstanceOf(ConnectionError);
    expect((r.error as Error).message).toBe('Request timed out after 1000 ms');
    expect(f.calls).toHaveLength(2);
  });

  it('timeout per request overrides the client; unsafe requests are not retried', async () => {
    const f = fakeFetch(hang);
    const r = await settle(client(f.fn, { timeout: 60_000 }).endpoints.rotateSecret('ep', { timeout: 10 }));
    expect(r.error).toBeInstanceOf(TimeoutError);
    expect(f.calls).toHaveLength(1);
  });

  it('a body that stalls also times out', async () => {
    const f = fakeFetch((call) => {
      const body = new ReadableStream({
        start(ctrl) {
          call.signal.addEventListener('abort', () => ctrl.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(body, { status: 200 });
    });
    const r = await settle(client(f.fn, { timeout: 50, maxRetries: 0 }).messages.get('m'));
    expect(r.error).toBeInstanceOf(TimeoutError);
  });

  it('an aborted signal stops the request and is not retried', async () => {
    const f = fakeFetch(hang);
    const ctrl = new AbortController();
    const p = settle(client(f.fn).messages.get('m', { signal: ctrl.signal }));
    await Promise.resolve();
    ctrl.abort();
    const r = await p;
    expect(r.error).toBeInstanceOf(ConnectionError);
    expect(r.error).not.toBeInstanceOf(TimeoutError);
    expect((r.error as Error).message).toBe('Request was aborted');
    expect(f.calls).toHaveLength(1);
  });

  it('a signal aborted before the call never waits', async () => {
    const f = fakeFetch(hang);
    const r = await settle(client(f.fn).messages.get('m', { signal: AbortSignal.abort() }));
    expect((r.error as Error).message).toBe('Request was aborted');
    expect(f.calls).toHaveLength(0);
  });

  it('aborting during the wait between retries stops retrying', async () => {
    const f = fakeFetch(json(503, {}));
    const ctrl = new AbortController();
    const p = client(f.fn)
      .messages.get('m', { signal: ctrl.signal })
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(1);
    ctrl.abort(new Error('stop'));
    const e = await p;
    expect(e).toBeInstanceOf(ConnectionError);
    expect(e.cause).toEqual(new Error('stop'));
    expect(f.calls).toHaveLength(1);
  });

  it('an error after the signal was aborted (without abort reaching fetch) is not retried', async () => {
    const ctrl = new AbortController();
    const f = fakeFetch(() => {
      ctrl.abort();
      return Promise.resolve(json(503, {}));
    });
    const r = await settle(client(f.fn).messages.get('m', { signal: ctrl.signal }));
    expect(r.error).toBeInstanceOf(ApiError);
    expect(f.calls).toHaveLength(1);
  });
});

describe('pagination', () => {
  it('await gives the first page; for await walks every page', async () => {
    const f = fakeFetch(
      json(200, { items: [{ id: 'a' }, { id: 'b' }], next_cursor: 'c1' }),
      json(200, { items: [{ id: 'c' }], next_cursor: 'c2' }),
      json(200, { items: [], next_cursor: null }),
    );
    const wh = client(f.fn);
    const list = wh.messages.list({ limit: 2 });
    expect(list).toBeInstanceOf(PagePromise);
    const ids: string[] = [];
    for await (const m of list) ids.push(m.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(f.calls.map((c) => c.url.search)).toEqual(['?limit=2', '?limit=2&cursor=c1', '?limit=2&cursor=c2']);
    // 1 ページ目はもう取ってあるので、await しても呼ばない
    expect((await list).items).toHaveLength(2);
    expect(f.calls).toHaveLength(3);
  });

  it('consumers: starts from the given cursor; errors reject the iterator', async () => {
    const f = fakeFetch(json(200, { items: [{ id: 'x' }], next_cursor: 'n' }), json(404, { error: 'not_found', message: 'gone' }));
    const it = client(f.fn, { maxRetries: 0 }).consumers.list({ cursor: 'start' });
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const c of it) got.push(c.id);
      })(),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(got).toEqual(['x']);
    expect(f.calls[0]!.url.search).toBe('?cursor=start');
  });

  it('catch and finally work like a Promise', async () => {
    const f = fakeFetch(json(404, { error: 'not_found', message: 'no' }), json(200, { items: [{ id: 'a' }], next_cursor: null }));
    const wh = client(f.fn);
    let done = 0;
    expect(await wh.messages.list().catch((e: Error) => e.name)).toBe('NotFoundError');
    const page = await wh.messages.list().finally(() => {
      done++;
    });
    expect(page.items).toEqual([{ id: 'a' }]);
    expect(done).toBe(1);
  });

  it('then forwards rejection handlers', async () => {
    const f = fakeFetch(json(401, { error: 'unauthorized', message: 'no' }));
    const r = await client(f.fn)
      .messages.list()
      .then(
        () => 'ok',
        (e: unknown) => (e as Error).name,
      );
    expect(r).toBe('AuthenticationError');
  });

  it('does not request anything until awaited or iterated', () => {
    const f = fakeFetch(json(200, { items: [], next_cursor: null }));
    client(f.fn).messages.list();
    expect(f.calls).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('backoff doubles from 500 ms up to 8 s with ±25% jitter', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => backoff(n, () => 0.5))).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
    expect(backoff(0, () => 0)).toBe(375);
    expect(backoff(0, () => 1)).toBe(625);
    expect(backoff(1)).toBeGreaterThanOrEqual(750);
  });

  it('rateLimitWait', () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(rateLimitWait(h({ 'retry-after': '2' }), 0)).toBe(2000);
    expect(rateLimitWait(h({ 'retry-after': '0.4' }), 0)).toBe(400);
    expect(rateLimitWait(h({ 'retry-after': 'Thu, 01 Jan 1970 00:00:05 GMT' }), 1000)).toBe(4000);
    expect(rateLimitWait(h({ 'retry-after': 'Thu, 01 Jan 1970 00:00:05 GMT' }), 9000)).toBe(0);
    expect(rateLimitWait(h({ 'retry-after': 'soon', 'x-ratelimit-reset': '10' }), 4000)).toBe(6000);
    expect(rateLimitWait(h({ 'retry-after': '-3' }), 0)).toBe(0);
    expect(rateLimitWait(h({ 'x-ratelimit-reset': '1' }), 5000)).toBe(0);
    expect(rateLimitWait(h({ 'x-ratelimit-reset': 'x' }), 0)).toBeUndefined();
    expect(rateLimitWait(h({ 'retry-after': ' ' }))).toBeUndefined();
    expect(rateLimitWait(h({}))).toBeUndefined();
    expect(MAX_RATE_LIMIT_WAIT_MS).toBe(60_000);
  });

  it('empty responses resolve to undefined', async () => {
    const f = fakeFetch(empty(204));
    expect(await client(f.fn).endpoints.delete('ep')).toBeUndefined();
  });
});
