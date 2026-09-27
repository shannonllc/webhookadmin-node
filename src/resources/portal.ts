import type { Http } from '../http';
import type { PortalLink, PortalLinkParams, RequestOptions } from '../types';

export class Portal {
  /** @internal */
  constructor(private readonly http: Http) {}

  /**
   * Creates a 15-minute link to the consumer portal, where your customer manages their own endpoints.
   * Starter plan or above. Requires `endpoints:write`.
   */
  createLink(consumerId: string, params: PortalLinkParams = {}, options?: RequestOptions): Promise<PortalLink> {
    return this.http.request(
      { method: 'POST', path: `/v1/consumers/${encodeURIComponent(consumerId)}/portal`, body: params, idempotent: true },
      options,
    );
  }
}
