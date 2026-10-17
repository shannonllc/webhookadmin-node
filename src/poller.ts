// 取りに来る送信先（type: polling）を、受け取る側が読む。API キーではなく送信先ごとのトークン（sk_poll_…）で GET /v1/poller/{id} を呼ぶ。
import { type ClientOptions, createHttp } from './client';
import { WebhookAdminError } from './errors';
import type { Http } from './http';
import type { PolledMessage, PollPage, PollParams, RequestOptions } from './types';

export interface PollerOptions extends ClientOptions {
  /** The polling endpoint (`ep_…`). */
  endpointId: string;
  /** A poller token of that endpoint (`sk_poll_…`), from `endpoints.createPollerToken()` or the dashboard. Not an API key. */
  token: string;
}

/**
 * Fetches messages from a polling endpoint, as the receiver. Delivery is at least once: calling again with the returned
 * `iterator` acknowledges the previous page, and calling with an older iterator returns the same messages again.
 *
 * ```ts
 * const poller = new Poller({ endpointId: 'ep_...', token: 'sk_poll_...' });
 * for await (const page of poller.pages({ iterator: saved })) {
 *   for (const m of page.data) await handle(m.payload);
 *   saved = page.iterator; // save it to resume from here
 * }
 * ```
 */
export class Poller {
  readonly endpointId: string;
  readonly baseUrl: string;
  private readonly http: Http;

  constructor(options: PollerOptions) {
    if (!options.endpointId) throw new WebhookAdminError('Missing endpointId. Pass the ID of the polling endpoint (ep_…).');
    if (!options.token) throw new WebhookAdminError('Missing token. Pass a poller token of the endpoint (sk_poll_…).');
    this.endpointId = options.endpointId;
    this.http = createHttp(options.token, options);
    this.baseUrl = this.http.config.baseUrl;
  }

  /** Fetches one page. Retried on 429, 5xx and network errors like any other read. */
  poll(params: PollParams = {}, options?: RequestOptions): Promise<PollPage> {
    return this.http.request(
      {
        method: 'GET',
        path: `/v1/poller/${encodeURIComponent(this.endpointId)}`,
        query: {
          iterator: params.iterator,
          limit: params.limit,
          event_type: params.event_types,
          after: params.after instanceof Date ? params.after.toISOString() : params.after,
        },
        idempotent: true,
      },
      options,
    );
  }

  /**
   * Fetches pages from `params.iterator` (or the beginning of the retention) until a page with `done: true`, which is yielded too.
   * Each call acknowledges the page before it, so save `page.iterator` after processing a page to resume later.
   * The last page is acknowledged by the next call (the next time you poll with the saved iterator).
   */
  async *pages(params: PollParams = {}, options?: RequestOptions): AsyncGenerator<PollPage, void, undefined> {
    let iterator = params.iterator;
    for (;;) {
      const page = await this.poll({ ...params, iterator }, options);
      yield page;
      if (page.done) return;
      iterator = page.iterator;
    }
  }

  /** Every message of `pages()`, one by one. Use `pages()` when you need the iterator to resume later. */
  async *messages(params: PollParams = {}, options?: RequestOptions): AsyncGenerator<PolledMessage, void, undefined> {
    for await (const page of this.pages(params, options)) yield* page.data;
  }
}
