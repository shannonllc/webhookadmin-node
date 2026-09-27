// 受け取る側の検証。Standard Webhooks の公式ライブラリ（standardwebhooks）と同じ入力で結果が一致することを確かめる。
import { Webhook as Official } from 'standardwebhooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Webhook, WebhookAdminError, WebhookVerificationError } from '../src/index';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const body = JSON.stringify({ type: 'invoice.paid', timestamp: '2026-09-27T00:00:00.000Z', data: { id: 1, name: '請求書' } });

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/** 公式ライブラリで署名した見出し */
function officialHeaders(secret: string, id: string, payload: string, at = new Date()) {
  return {
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(at.getTime() / 1000)),
    'webhook-signature': new Official(secret).sign(id, at, payload),
  };
}

/** 公式ライブラリの verify の結果（成功は解析した本文、失敗は null） */
function officialVerify(secret: string, payload: string, headers: Record<string, string>): unknown {
  try {
    return new Official(secret).verify(payload, headers);
  } catch {
    return null;
  }
}

async function ours(secret: string, payload: string, headers: Record<string, string>): Promise<unknown> {
  try {
    return await new Webhook(secret).verify(payload, headers);
  } catch (e) {
    if (!(e instanceof WebhookVerificationError)) throw e;
    return null;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Webhook.verify', () => {
  it('accepts what the official library signs, and returns the parsed body', async () => {
    const h = officialHeaders(SECRET, 'msg_1', body);
    expect(await new Webhook(SECRET).verify(body, h)).toEqual(JSON.parse(body));
  });

  it('the official library accepts what Webhook.sign produces', async () => {
    const at = new Date();
    const sig = await new Webhook(SECRET).sign('msg_2', at, body);
    const h = { 'webhook-id': 'msg_2', 'webhook-timestamp': String(nowSec()), 'webhook-signature': sig };
    expect(new Official(SECRET).verify(body, h)).toEqual(JSON.parse(body));
    expect(sig).toBe(new Official(SECRET).sign('msg_2', at, body));
    expect(await new Webhook(SECRET).sign('msg_2', nowSec(), body)).toBe(sig);
  });

  it('agrees with the official library on the same inputs', async () => {
    const other = 'whsec_dGhpcyBpcyBhbm90aGVyIHNlY3JldCBrZXk=';
    const good = officialHeaders(SECRET, 'msg_3', body);
    const old = officialHeaders(SECRET, 'msg_3', body, new Date(Date.now() - 301_000));
    const future = officialHeaders(SECRET, 'msg_3', body, new Date(Date.now() + 301_000));
    const edge = officialHeaders(SECRET, 'msg_3', body, new Date(Date.now() - 250_000));
    const otherSig = officialHeaders(other, 'msg_3', body)['webhook-signature'];
    const cases: [string, string, Record<string, string>][] = [
      ['valid', body, good],
      ['changed body', body.replace('1', '2'), good],
      ['changed id', body, { ...good, 'webhook-id': 'msg_4' }],
      ['changed timestamp', body, { ...good, 'webhook-timestamp': String(Number(good['webhook-timestamp']) + 1) }],
      ['too old', body, old],
      ['too new', body, future],
      ['inside tolerance', body, edge],
      ['wrong key', body, { ...good, 'webhook-signature': otherSig }],
      ['rotation: old first', body, { ...good, 'webhook-signature': `${otherSig} ${good['webhook-signature']}` }],
      ['rotation: new first', body, { ...good, 'webhook-signature': `${good['webhook-signature']} ${otherSig}` }],
      ['v2 only', body, { ...good, 'webhook-signature': good['webhook-signature'].replace('v1,', 'v2,') }],
      ['empty signature', body, { ...good, 'webhook-signature': 'v1,' }],
      ['garbage', body, { ...good, 'webhook-signature': 'v1,@@@ nonsense v1' }],
      ['missing id', body, { 'webhook-timestamp': good['webhook-timestamp'], 'webhook-signature': good['webhook-signature'] }],
      ['non-numeric timestamp', body, { ...good, 'webhook-timestamp': 'abc' }],
    ];
    for (const [name, payload, headers] of cases) {
      expect([name, await ours(SECRET, payload, headers)]).toEqual([name, officialVerify(SECRET, payload, headers)]);
    }
  });

  it('agrees with the official library on secrets without the whsec_ prefix', async () => {
    const raw = SECRET.slice('whsec_'.length);
    const h = officialHeaders(raw, 'msg_5', body);
    expect(await ours(raw, body, h)).toEqual(officialVerify(raw, body, h));
    expect(await ours(SECRET, body, h)).toEqual(JSON.parse(body));
  });

  it('accepts Buffer, Uint8Array, ArrayBuffer and Headers', async () => {
    const h = officialHeaders(SECRET, 'msg_6', body);
    const wh = new Webhook(SECRET);
    const bytes = new TextEncoder().encode(body);
    expect(await wh.verify(Buffer.from(body), h)).toEqual(JSON.parse(body));
    expect(await wh.verify(bytes, h)).toEqual(JSON.parse(body));
    expect(await wh.verify(bytes.slice().buffer, h)).toEqual(JSON.parse(body));
    expect(await wh.verify(body, new Headers(h))).toEqual(JSON.parse(body));
  });

  it('header names are case-insensitive; array values use the first', async () => {
    const h = officialHeaders(SECRET, 'msg_7', body);
    const upper = {
      'Webhook-Id': h['webhook-id'],
      'WEBHOOK-TIMESTAMP': [h['webhook-timestamp']],
      'webhook-signature': h['webhook-signature'],
    };
    expect(await new Webhook(SECRET).verify(body, upper)).toEqual(JSON.parse(body));
  });

  it('error messages', async () => {
    const wh = new Webhook(SECRET);
    const h = officialHeaders(SECRET, 'msg_8', body);
    const msg = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: Error) => `${e.name}: ${e.message}`,
      );
    expect(await msg(wh.verify(body, {}))).toBe('WebhookVerificationError: Missing required headers');
    expect(await msg(wh.verify(body, new Headers()))).toBe('WebhookVerificationError: Missing required headers');
    expect(await msg(wh.verify(body, { ...h, 'webhook-timestamp': '1e9' }))).toBe(
      'WebhookVerificationError: Invalid webhook-timestamp header',
    );
    expect(await msg(wh.verify(body, { ...h, 'webhook-timestamp': '99999999999999999999' }))).toMatch(/Invalid webhook-timestamp/);
    expect(await msg(wh.verify(body, { ...h, 'webhook-timestamp': String(nowSec() - 400) }))).toBe(
      'WebhookVerificationError: Message timestamp too old',
    );
    expect(await msg(wh.verify(body, { ...h, 'webhook-timestamp': String(nowSec() + 400) }))).toBe(
      'WebhookVerificationError: Message timestamp too new',
    );
    expect(await msg(wh.verify(`${body} `, h))).toBe('WebhookVerificationError: No matching signature found');
    expect(await msg(wh.verify(JSON.parse(body), h))).toMatch(/raw request body/);
  });

  it('a signed body that is not JSON', async () => {
    const h = officialHeaders(SECRET, 'msg_9', 'not json');
    const e = (await new Webhook(SECRET).verify('not json', h).catch((x) => x)) as WebhookVerificationError;
    expect(e).toBeInstanceOf(WebhookVerificationError);
    expect(e.message).toBe('Payload is not valid JSON');
    expect(e.cause).toBeInstanceOf(SyntaxError);
  });

  it('tolerance defaults to 5 minutes and is configurable', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T00:00:00Z'));
    const h = officialHeaders(SECRET, 'msg_10', body);
    vi.setSystemTime(new Date('2026-09-27T00:05:00Z'));
    expect(await ours(SECRET, body, h)).not.toBeNull();
    vi.setSystemTime(new Date('2026-09-27T00:05:01Z'));
    expect(await ours(SECRET, body, h)).toBeNull();
    expect(await new Webhook(SECRET, { tolerance: 600 }).verify(body, h)).toEqual(JSON.parse(body));
    await expect(new Webhook(SECRET, { tolerance: 0 }).verify(body, h)).rejects.toThrow('too old');
  });

  it('checks the secret', () => {
    expect(() => new Webhook('')).toThrow(WebhookAdminError);
    expect(() => new Webhook(undefined as unknown as string)).toThrow('Webhook secret is required');
    expect(() => new Webhook('whsec_***')).toThrow(/not valid base64/);
  });
});
