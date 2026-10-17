import type { Http } from '../http';
import type { RequestOptions } from '../types';

export class Deliveries {
  /** @internal */
  constructor(private readonly http: Http) {}

  /**
   * Sends a finished delivery again. A delivery still being sent throws `ConflictError` (code `conflict`).
   * If the endpoint is disabled, throws `ConflictError` with code `endpoint_disabled` and nothing is sent:
   * fix the endpoint, set `status: 'active'` with `endpoints.update()`, then retry. A paused endpoint holds the retry
   * until it is resumed. A deleted endpoint throws `NotFoundError`. Requires `messages:retry`.
   */
  async retry(deliveryId: string, options?: RequestOptions): Promise<void> {
    await this.http.request({ method: 'POST', path: `/v1/deliveries/${encodeURIComponent(deliveryId)}/retry`, idempotent: false }, options);
  }
}
