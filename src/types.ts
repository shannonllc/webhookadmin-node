// /v1 の入力と返りの型（docs/api.md と apps/worker/src/v1.ts に合わせる）。時刻は Unix ミリ秒。

/** One page of a list. */
export interface Page<T> {
  items: T[];
  /** Pass as `cursor` to get the next page. `null` on the last page. */
  next_cursor: string | null;
}

export type MessageStatus = 'pending' | 'retrying' | 'success' | 'failed';
/** `held` means the endpoint is paused; sent when it is set back to `active`. */
export type DeliveryStatus = 'pending' | 'held' | 'retrying' | 'success' | 'failed';
export type EndpointStatus = 'active' | 'paused' | 'disabled';

export interface ConsumerRef {
  id: string;
  external_id: string;
  name: string;
}

/** A message in a list. */
export interface MessageSummary {
  id: string;
  event_type: string;
  consumer: ConsumerRef;
  /** Unix milliseconds. */
  created_at: number;
  status: MessageStatus;
  attempts: number;
  /** URL of the first endpoint, or `null` when the consumer had no endpoint. */
  endpoint_url: string | null;
}

export interface Attempt {
  id: string;
  /** Unix milliseconds. */
  at: number;
  response_status: number | null;
  /** First 1024 bytes of the response body. */
  response_head: string | null;
  duration_ms: number;
  error: string | null;
  via: 'direct' | 'relay';
  /** Static IP used when sent through the relay. `null` for direct sends. */
  source_ip: string | null;
}

export interface Delivery {
  id: string;
  endpoint_id: string;
  url: string;
  status: DeliveryStatus;
  attempt_count: number;
  /** Unix milliseconds, or `null` when no retry is scheduled. */
  next_attempt_at: number | null;
  attempts: Attempt[];
}

export interface Message {
  id: string;
  event_type: string;
  consumer: ConsumerRef;
  created_at: number;
  status: MessageStatus;
  idempotency_key: string | null;
  /** The payload as sent. `null` if it is no longer stored. */
  payload: unknown;
  deliveries: Delivery[];
}

export interface SendMessageParams {
  /** Your customer's ID (`external_id`). A consumer is created if it does not exist. */
  consumer: string;
  /** Event type, such as `invoice.paid`. */
  event_type: string;
  /** Any JSON value, up to 1 MB. Delivered as `data`. */
  payload: unknown;
}

export interface SendMessageResponse {
  id: string;
  /** Number of endpoints the message is delivered to. */
  deliveries: number;
}

export interface MessageListParams {
  status?: MessageStatus;
  event_type?: string;
  /** Matches the message ID, event type, consumer external_id, or payload text (3+ characters). */
  q?: string;
  /** 1 to 100. Default 50. */
  limit?: number;
  cursor?: string;
}

export interface Consumer {
  id: string;
  external_id: string;
  name: string;
  created_at: number;
  endpoint_count: number;
}

export interface ConsumerCreateParams {
  external_id: string;
  name?: string;
}

export interface ConsumerListParams {
  /** 1 to 100. Default 50. */
  limit?: number;
  cursor?: string;
}

export interface Endpoint {
  id: string;
  consumer_id: string;
  url: string;
  description: string;
  /** Event types sent to this endpoint. `null` means all. */
  event_types: string[] | null;
  /** Sent through the static-IP relay. */
  fixed_ip: boolean;
  status: EndpointStatus;
  disabled_reason: string | null;
  /** Unix milliseconds since failures started, or `null`. */
  failing_since: number | null;
  created_at: number;
}

export interface EndpointWithSecret extends Endpoint {
  /** Signing secret (`whsec_…`). Returned only when the endpoint is created. */
  secret: string;
}

export interface EndpointDetail extends Endpoint {
  /** Latest attempts to this endpoint this month (up to 20). */
  recent: Attempt[];
  /** Deliveries waiting for a retry. */
  retrying_count: number;
}

export interface EndpointCreateParams {
  consumer_id: string;
  /** https (port 443 or 8443). */
  url: string;
  /** Omit or `null` to receive all event types. */
  event_types?: string[] | null;
  fixed_ip?: boolean;
  description?: string;
}

export interface EndpointUpdateParams {
  url?: string;
  event_types?: string[] | null;
  /** `active` also re-enables a disabled endpoint and sends messages held while paused. */
  status?: 'active' | 'paused';
  description?: string;
}

export interface EndpointListParams {
  consumer_id?: string;
}

export interface EndpointSendTestParams {
  /** Default `webhook.test`. */
  event_type?: string;
}

export interface RotateSecretResponse {
  /** New signing secret. The previous one keeps signing for 24 hours. */
  secret: string;
}

export interface SendTestResponse {
  message_id: string;
}

export interface PortalLinkParams {
  /** Origin of the page that embeds the portal in an iframe, such as `https://app.example.com`. */
  frame_origin?: string;
  locale?: 'ja' | 'en';
}

export interface PortalLink {
  /** One-time URL of the consumer portal. */
  url: string;
  /** Unix milliseconds. The link is valid for 15 minutes. */
  expires_at: number;
}

/** Per-request options. */
export interface RequestOptions {
  /** Milliseconds. Overrides the client's `timeout`. */
  timeout?: number;
  /** Overrides the client's `maxRetries`. */
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface SendMessageOptions extends RequestOptions {
  /**
   * 1 to 256 characters. The same key returns the same message for 24 hours.
   * Generated when omitted, and reused across retries.
   */
  idempotencyKey?: string;
}
