import type { Http } from '../http';
import { PagePromise } from '../pagination';
import type {
  Page,
  RequestOptions,
  Source,
  SourceCreateParams,
  SourceListParams,
  SourceRequest,
  SourceRequestListParams,
  SourceUpdateParams,
} from '../types';

const path = (sourceId: string, rest = '') => `/v1/sources/${encodeURIComponent(sourceId)}${rest}`;

export class Sources {
  /** @internal */
  constructor(private readonly http: Http) {}

  /**
   * Creates a source: a URL (`url`) that receives webhooks from another service and turns them into messages of the consumer.
   * The number of sources depends on your plan (over it, `PlanLimitError`). Requires `endpoints:write`.
   */
  create(params: SourceCreateParams, options?: RequestOptions): Promise<Source> {
    return this.http.request({ method: 'POST', path: '/v1/sources', body: params, idempotent: false }, options);
  }

  /** Lists sources, in the order they were created. Requires `logs:read`. */
  list(params: SourceListParams = {}, options?: RequestOptions): PagePromise<Source> {
    const { cursor, ...query } = params;
    return new PagePromise(
      (c) =>
        this.http.request<Page<Source>>({ method: 'GET', path: '/v1/sources', query: { ...query, cursor: c }, idempotent: true }, options),
      cursor,
    );
  }

  /** Gets a source. Requires `logs:read`. */
  get(sourceId: string, options?: RequestOptions): Promise<Source> {
    return this.http.request({ method: 'GET', path: path(sourceId), idempotent: true }, options);
  }

  /** Updates a source. Changing `provider` removes the signing secret; set it again with `setSecret()`. Requires `endpoints:write`. */
  update(sourceId: string, params: SourceUpdateParams, options?: RequestOptions): Promise<Source> {
    return this.http.request({ method: 'PATCH', path: path(sourceId), body: params, idempotent: true }, options);
  }

  /** Deletes a source and its received requests. Its URL stops working right away. Requires `endpoints:write`. */
  async delete(sourceId: string, options?: RequestOptions): Promise<void> {
    await this.http.request({ method: 'DELETE', path: path(sourceId), idempotent: true }, options);
  }

  /**
   * Sets the signing secret from the sending service. The previous one is still accepted for 24 hours.
   * `null` removes it (the previous ones too). Requires `endpoints:write`.
   */
  setSecret(sourceId: string, secret: string | null, options?: RequestOptions): Promise<Source> {
    return this.http.request({ method: 'PUT', path: path(sourceId, '/secret'), body: { secret }, idempotent: true }, options);
  }

  /**
   * Lists the webhooks the source received, newest first, within your plan's retention.
   * `status` lists only `accepted`, `duplicate`, `rejected` or `held` ones. Requires `logs:read`.
   */
  listRequests(sourceId: string, params: SourceRequestListParams = {}, options?: RequestOptions): PagePromise<SourceRequest> {
    const { cursor, ...query } = params;
    return new PagePromise(
      (c) =>
        this.http.request<Page<SourceRequest>>(
          { method: 'GET', path: path(sourceId, '/requests'), query: { ...query, cursor: c }, idempotent: true },
          options,
        ),
      cursor,
    );
  }

  /**
   * Processes a rejected request again (`reprocessable: true`) with the source's current secret and settings, such as after
   * fixing a wrong secret. Returns the request with its new status. A request that was not rejected, or whose body was not kept,
   * is `ConflictError`. Not retried on a 5xx. Requires `messages:send`.
   */
  reprocessRequest(sourceId: string, requestId: string, options?: RequestOptions): Promise<SourceRequest> {
    return this.http.request(
      { method: 'POST', path: path(sourceId, `/requests/${encodeURIComponent(requestId)}/reprocess`), idempotent: false },
      options,
    );
  }
}
