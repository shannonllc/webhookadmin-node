// 取りに来る送信先の読み手（Poller）: トークンで GET /v1/poller/{id}、iterator を渡して続きを読む、done で止まる。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, Poller, type PollerOptions, VERSION, WebhookAdminError } from '../src/index';
import { fakeFetch, json } from './helpers';

const msg = (n: number) => ({
  id: `msg_${n}`,
  event_type: 'invoice.paid',
  timestamp: '2026-09-29T00:00:00.000Z',
  payload: { type: 'invoice.paid', timestamp: '2026-09-29T00:00:00.000Z', data: { n } },
  headers: { 'webhook-id': `msg_${n}`, 'webhook-timestamp': '1790000000', 'webhook-signature': 'v1,x' },
});

function poller(f: ReturnType<typeof fakeFetch>['fn'], options: Partial<PollerOptions> = {}) {
  return new Poller({ endpointId: 'ep_1', token: 'sk_poll_abc', baseUrl: 'https://api.test/', fetch: f, ...options });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Poller', () => {
  it('poll: sends the token, the iterator and the limit', async () => {
    const page = { data: [msg(1)], iterator: 'it_1', done: false };
    const f = fakeFetch(json(200, page));
    const p = poller(f.fn);
    expect(p.baseUrl).toBe('https://api.test');
    expect(p.endpointId).toBe('ep_1');
    expect(await p.poll({ iterator: 'it_0', limit: 10 })).toEqual(page);
    await p.poll();
    const [first, second] = f.calls;
    expect(first!.method).toBe('GET');
    expect(first!.url.pathname).toBe('/v1/poller/ep_1');
    expect(Object.fromEntries(first!.url.searchParams)).toEqual({ iterator: 'it_0', limit: '10' });
    expect(first!.headers.authorization).toBe('Bearer sk_poll_abc');
    expect(first!.headers['user-agent']).toBe(`webhookadmin-node/${VERSION}`);
    expect(second!.url.search).toBe('');
  });

  it('poll: event_types as repeated event_type, and after as ISO 8601', async () => {
    const f = fakeFetch(json(200, { data: [], iterator: 'i', done: true }), json(200, { data: [], iterator: 'i', done: true }));
    const p = poller(f.fn);
    await p.poll({ event_types: ['invoice.paid', 'invoice.failed'], after: new Date(Date.UTC(2026, 8, 29)) });
    await p.poll({ after: '2026-09-29T09:00:00+09:00', event_types: [] });
    expect(f.calls[0]!.url.searchParams.getAll('event_type')).toEqual(['invoice.paid', 'invoice.failed']);
    expect(f.calls[0]!.url.searchParams.get('after')).toBe('2026-09-29T00:00:00.000Z');
    expect(f.calls[1]!.url.search).toBe('?after=2026-09-29T09%3A00%3A00%2B09%3A00');
  });

  it('pages: keeps the filters on every page', async () => {
    const f = fakeFetch(
      json(200, { data: [msg(1)], iterator: 'it_1', done: false }),
      json(200, { data: [], iterator: 'it_1', done: true }),
    );
    for await (const _ of poller(f.fn).pages({ event_types: ['a.b'] })) {
    }
    expect(f.calls.map((c) => c.url.search)).toEqual(['?event_type=a.b', '?iterator=it_1&event_type=a.b']);
  });

  it('pages: follows the iterator and stops after the page with done: true', async () => {
    const f = fakeFetch(
      json(200, { data: [msg(1), msg(2)], iterator: 'it_1', done: false }),
      json(200, { data: [msg(3)], iterator: 'it_2', done: true }),
    );
    const seen: string[] = [];
    for await (const page of poller(f.fn).pages({ iterator: 'it_0', limit: 2 })) seen.push(page.iterator);
    expect(seen).toEqual(['it_1', 'it_2']);
    expect(f.calls.map((c) => c.url.search)).toEqual(['?iterator=it_0&limit=2', '?iterator=it_1&limit=2']);
  });

  it('messages: flattens the pages', async () => {
    const f = fakeFetch(
      json(200, { data: [msg(1)], iterator: 'it_1', done: false }),
      json(200, { data: [], iterator: 'it_1', done: false }),
      json(200, { data: [msg(2)], iterator: 'it_2', done: true }),
    );
    const ids: string[] = [];
    for await (const m of poller(f.fn).messages()) ids.push(m.id);
    expect(ids).toEqual(['msg_1', 'msg_2']);
    expect(f.calls[0]!.url.search).toBe('');
  });

  it('pages: with no argument starts from the beginning and stops at once when done', async () => {
    const f = fakeFetch(json(200, { data: [], iterator: 'it_0', done: true }));
    const pages = [];
    for await (const page of poller(f.fn).pages()) pages.push(page);
    expect(pages).toHaveLength(1);
    expect(f.calls).toHaveLength(1);
  });

  it('retries 5xx like other reads and raises the usual errors', async () => {
    const f = fakeFetch(json(503, { error: 'unavailable', message: 'x' }), json(200, { data: [], iterator: 'i', done: true }));
    expect((await poller(f.fn, { maxRetries: 1 }).poll({}, { maxRetries: 1 })).done).toBe(true);
    expect(f.calls).toHaveLength(2);
    const bad = fakeFetch(json(401, { error: 'unauthorized', message: 'bad token' }));
    await expect(poller(bad.fn).poll()).rejects.toBeInstanceOf(AuthenticationError);
    const it = poller(bad.fn).messages();
    await expect(it.next()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('requires the endpoint ID and the token', () => {
    const f = fakeFetch(json(200, {}));
    expect(() => poller(f.fn, { endpointId: '' })).toThrow(/Missing endpointId/);
    expect(() => poller(f.fn, { token: '' })).toThrow(WebhookAdminError);
  });

  it('uses globalThis.fetch and the default base URL when not given', async () => {
    const f = fakeFetch(json(200, { data: [], iterator: 'i', done: true }));
    vi.stubGlobal('fetch', f.fn);
    const p = new Poller({ endpointId: 'ep_1', token: 'sk_poll_abc' });
    expect(p.baseUrl).toBe('https://api.webhookadmin.com');
    await p.poll();
    expect(f.calls[0]!.url.origin).toBe('https://api.webhookadmin.com');
  });
});
