import type { Http } from '../http';
import { PagePromise } from '../pagination';
import type {
  Endpoint,
  EndpointCreateParams,
  EndpointDetail,
  EndpointListParams,
  EndpointSendTestParams,
  EndpointUpdateParams,
  EndpointWithSecret,
  Page,
  RequestOptions,
  RotateSecretResponse,
  SendTestResponse,
} from '../types';

const path = (endpointId: string, rest = '') => `/v1/endpoints/${encodeURIComponent(endpointId)}${rest}`;

export class Endpoints {
  /** @internal */
  constructor(private readonly http: Http) {}

  /** Creates an endpoint. The signing secret is returned only here. Requires `endpoints:write`. */
  create(params: EndpointCreateParams, options?: RequestOptions): Promise<EndpointWithSecret> {
    return this.http.request({ method: 'POST', path: '/v1/endpoints', body: params, idempotent: false }, options);
  }

  /** Lists endpoints, optionally for one consumer. All endpoints come in one page. Requires `logs:read`. */
  list(params: EndpointListParams = {}, options?: RequestOptions): PagePromise<Endpoint> {
    return new PagePromise(async (cursor) => {
      const r = await this.http.request<{ items: Endpoint[]; next_cursor?: string | null }>(
        { method: 'GET', path: '/v1/endpoints', query: { ...params, cursor }, idempotent: true },
        options,
      );
      return { items: r.items, next_cursor: r.next_cursor ?? null } satisfies Page<Endpoint>;
    }, undefined);
  }

  /** Gets an endpoint with its latest attempts. Requires `logs:read`. */
  get(endpointId: string, options?: RequestOptions): Promise<EndpointDetail> {
    return this.http.request({ method: 'GET', path: path(endpointId), idempotent: true }, options);
  }

  /** Updates an endpoint. Set `status: 'active'` to resume a paused or disabled endpoint. Requires `endpoints:write`. */
  update(endpointId: string, params: EndpointUpdateParams, options?: RequestOptions): Promise<Endpoint> {
    return this.http.request({ method: 'PATCH', path: path(endpointId), body: params, idempotent: true }, options);
  }

  /** Deletes an endpoint. Requires `endpoints:write`. */
  async delete(endpointId: string, options?: RequestOptions): Promise<void> {
    await this.http.request({ method: 'DELETE', path: path(endpointId), idempotent: true }, options);
  }

  /** Issues a new signing secret. The previous one keeps signing for 24 hours. Requires `endpoints:write`. */
  rotateSecret(endpointId: string, options?: RequestOptions): Promise<RotateSecretResponse> {
    return this.http.request({ method: 'POST', path: path(endpointId, '/rotate-secret'), idempotent: false }, options);
  }

  /** Sends a test message to this endpoint only. Not counted in usage. Requires `messages:send`. */
  sendTest(endpointId: string, params: EndpointSendTestParams = {}, options?: RequestOptions): Promise<SendTestResponse> {
    return this.http.request({ method: 'POST', path: path(endpointId, '/test'), body: params, idempotent: false }, options);
  }
}
