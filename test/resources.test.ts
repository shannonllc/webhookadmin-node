// 全メソッドのメソッド・パス・クエリ・本文・返り。
import { describe, expect, it } from 'vitest';
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
};

describe('messages', () => {
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
    const r = await client(f.fn).messages.list({ status: 'failed', event_type: 'invoice.paid', q: 'abc', limit: 10, cursor: 'x' });
    expect(r).toEqual(page);
    const u = f.calls[0]!.url;
    expect(u.pathname).toBe('/v1/messages');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      status: 'failed',
      event_type: 'invoice.paid',
      q: 'abc',
      limit: '10',
      cursor: 'x',
    });
    expect(f.calls[0]!.body).toBeUndefined();
    expect(f.calls[0]!.headers['content-type']).toBeUndefined();
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
    expect((await wh.endpoints.update('ep_1', { status: 'paused' })).status).toBe('paused');
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
    expect(f.calls[1]!.body).toEqual({ status: 'paused' });
    expect(f.calls[3]!.body).toBeUndefined();
    expect(f.calls[4]!.body).toEqual({ event_type: 'invoice.paid' });
    expect(f.calls[5]!.body).toEqual({});
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
