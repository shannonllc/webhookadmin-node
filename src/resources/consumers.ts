import type { Http } from '../http';
import { PagePromise } from '../pagination';
import type { Consumer, ConsumerCreateParams, ConsumerListParams, Page, RequestOptions } from '../types';

export class Consumers {
  /** @internal */
  constructor(private readonly http: Http) {}

  /** Creates a consumer. A duplicate `external_id` throws `ConflictError`. Requires `consumers:write`. */
  create(params: ConsumerCreateParams, options?: RequestOptions): Promise<Consumer> {
    return this.http.request({ method: 'POST', path: '/v1/consumers', body: params, idempotent: false }, options);
  }

  /**
   * Deletes a consumer with its endpoints (signing secrets, transformations, poller tokens) and the sources that deliver to it.
   * Portal links stop working and deliveries not yet sent are not sent. A missing consumer throws `NotFoundError`. Requires `consumers:write`.
   */
  async delete(consumerId: string, options?: RequestOptions): Promise<void> {
    await this.http.request({ method: 'DELETE', path: `/v1/consumers/${encodeURIComponent(consumerId)}`, idempotent: true }, options);
  }

  /** Lists consumers. Requires `logs:read`. */
  list(params: ConsumerListParams = {}, options?: RequestOptions): PagePromise<Consumer> {
    const { cursor, ...query } = params;
    return new PagePromise(
      (c) =>
        this.http.request<Page<Consumer>>(
          { method: 'GET', path: '/v1/consumers', query: { ...query, cursor: c }, idempotent: true },
          options,
        ),
      cursor,
    );
  }
}
