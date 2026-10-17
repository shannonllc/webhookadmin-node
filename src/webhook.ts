// 受け取る側の署名の検証（Standard Webhooks）。サーバーが送るときの署名と同じ形。
//   webhook-id / webhook-timestamp（秒）/ webhook-signature: "v1,<base64>"（鍵の切り替え中は空白区切りで複数）
//   署名する内容は `${id}.${timestamp}.${body}`、鍵は whsec_ の後ろを base64 で戻したもの。
import { WebhookAdminError, WebhookVerificationError } from './errors';
import { webCrypto } from './runtime';

/** Headers as a `Headers` object or a plain object (Node's `req.headers`). Names are case-insensitive. */
export type WebhookHeaders = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

/** Raw request body. `Buffer` is a `Uint8Array`. */
export type WebhookPayload = string | Uint8Array | ArrayBuffer;

/** Body of a webhook sent by Webhook Admin. */
export interface WebhookEvent<T = unknown> {
  type: string;
  /** ISO 8601. */
  timestamp: string;
  data: T;
}

export interface WebhookOptions {
  /** Allowed clock difference in seconds, both ways. Default 300. */
  tolerance?: number;
}

const PREFIX = 'whsec_';
const enc = new TextEncoder();
const dec = new TextDecoder();

function base64Decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof headers.get === 'function') return (headers as { get(name: string): string | null }).get(name) ?? undefined;
  for (const [k, v] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function bytesOf(payload: WebhookPayload): Uint8Array {
  if (typeof payload === 'string') return enc.encode(payload);
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  throw new WebhookVerificationError(
    'Payload must be the raw request body (string, Buffer, Uint8Array or ArrayBuffer), not a parsed object',
  );
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(a.length + b.length));
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Verifies webhooks sent by Webhook Admin (Standard Webhooks). */
export class Webhook {
  private readonly key: Uint8Array<ArrayBuffer>;
  private readonly tolerance: number;
  private cryptoKey: Promise<CryptoKey> | undefined;

  /** @param secret The endpoint's signing secret (`whsec_…`). */
  constructor(secret: string, options: WebhookOptions = {}) {
    if (typeof secret !== 'string' || secret === '') throw new WebhookAdminError('Webhook secret is required');
    try {
      this.key = base64Decode(secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : secret);
    } catch (e) {
      throw new WebhookAdminError('Webhook secret is not valid base64 (expected whsec_…)', { cause: e });
    }
    this.tolerance = options.tolerance ?? 300;
  }

  private importKey(): Promise<CryptoKey> {
    this.cryptoKey ??= webCrypto().then((c) =>
      c.subtle.importKey('raw', this.key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
    );
    return this.cryptoKey;
  }

  /**
   * Verifies the signature and timestamp, then returns the parsed body.
   * Throws `WebhookVerificationError` when verification fails.
   * @param payload The raw request body, exactly as received.
   */
  async verify<T = WebhookEvent>(payload: WebhookPayload, headers: WebhookHeaders): Promise<T> {
    const id = header(headers, 'webhook-id');
    const timestamp = header(headers, 'webhook-timestamp');
    const signature = header(headers, 'webhook-signature');
    if (!id || !timestamp || !signature) throw new WebhookVerificationError('Missing required headers');

    const ts = Number(timestamp);
    if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(ts)) throw new WebhookVerificationError('Invalid webhook-timestamp header');
    const now = Math.floor(Date.now() / 1000);
    if (now - ts > this.tolerance) throw new WebhookVerificationError('Message timestamp too old');
    if (ts - now > this.tolerance) throw new WebhookVerificationError('Message timestamp too new');

    const body = bytesOf(payload);
    const signed = concat(enc.encode(`${id}.${timestamp}.`), body);
    const key = await this.importKey();
    const subtle = (await webCrypto()).subtle;
    for (const part of signature.split(' ')) {
      const [version, sig] = part.split(',');
      if (version !== 'v1' || !sig) continue;
      let expected: Uint8Array<ArrayBuffer>;
      try {
        expected = base64Decode(sig);
      } catch {
        continue;
      }
      // subtle.verify compares in constant time
      if (await subtle.verify('HMAC', key, expected, signed)) {
        try {
          return JSON.parse(dec.decode(body)) as T;
        } catch (e) {
          throw new WebhookVerificationError('Payload is not valid JSON', { cause: e });
        }
      }
    }
    throw new WebhookVerificationError('No matching signature found');
  }

  /**
   * Computes the `webhook-signature` value (`v1,<base64>`). Useful for tests.
   * @param timestamp A `Date` or Unix seconds.
   */
  async sign(msgId: string, timestamp: Date | number, payload: WebhookPayload): Promise<string> {
    const ts = timestamp instanceof Date ? Math.floor(timestamp.getTime() / 1000) : timestamp;
    const signed = concat(enc.encode(`${msgId}.${ts}.`), bytesOf(payload));
    const sig = await (await webCrypto()).subtle.sign('HMAC', await this.importKey(), signed);
    return `v1,${base64Encode(new Uint8Array(sig))}`;
  }
}
