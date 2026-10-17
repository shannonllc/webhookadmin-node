import type { Http } from '../http';
import { PagePromise } from '../pagination';
import type {
  DestinationTestParams,
  DestinationTestResult,
  Endpoint,
  EndpointCreateParams,
  EndpointDetail,
  EndpointListParams,
  EndpointSendTestParams,
  EndpointUpdateParams,
  EndpointWithSecret,
  Page,
  PollerTokenCreated,
  PollerTokenCreateParams,
  PollerTokenList,
  RecoverParams,
  Recovery,
  RequestOptions,
  RotateSecretResponse,
  SendTestResponse,
  Transformation,
  TransformationSetParams,
  TransformationTestParams,
  TransformationTestResult,
} from '../types';

const path = (endpointId: string, rest = '') => `/v1/endpoints/${encodeURIComponent(endpointId)}${rest}`;

export class Endpoints {
  /** @internal */
  constructor(private readonly http: Http) {}

  /**
   * Creates an endpoint. The signing secret is returned only here; pass `secret` to keep an existing one. Pass `type: 'polling'` (and no `url`) for an endpoint the receiver
   * polls; then create a poller token with `createPollerToken()`. Requires `endpoints:write`.
   */
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

  /**
   * Resends every delivery to this endpoint that ended `failed`, for messages created at or after `since`,
   * as the same messages (same `webhook-id`). Runs in the background; check it with `recovery()`.
   * The endpoint must be `active`: a disabled endpoint throws `ConflictError` with code `endpoint_disabled`,
   * a paused one `ConflictError` with code `conflict`. Requires `messages:retry`.
   */
  recover(endpointId: string, params: RecoverParams, options?: RequestOptions): Promise<Recovery> {
    return this.http.request({ method: 'POST', path: path(endpointId, '/recover'), body: params, idempotent: false }, options);
  }

  /** Gets the progress of a bulk resend. Requires `logs:read`. */
  recovery(endpointId: string, recoveryId: string, options?: RequestOptions): Promise<Recovery> {
    return this.http.request(
      { method: 'GET', path: path(endpointId, `/recoveries/${encodeURIComponent(recoveryId)}`), idempotent: true },
      options,
    );
  }

  /**
   * Sends a test message to this endpoint only. Not counted in usage. A disabled endpoint throws `ConflictError`
   * with code `endpoint_disabled`. Requires `messages:send`.
   */
  sendTest(endpointId: string, params: EndpointSendTestParams = {}, options?: RequestOptions): Promise<SendTestResponse> {
    return this.http.request({ method: 'POST', path: path(endpointId, '/test'), body: params, idempotent: false }, options);
  }

  /**
   * Sends one test message to a destination other than a webhook right away and returns the result. Nothing is recorded.
   * Pass `endpoint_id` to use the saved settings and credentials, or `type` and `destination` to try settings before saving.
   * Counts toward the daily limit of test sends. Pro plan and above. Requires `endpoints:write`.
   */
  testDestination(params: DestinationTestParams, options?: RequestOptions): Promise<DestinationTestResult> {
    return this.http.request({ method: 'POST', path: '/v1/destinations/test', body: params, idempotent: false }, options);
  }

  /** Gets the endpoint's transformation. Throws `NotFoundError` when there is none. Requires `logs:read`. */
  getTransformation(endpointId: string, options?: RequestOptions): Promise<Transformation> {
    return this.http.request({ method: 'GET', path: path(endpointId, '/transformation'), idempotent: true }, options);
  }

  /**
   * Saves the endpoint's transformation, which runs right before every attempt. The signature covers the transformed body.
   * Omitted fields keep their current values (`code` is required only when there is none yet). Pro plan and above
   * (`{ enabled: false }` alone works on any plan). Requires `endpoints:write`.
   */
  setTransformation(endpointId: string, params: TransformationSetParams, options?: RequestOptions): Promise<Transformation> {
    return this.http.request({ method: 'PUT', path: path(endpointId, '/transformation'), body: params, idempotent: true }, options);
  }

  /** Removes the endpoint's transformation. Requires `endpoints:write`. */
  async deleteTransformation(endpointId: string, options?: RequestOptions): Promise<void> {
    await this.http.request({ method: 'DELETE', path: path(endpointId, '/transformation'), idempotent: true }, options);
  }

  /** Runs a transformation against a sample payload and returns the result. Nothing is sent or saved. Requires `endpoints:write`. */
  testTransformation(
    endpointId: string,
    params: TransformationTestParams = {},
    options?: RequestOptions,
  ): Promise<TransformationTestResult> {
    return this.http.request({ method: 'POST', path: path(endpointId, '/transformation/test'), body: params, idempotent: true }, options);
  }

  /** Lists the poller tokens of a polling endpoint. Requires `logs:read`. */
  listPollerTokens(endpointId: string, options?: RequestOptions): Promise<PollerTokenList> {
    return this.http.request({ method: 'GET', path: path(endpointId, '/poller-tokens'), idempotent: true }, options);
  }

  /**
   * Creates a poller token (`sk_poll_…`) for a polling endpoint. The token is returned only here; it can only read this endpoint.
   * Up to 5 per endpoint. Starter plan and above. Requires `endpoints:write`.
   */
  createPollerToken(endpointId: string, params: PollerTokenCreateParams = {}, options?: RequestOptions): Promise<PollerTokenCreated> {
    return this.http.request({ method: 'POST', path: path(endpointId, '/poller-tokens'), body: params, idempotent: false }, options);
  }

  /** Deletes a poller token. It stops working right away. Requires `endpoints:write`. */
  async deletePollerToken(endpointId: string, tokenId: string, options?: RequestOptions): Promise<void> {
    await this.http.request(
      { method: 'DELETE', path: path(endpointId, `/poller-tokens/${encodeURIComponent(tokenId)}`), idempotent: true },
      options,
    );
  }
}
