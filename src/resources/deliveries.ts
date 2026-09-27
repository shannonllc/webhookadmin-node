import type { Http } from '../http';
import type { RequestOptions } from '../types';

export class Deliveries {
  /** @internal */
  constructor(private readonly http: Http) {}

  /**
   * Sends a finished delivery again. A delivery still being sent throws `ConflictError`.
   * Requires `messages:retry`.
   */
  async retry(deliveryId: string, options?: RequestOptions): Promise<void> {
    await this.http.request({ method: 'POST', path: `/v1/deliveries/${encodeURIComponent(deliveryId)}/retry`, idempotent: false }, options);
  }
}
