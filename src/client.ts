import { WebhookAdminError } from './errors';
import { type Fetch, Http } from './http';
import { Consumers } from './resources/consumers';
import { Deliveries } from './resources/deliveries';
import { Endpoints } from './resources/endpoints';
import { Messages } from './resources/messages';
import { Portal } from './resources/portal';
import { readEnv } from './runtime';

export const DEFAULT_BASE_URL = 'https://api.webhookadmin.com';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
export const API_KEY_ENV = 'WEBHOOK_ADMIN_API_KEY';

export interface ClientOptions {
  /** Default `https://api.webhookadmin.com`. */
  baseUrl?: string;
  /** Milliseconds per attempt. Default 30000. */
  timeout?: number;
  /** Retries after the first attempt. Default 2. `0` disables retries. */
  maxRetries?: number;
  /** Custom `fetch`. Default `globalThis.fetch`. */
  fetch?: Fetch;
}

/** Client for the Webhook Admin API (`/v1`). */
export class WebhookAdmin {
  readonly messages: Messages;
  readonly consumers: Consumers;
  readonly endpoints: Endpoints;
  readonly deliveries: Deliveries;
  readonly portal: Portal;
  readonly baseUrl: string;

  /**
   * @param apiKey `sk_live_…` or `sk_test_…`. Defaults to the `WEBHOOK_ADMIN_API_KEY` environment variable.
   */
  constructor(apiKey?: string, options: ClientOptions = {}) {
    const key = apiKey ?? readEnv(API_KEY_ENV);
    if (!key) {
      throw new WebhookAdminError(`Missing API key. Pass it to new WebhookAdmin('sk_…') or set ${API_KEY_ENV}.`);
    }
    const f = options.fetch ?? (globalThis as { fetch?: Fetch }).fetch;
    if (!f) throw new WebhookAdminError('fetch is not available. Use Node.js 18 or later, or pass options.fetch.');
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const http = new Http({
      apiKey: key,
      baseUrl: this.baseUrl,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      // 素の fetch を this なしで呼ぶと Workers などで Illegal invocation になる
      fetch: options.fetch ?? ((input, init) => f(input, init)),
    });
    this.messages = new Messages(http);
    this.consumers = new Consumers(http);
    this.endpoints = new Endpoints(http);
    this.deliveries = new Deliveries(http);
    this.portal = new Portal(http);
  }
}
