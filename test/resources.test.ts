// 全メソッドのメソッド・パス・クエリ・本文・返り。
import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../src/index';
import { client, empty, fakeFetch, json } from './helpers';

const endpoint = {
  id: 'ep_1',
  consumer_id: 'con_1',
  url: 'https://example.com/wh',
  description: '',
  event_types: null,
  fixed_ip: false,
  status: 'active',
  disabled_reason: null,
  failing_since: null,
  created_at: 1,
  retry: { count: 7, interval: 'progressive' },
  compat_signature: null,
  ordering: 'none',
  body_format: 'standard',
};

const recovery = {
  id: 'rcv_1',
  endpoint_id: 'ep_1',
  since: 1000,
  status: 'running',
  total: 3,
  queued: 0,
  created_at: 2000,
  finished_at: null,
};

describe('messages', () => {
  it('send: transformations_params is sent as is', async () => {
    const f = fakeFetch(json(202, { id: 'msg_1', deliveries: 1 }));
    await client(f.fn).messages.send({ consumer: 'c', event_type: 'e', payload: 1, transformations_params: { ch: '#a' } });
    expect(f.calls[0]!.body).toEqual({ consumer: 'c', event_type: 'e', payload: 1, transformations_params: { ch: '#a' } });
  });

  it('send: POST /v1/messages with the body and an Idempotency-Key', async () => {
    const f = fakeFetch(json(202, { id: 'msg_1', deliveries: 2 }));
    const r = await client(f.fn).messages.send(
      { consumer: 'cus_1', event_type: 'invoice.paid', payload: { a: 1 } },
      { idempotencyKey: 'order-1' },
    );
    expect(r).toEqual({ id: 'msg_1', deliveries: 2 });
    const c = f.calls[0]!;
    expect(c.method).toBe('POST');
    expect(c.url.pathname).toBe('/v1/messages');
    expect(c.body).toEqual({ consumer: 'cus_1', event_type: 'invoice.paid', payload: { a: 1 } });
    expect(c.headers['idempotency-key']).toBe('order-1');
    expect(c.headers['content-type']).toBe('application/json');
  });

  it('send: generates an Idempotency-Key when omitted', async () => {
    const f = fakeFetch(json(202, { id: 'msg_1', deliveries: 0 }));
    const wh = client(f.fn);
    await wh.messages.send({ consumer: 'c', event_type: 'e', payload: null });
    await wh.messages.send({ consumer: 'c', event_type: 'e', payload: null });
    const [a, b] = f.calls.map((c) => c.headers['idempotency-key']);
    expect(a).toMatch(/^webhookadmin-node-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b).not.toBe(a);
  });

  it('list: query parameters, and cursor', async () => {
    const page = { items: [{ id: 'msg_1' }], next_cursor: null };
    const f = fakeFetch(json(200, page));
    const r = await client(f.fn).messages.list({
      status: 'failed',
      event_type: 'invoice.paid',
      q: 'abc',
      since: 1790000000000,
      limit: 10,
      cursor: 'x',
    });
    expect(r).toEqual(page);
    const u = f.calls[0]!.url;
    expect(u.pathname).toBe('/v1/messages');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      status: 'failed',
      event_type: 'invoice.paid',
      q: 'abc',
      since: '1790000000000',
      limit: '10',
      cursor: 'x',
    });
    expect(f.calls[0]!.body).toBeUndefined();
    expect(f.calls[0]!.headers['content-type']).toBeUndefined();
  });

  it('list: empty strings are left out of the query', async () => {
    const f = fakeFetch(json(200, { items: [], next_cursor: null }));
    await client(f.fn).messages.list({ status: 'failed', q: '' });
    expect(Object.fromEntries(f.calls[0]!.url.searchParams)).toEqual({ status: 'failed' });
  });

  it('list: no parameters', async () => {
    const f = fakeFetch(json(200, { items: [], next_cursor: null }));
    await client(f.fn).messages.list();
    expect(f.calls[0]!.url.search).toBe('');
  });

  it('get: GET /v1/messages/:id (encoded)', async () => {
    const f = fakeFetch(json(200, { id: 'msg_1', deliveries: [] }));
    const r = await client(f.fn).messages.get('msg_1/x');
    expect(r.id).toBe('msg_1');
    expect(f.calls[0]!.url.pathname).toBe('/v1/messages/msg_1%2Fx');
  });
});

describe('consumers', () => {
  it('create', async () => {
    const f = fakeFetch(json(201, { id: 'con_1', external_id: 'cus_1', name: 'A', created_at: 1, endpoint_count: 0 }));
    const r = await client(f.fn).consumers.create({ external_id: 'cus_1', name: 'A' });
    expect(r.id).toBe('con_1');
    expect(f.calls[0]).toMatchObject({ method: 'POST', body: { external_id: 'cus_1', name: 'A' } });
    expect(f.calls[0]!.url.pathname).toBe('/v1/consumers');
  });

  it('list', async () => {
    const f = fakeFetch(json(200, { items: [], next_cursor: null }));
    await client(f.fn).consumers.list({ limit: 5 });
    await client(f.fn).consumers.list();
    expect(f.calls[0]!.url.search).toBe('?limit=5');
    expect(f.calls[1]!.url.search).toBe('');
  });
});

describe('endpoints', () => {
  it('create', async () => {
    const f = fakeFetch(json(201, { ...endpoint, secret: 'whsec_x' }));
    const r = await client(f.fn).endpoints.create({ consumer_id: 'con_1', url: 'https://example.com/wh', event_types: ['a.b'] });
    expect(r.secret).toBe('whsec_x');
    expect(f.calls[0]).toMatchObject({
      method: 'POST',
      body: { consumer_id: 'con_1', url: 'https://example.com/wh', event_types: ['a.b'] },
    });
  });

  it('list: one page, next_cursor is null', async () => {
    const f = fakeFetch(json(200, { items: [endpoint] }));
    const r = await client(f.fn).endpoints.list({ consumer_id: 'con_1' });
    expect(r).toEqual({ items: [endpoint], next_cursor: null });
    expect(f.calls[0]!.url.search).toBe('?consumer_id=con_1');
    const all = [];
    for await (const e of client(f.fn).endpoints.list()) all.push(e);
    expect(all).toEqual([endpoint]);
    expect(f.calls[1]!.url.search).toBe('');
  });

  it('list: follows next_cursor if the API ever pages', async () => {
    const f = fakeFetch(json(200, { items: [endpoint], next_cursor: 'n' }), json(200, { items: [endpoint] }));
    const all = [];
    for await (const e of client(f.fn).endpoints.list()) all.push(e);
    expect(all).toHaveLength(2);
    expect(f.calls[1]!.url.search).toBe('?cursor=n');
  });

  it('get / update / delete / rotateSecret / sendTest', async () => {
    const f = fakeFetch(
      json(200, { ...endpoint, recent: [], retrying_count: 0 }),
      json(200, { ...endpoint, status: 'paused' }),
      empty(204),
      json(200, { secret: 'whsec_new' }),
      json(202, { message_id: 'msg_t' }),
      json(202, { message_id: 'msg_u' }),
    );
    const wh = client(f.fn);
    expect((await wh.endpoints.get('ep_1')).retrying_count).toBe(0);
    expect((await wh.endpoints.update('ep_1', { status: 'paused', fixed_ip: false })).status).toBe('paused');
    expect(await wh.endpoints.delete('ep_1')).toBeUndefined();
    expect(await wh.endpoints.rotateSecret('ep_1')).toEqual({ secret: 'whsec_new' });
    expect(await wh.endpoints.sendTest('ep_1', { event_type: 'invoice.paid' })).toEqual({ message_id: 'msg_t' });
    expect(await wh.endpoints.sendTest('ep_1')).toEqual({ message_id: 'msg_u' });
    expect(f.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /v1/endpoints/ep_1',
      'PATCH /v1/endpoints/ep_1',
      'DELETE /v1/endpoints/ep_1',
      'POST /v1/endpoints/ep_1/rotate-secret',
      'POST /v1/endpoints/ep_1/test',
      'POST /v1/endpoints/ep_1/test',
    ]);
    expect(f.calls[1]!.body).toEqual({ status: 'paused', fixed_ip: false });
    expect(f.calls[3]!.body).toBeUndefined();
    expect(f.calls[4]!.body).toEqual({ event_type: 'invoice.paid' });
    expect(f.calls[5]!.body).toEqual({});
  });

  it('create / update with retry and compat_signature', async () => {
    const compat = { header: 'x-hub-signature-256', content: 'body', encoding: 'hex', prefix: 'sha256=' } as const;
    const f = fakeFetch(
      json(201, { ...endpoint, retry: { count: 3, interval: '5m' }, compat_signature: compat, secret: 'whsec_x' }),
      json(200, endpoint),
    );
    const wh = client(f.fn);
    const r = await wh.endpoints.create({
      consumer_id: 'con_1',
      url: 'https://example.com/wh',
      retry: { count: 3, interval: '5m' },
      compat_signature: compat,
    });
    expect(r.retry).toEqual({ count: 3, interval: '5m' });
    expect(r.compat_signature).toEqual(compat);
    expect((await wh.endpoints.update('ep_1', { retry: null, compat_signature: null })).retry).toEqual({
      count: 7,
      interval: 'progressive',
    });
    expect(f.calls[0]!.body).toMatchObject({ retry: { count: 3, interval: '5m' }, compat_signature: compat });
    expect(f.calls[1]!.body).toEqual({ retry: null, compat_signature: null });
  });

  it('create / update with ordering', async () => {
    const f = fakeFetch(json(201, { ...endpoint, ordering: 'fifo', secret: 'whsec_x' }), json(200, endpoint));
    const wh = client(f.fn);
    expect((await wh.endpoints.create({ consumer_id: 'con_1', url: 'https://example.com/wh', ordering: 'fifo' })).ordering).toBe('fifo');
    expect((await wh.endpoints.update('ep_1', { ordering: 'none' })).ordering).toBe('none');
    expect(f.calls[0]!.body).toMatchObject({ ordering: 'fifo' });
    expect(f.calls[1]!.body).toEqual({ ordering: 'none' });
  });

  it('create with an imported secret and body_format / update body_format', async () => {
    const f = fakeFetch(
      json(201, { ...endpoint, body_format: 'raw', secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw' }),
      json(200, endpoint),
    );
    const wh = client(f.fn);
    const created = await wh.endpoints.create({
      consumer_id: 'con_1',
      url: 'https://example.com/wh',
      secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
      body_format: 'raw',
    });
    expect(created.secret).toBe('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw');
    expect(created.body_format).toBe('raw');
    expect((await wh.endpoints.update('ep_1', { body_format: 'standard' })).body_format).toBe('standard');
    expect(f.calls[0]!.body).toMatchObject({ secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', body_format: 'raw' });
    expect(f.calls[1]!.body).toEqual({ body_format: 'standard' });
  });

  it('recover / recovery', async () => {
    const f = fakeFetch(json(202, recovery), json(200, { ...recovery, status: 'done', queued: 3, finished_at: 3000 }));
    const wh = client(f.fn);
    expect(await wh.endpoints.recover('ep_1', { since: 1000 })).toEqual(recovery);
    expect((await wh.endpoints.recovery('ep_1', 'rcv/1')).status).toBe('done');
    expect(f.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'POST /v1/endpoints/ep_1/recover',
      'GET /v1/endpoints/ep_1/recoveries/rcv%2F1',
    ]);
    expect(f.calls[0]!.body).toEqual({ since: 1000 });
    expect(f.calls[1]!.body).toBeUndefined();
  });

  it('transformation: get / set / delete / test', async () => {
    const tf = { endpoint_id: 'ep_1', code: 'function handler(w) { return w }', updated_at: 1000 };
    const result = { result: 'cancel', logs: [] };
    const f = fakeFetch(json(200, tf), json(200, tf), empty(204), json(200, result), json(200, result));
    const wh = client(f.fn);
    expect(await wh.endpoints.getTransformation('ep_1')).toEqual(tf);
    expect(await wh.endpoints.setTransformation('ep_1', { code: tf.code })).toEqual(tf);
    await wh.endpoints.deleteTransformation('ep_1');
    expect(await wh.endpoints.testTransformation('ep_1', { payload: { n: 1 }, event_type: 'a.b' })).toEqual(result);
    expect((await wh.endpoints.testTransformation('ep_1')).result).toBe('cancel');
    expect(f.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /v1/endpoints/ep_1/transformation',
      'PUT /v1/endpoints/ep_1/transformation',
      'DELETE /v1/endpoints/ep_1/transformation',
      'POST /v1/endpoints/ep_1/transformation/test',
      'POST /v1/endpoints/ep_1/transformation/test',
    ]);
    expect(f.calls[1]!.body).toEqual({ code: tf.code });
    expect(f.calls[3]!.body).toEqual({ payload: { n: 1 }, event_type: 'a.b' });
    expect(f.calls[4]!.body).toEqual({});
  });

  it('transformation: enabled / variables / transformations_params', async () => {
    const tf = { endpoint_id: 'ep_1', code: 'x', updated_at: 1, enabled: false, variables: { TOKEN: 't' } };
    const f = fakeFetch(json(200, tf), json(200, { ...tf, variables: null }), json(200, { result: 'cancel', logs: [] }));
    const wh = client(f.fn);
    expect(await wh.endpoints.setTransformation('ep_1', { enabled: false, variables: { TOKEN: 't' } })).toEqual(tf);
    expect((await wh.endpoints.setTransformation('ep_1', { variables: null })).variables).toBeNull();
    await wh.endpoints.testTransformation('ep_1', { variables: { TOKEN: 'u' }, transformations_params: { ch: '#a' } });
    expect(f.calls[0]!.body).toEqual({ enabled: false, variables: { TOKEN: 't' } });
    expect(f.calls[1]!.body).toEqual({ variables: null });
    expect(f.calls[2]!.body).toEqual({ variables: { TOKEN: 'u' }, transformations_params: { ch: '#a' } });
  });

  it('transformation: saving and testing are retried on a 5xx (no side effects beyond the saved code)', async () => {
    const tf = { endpoint_id: 'ep_1', code: 'x', updated_at: 1 };
    const f = fakeFetch(json(503, { error: 'unavailable', message: 'x' }), json(200, tf));
    expect(await client(f.fn, { maxRetries: 1 }).endpoints.setTransformation('ep_1', { code: 'x' })).toEqual(tf);
    expect(f.calls).toHaveLength(2);
  });

  it('polling endpoint: create without url, then list / create / delete poller tokens', async () => {
    const created = {
      ...endpoint,
      type: 'polling',
      url: null,
      last_polled_at: null,
      secret: 'whsec_x',
      poller_url: 'https://api.test/v1/poller/ep_1',
    };
    const token = { id: 'ptk_1', endpoint_id: 'ep_1', name: 'erp', prefix: 'sk_poll_abcd…', created_at: 1, last_used_at: null };
    const f = fakeFetch(
      json(201, created),
      json(200, { items: [token] }),
      json(201, { ...token, token: 'sk_poll_x' }),
      json(201, { ...token, name: '', token: 'sk_poll_y' }),
      empty(204),
    );
    const wh = client(f.fn);
    const ep = await wh.endpoints.create({ consumer_id: 'con_1', type: 'polling' });
    expect(ep.poller_url).toBe('https://api.test/v1/poller/ep_1');
    expect(ep.url).toBeNull();
    expect(await wh.endpoints.listPollerTokens('ep_1')).toEqual({ items: [token] });
    expect((await wh.endpoints.createPollerToken('ep_1', { name: 'erp' })).token).toBe('sk_poll_x');
    expect((await wh.endpoints.createPollerToken('ep_1')).token).toBe('sk_poll_y');
    await wh.endpoints.deletePollerToken('ep_1', 'ptk/1');
    expect(f.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'POST /v1/endpoints',
      'GET /v1/endpoints/ep_1/poller-tokens',
      'POST /v1/endpoints/ep_1/poller-tokens',
      'POST /v1/endpoints/ep_1/poller-tokens',
      'DELETE /v1/endpoints/ep_1/poller-tokens/ptk%2F1',
    ]);
    expect(f.calls[0]!.body).toEqual({ consumer_id: 'con_1', type: 'polling' });
    expect(f.calls[2]!.body).toEqual({ name: 'erp' });
    expect(f.calls[3]!.body).toEqual({});
  });

  it('poller tokens: listing and deleting are retried on a 5xx, creating is not', async () => {
    const f = fakeFetch(json(503, { error: 'unavailable', message: 'x' }), json(200, { items: [] }));
    expect(await client(f.fn, { maxRetries: 1 }).endpoints.listPollerTokens('ep_1')).toEqual({ items: [] });
    expect(f.calls).toHaveLength(2);
    const d = fakeFetch(json(503, { error: 'unavailable', message: 'x' }), empty(204));
    await client(d.fn, { maxRetries: 1 }).endpoints.deletePollerToken('ep_1', 'ptk_1');
    expect(d.calls).toHaveLength(2);
    const c = fakeFetch(json(503, { error: 'unavailable', message: 'x' }));
    await expect(client(c.fn, { maxRetries: 1 }).endpoints.createPollerToken('ep_1')).rejects.toMatchObject({ status: 503 });
    expect(c.calls).toHaveLength(1);
  });

  it('destinations: create with type and destination, update the destination, test the connection (not retried)', async () => {
    const sqs = {
      ...endpoint,
      url: 'sqs://ap-northeast-1/123456789012/orders',
      type: 'sqs',
      destination: { region: 'ap-northeast-1', account_id: '123456789012', queue_name: 'orders', credentials_hint: 'AKIA…MPLE' },
    };
    const result = { ok: true, via: 'sqs', response_status: 200, duration_ms: 12, error: null, response_head: null, ref: 'm-1' };
    const f = fakeFetch(json(201, { ...sqs, secret: 'whsec_x' }), json(200, sqs), json(200, result));
    const wh = client(f.fn);
    const created = await wh.endpoints.create({
      consumer_id: 'con_1',
      type: 'sqs',
      destination: {
        region: 'ap-northeast-1',
        account_id: '123456789012',
        queue_name: 'orders',
        credentials: { access_key_id: 'AKIAIOSFODNN7EXAMPLE', secret_access_key: 's' },
      },
    });
    expect(created.destination?.credentials_hint).toBe('AKIA…MPLE');
    expect((await wh.endpoints.update('ep_1', { destination: { region: 'us-east-1', account_id: '1', queue_name: 'q' } })).type).toBe(
      'sqs',
    );
    expect(await wh.endpoints.testDestination({ endpoint_id: 'ep_1' })).toEqual(result);
    expect(f.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'POST /v1/endpoints',
      'PATCH /v1/endpoints/ep_1',
      'POST /v1/destinations/test',
    ]);
    expect(f.calls[0]!.body).toMatchObject({ type: 'sqs', destination: { credentials: { access_key_id: 'AKIAIOSFODNN7EXAMPLE' } } });
    const g = fakeFetch(json(503, { error: 'unavailable', message: 'x' }));
    await expect(client(g.fn).endpoints.testDestination({ type: 'sqs' })).rejects.toMatchObject({ status: 503 });
    expect(g.calls).toHaveLength(1);
  });

  it('recover: not retried on a 5xx (not safe to repeat)', async () => {
    const f = fakeFetch(json(503, { error: 'unavailable', message: 'x' }));
    await expect(client(f.fn).endpoints.recover('ep_1', { since: 1 })).rejects.toMatchObject({ status: 503 });
    expect(f.calls).toHaveLength(1);
  });
});

describe('deliveries', () => {
  it('retry: POST /v1/deliveries/:id/retry, 202 without body', async () => {
    const f = fakeFetch(empty(202));
    expect(await client(f.fn).deliveries.retry('dlv_1')).toBeUndefined();
    expect(f.calls[0]).toMatchObject({ method: 'POST' });
    expect(f.calls[0]!.url.pathname).toBe('/v1/deliveries/dlv_1/retry');
  });
});

describe('portal', () => {
  it('createLink: POST /v1/consumers/:id/portal', async () => {
    const f = fakeFetch(json(201, { url: 'https://app.webhookadmin.com/portal/t', expires_at: 2 }));
    const wh = client(f.fn);
    expect(await wh.portal.createLink('con_1', { frame_origin: 'https://app.example.com', locale: 'en' })).toEqual({
      url: 'https://app.webhookadmin.com/portal/t',
      expires_at: 2,
    });
    await wh.portal.createLink('con_1');
    expect(f.calls[0]!.url.pathname).toBe('/v1/consumers/con_1/portal');
    expect(f.calls[0]!.body).toEqual({ frame_origin: 'https://app.example.com', locale: 'en' });
    expect(f.calls[1]!.body).toEqual({});
  });
});

describe('eventTypes', () => {
  const t = (name: string, description = '') => ({ name, description, archived_at: null });

  it('list: GET /v1/event-types', async () => {
    const f = fakeFetch(json(200, { items: [t('invoice.paid', '支払い')] }));
    expect(await client(f.fn).eventTypes.list()).toEqual({ items: [t('invoice.paid', '支払い')] });
    expect(f.calls[0]!.method).toBe('GET');
    expect(f.calls[0]!.url.pathname).toBe('/v1/event-types');
    expect(f.calls[0]!.body).toBeUndefined();
  });

  it('create: POST /v1/event-types with the body. 409 is ConflictError, 5xx is not retried', async () => {
    const f = fakeFetch(
      json(201, t('invoice.paid', '支払い')),
      json(409, { error: 'conflict', message: 'dup' }),
      json(500, { error: 'internal', message: 'x' }),
    );
    const wh = client(f.fn, { maxRetries: 2 });
    expect(await wh.eventTypes.create({ name: 'invoice.paid', description: '支払い' })).toEqual(t('invoice.paid', '支払い'));
    expect(f.calls[0]!.method).toBe('POST');
    expect(f.calls[0]!.url.pathname).toBe('/v1/event-types');
    expect(f.calls[0]!.body).toEqual({ name: 'invoice.paid', description: '支払い' });
    await expect(wh.eventTypes.create({ name: 'invoice.paid' })).rejects.toBeInstanceOf(ConflictError);
    await expect(wh.eventTypes.create({ name: 'x.y' })).rejects.toMatchObject({ status: 500 });
    expect(f.calls).toHaveLength(3);
  });

  it('ensure: creates only the missing ones, once each, and reports the existing ones as stored', async () => {
    const f = fakeFetch((c) => {
      if (c.method === 'GET') return json(200, { items: [t('invoice.paid', 'old')] });
      return json(201, t((c.body as { name: string }).name, (c.body as { description?: string }).description ?? ''));
    });
    const r = await client(f.fn).eventTypes.ensure([
      'invoice.paid',
      { name: 'user.created', description: '登録' },
      'user.created',
      { name: 'invoice.paid', description: 'new' },
      'order.shipped',
    ]);
    expect(r).toEqual({ created: [t('user.created', '登録'), t('order.shipped')], existing: [t('invoice.paid', 'old')] });
    expect(f.calls.map((c) => `${c.method} ${JSON.stringify(c.body ?? null)}`)).toEqual([
      'GET null',
      'POST {"name":"user.created","description":"登録"}',
      'POST {"name":"order.shipped"}',
    ]);
  });

  it('ensure: a 409 from a concurrent call counts as existing (read again after)', async () => {
    let lists = 0;
    const f = fakeFetch((c) => {
      if (c.method === 'GET') return json(200, { items: lists++ === 0 ? [] : [t('a.b', 'theirs'), t('z.z')] });
      if ((c.body as { name: string }).name === 'a.b') return json(409, { error: 'conflict', message: 'dup' });
      return json(201, t('c.d'));
    });
    const r = await client(f.fn).eventTypes.ensure(['a.b', 'c.d']);
    expect(r).toEqual({ created: [t('c.d')], existing: [t('a.b', 'theirs')] });
    expect(f.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'POST', 'GET']);
  });

  it('ensure: other errors are thrown; an empty list only reads', async () => {
    const f = fakeFetch((c) =>
      c.method === 'GET' ? json(200, { items: [] }) : json(422, { error: 'invalid', message: 'x', fields: { name: 'bad' } }),
    );
    const wh = client(f.fn);
    await expect(wh.eventTypes.ensure(['bad name'])).rejects.toBeInstanceOf(ValidationError);
    expect(await wh.eventTypes.ensure([])).toEqual({ created: [], existing: [] });
    expect(f.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'GET']);
  });
});
