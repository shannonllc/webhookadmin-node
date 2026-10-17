// /v1 の入力と返りの型（API の仕様 https://webhookadmin.com/docs/api/ に合わせる）。時刻は Unix ミリ秒。
import type { WebhookEvent } from './webhook';

/** One page of a list. */
export interface Page<T> {
  items: T[];
  /** Pass as `cursor` to get the next page. `null` on the last page. */
  next_cursor: string | null;
}

/**
 * `cancelled`: every delivery of the message was cancelled by a transformation.
 * `no_endpoint`: the consumer had no endpoint for the message when it was accepted. The message is stored but not sent
 * (not even if an endpoint is added later) and is not counted toward the monthly quota.
 */
export type MessageStatus = 'pending' | 'retrying' | 'success' | 'failed' | 'cancelled' | 'no_endpoint';
/**
 * `held` means the endpoint is paused; sent when it is set back to `active`.
 * `cancelled` means the endpoint's transformation set `cancel: true` (not a failure; not retried).
 * `waiting` means the message is stored for a polling endpoint and has not been fetched yet (the message counts as `pending`).
 */
export type DeliveryStatus = 'pending' | 'held' | 'retrying' | 'success' | 'failed' | 'cancelled' | 'waiting';
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
  /**
   * `direct` or `relay` for webhooks; the destination type (such as `sqs` or `slack`) for other destinations, also when sent through the relay.
   * `poll` for a polling endpoint: `at` is when the receiver fetched the message.
   */
  via: 'direct' | 'relay' | 'poll' | DestinationType;
  /** Static IP used when sent through the relay. `null` for direct sends. */
  source_ip: string | null;
  /** `changed` when the endpoint's transformation changed the request, `error` when it failed (nothing was sent). */
  transform: 'changed' | 'error' | null;
  /**
   * ID returned by a destination other than a webhook (SQS MessageId, object key, Kafka partition:offset, Chatwork message_id
   * and so on). `null` for `slack` and `teams`.
   */
  ref: string | null;
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
  /**
   * The endpoint's current status, or `null` if it was deleted. A delivery to a `disabled` or deleted endpoint
   * cannot be retried. Returned since 2026-10-17.
   */
  endpoint_status?: EndpointStatus | null;
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
  /** The source the message was received from, with its name at that time. `null` for messages sent with `messages.send()`. */
  source: SourceRef | null;
}

export interface SendMessageParams {
  /** Your customer's ID (`external_id`). A consumer is created if it does not exist. */
  consumer: string;
  /** Event type, such as `invoice.paid`. */
  event_type: string;
  /** Any JSON value, up to 1 MB. Delivered as `data`. */
  payload: unknown;
  /**
   * A JSON object (up to 4 KB as JSON) passed to the endpoints' transformations as `webhook.transformationsParams`.
   * Not delivered by itself.
   */
  transformations_params?: Record<string, unknown>;
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
  /**
   * Unix milliseconds. Only messages created at or after this time. When omitted with `q`, `status` or `event_type`,
   * the last 7 days are searched.
   */
  since?: number;
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

/**
 * Delivery order of an endpoint. `none` sends deliveries in parallel. `fifo` sends them one at a time in the order the messages
 * were accepted: the next delivery waits until the previous one succeeds or ends as failed (retries included).
 */
export type EndpointOrdering = 'none' | 'fifo';

/**
 * Body sent to an endpoint. `standard` is the Standard Webhooks body `{ type, timestamp, data }`.
 * `raw` sends the message `data` itself. The signature covers the body that is sent.
 */
export type EndpointBodyFormat = 'standard' | 'raw';

/** Number of re-sends after the first send. `0` means no retry. */
export type RetryCount = 0 | 1 | 2 | 3 | 5 | 7 | 12;
/**
 * Wait before each retry. `progressive` is 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h (then 10 h each).
 * The others are fixed intervals.
 */
export type RetryInterval = 'progressive' | '1m' | '5m' | '30m' | '1h' | '6h';

/**
 * Retry policy of an endpoint. Default `{ count: 7, interval: 'progressive' }`: up to 8 attempts over about 28 hours.
 * Combinations whose last retry comes more than 3 days after the first send (`progressive` × 12) are rejected.
 */
export interface RetryPolicy {
  count: RetryCount;
  interval: RetryInterval;
}

/**
 * An extra HMAC-SHA256 signature header for receivers that still verify a custom signature.
 * The Standard Webhooks headers are always sent. The key is the endpoint's signing secret string (`whsec_…`) as UTF-8.
 */
export interface CompatSignature {
  /** Lowercase header name, such as `x-hub-signature-256`. */
  header: string;
  /** `body` signs the body only (no replay protection). `timestamp_body` signs `${webhook-timestamp}.${body}`. */
  content: 'body' | 'timestamp_body';
  encoding: 'hex' | 'base64';
  /** Prepended to the value, such as `sha256=`. Empty when none. */
  prefix: string;
}

export interface CompatSignatureParams {
  header: string;
  content: 'body' | 'timestamp_body';
  encoding: 'hex' | 'base64';
  /** Printable ASCII without spaces, up to 32 characters. */
  prefix?: string;
}

export type RecoveryStatus = 'running' | 'done' | 'stopped';

/** Bulk resend of the failed deliveries of one endpoint. */
export interface Recovery {
  id: string;
  endpoint_id: string;
  /** Unix milliseconds. Messages created at or after this time are covered. */
  since: number;
  /** `stopped` means the endpoint was paused, disabled or deleted before it finished. */
  status: RecoveryStatus;
  /** Failed deliveries counted when it started. */
  total: number;
  /** Deliveries put back on the send queue so far. */
  queued: number;
  created_at: number;
  finished_at: number | null;
}

export interface RecoverParams {
  /** Unix milliseconds, within your plan's retention and not in the future. */
  since: number;
}

export interface Endpoint {
  id: string;
  consumer_id: string;
  type: EndpointType;
  /** `null` for a polling endpoint. For other destinations, a readable form such as `sqs://region/account/queue`. */
  url: string | null;
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
  /** The effective retry policy (the default when not set). */
  retry: RetryPolicy;
  compat_signature: CompatSignature | null;
  /** Delivery order. Default `none`. */
  ordering: EndpointOrdering;
  /** Body sent to the endpoint. Default `standard`. */
  body_format: EndpointBodyFormat;
  /** Unix milliseconds when the transformation was last saved, or `null` when there is none or it is disabled. */
  transformation_updated_at: number | null;
  /** Unix milliseconds when the receiver last polled (recorded at most once a minute), or `null`. Always `null` for an http endpoint. */
  last_polled_at: number | null;
  /** Settings of a destination other than a webhook, with a masked hint of the credentials. `null` for webhooks. */
  destination: Destination | null;
}

/** Destinations other than webhooks. */
export type DestinationType =
  | 'sqs'
  | 'eventbridge'
  | 'pubsub'
  | 's3'
  | 'r2'
  | 'gcs'
  | 'azure_blob'
  | 'servicebus'
  | 'kafka'
  | 'rabbitmq'
  | 'slack'
  | 'teams'
  | 'chatwork';

/**
 * `http` sends to `url` (webhooks). `polling` has no URL: the receiver fetches messages with a poller token (see `Poller`).
 * Other types send to a queue, event bus, object storage or chat (Pro plan and above). `slack`, `teams` and `chatwork` post a chat
 * message instead of the JSON body and are not signed: the message uses the `data` fields `text` (required for this form), and
 * optionally `title`, `lines` (strings) and `link` (https URL); otherwise the title is the event type and the body is `data` as JSON.
 */
export type EndpointType = 'http' | 'polling' | DestinationType;

/** Access key for SQS, EventBridge, S3, R2 (R2 API token) and GCS (HMAC key). */
export interface AwsStyleCredentials {
  access_key_id: string;
  secret_access_key: string;
}

/**
 * Settings of a destination other than a webhook. The hosts are the providers' official endpoints built from these values,
 * except `kafka` and `rabbitmq`, which take an https `url`. Optional values have the defaults shown.
 * `slack` and `teams` have no settings: pass only `credentials` (`{ credentials: { webhook_url } }`).
 */
export type DestinationConfig =
  | SqsDestination
  | EventBridgeDestination
  | { project_id: string; topic: string }
  | ObjectDestination
  | { namespace: string; entity: string }
  | { url: string; cluster_id: string; topic: string }
  | RabbitMqDestination
  | ChatworkDestination;

export interface SqsDestination {
  region: string;
  account_id: string;
  /** Ends with `.fifo` for a FIFO queue. */
  queue_name: string;
}

export interface EventBridgeDestination {
  region: string;
  /** Name or ARN. Default `default`. */
  event_bus?: string;
  /** Default `webhookadmin`. */
  source?: string;
  /** Default: the event type. */
  detail_type?: string;
}

/** S3 (`region`), R2 (`account_id`), GCS and Azure Blob (`account`, `container`). */
export interface ObjectDestination {
  region?: string;
  account_id?: string;
  bucket?: string;
  account?: string;
  container?: string;
  /** Object name prefix. Default empty. */
  prefix?: string;
}

export interface RabbitMqDestination {
  /** HTTP API base URL (https). */
  url: string;
  /** Default `/`. */
  vhost?: string;
  exchange: string;
  routing_key?: string;
}

export interface ChatworkDestination {
  /** Chatwork room ID (digits). */
  room_id: string;
}

/** Credentials, write-only. The API never returns them. */
export type DestinationCredentials =
  | AwsStyleCredentials
  | ServiceAccountCredentials
  | { account_key: string }
  | { key_name: string; key: string }
  | { api_key: string; api_secret: string }
  | { username: string; password: string }
  | ChatWebhookCredentials
  | { api_token: string };

/**
 * `slack`: a Slack Incoming Webhook URL (`https://hooks.slack.com/services/T…/B…/…`).
 * `teams`: a Teams Workflows URL ("When a Teams webhook request is received", on `*.powerplatform.com` or `*.logic.azure.com`);
 * Office 365 connector URLs (`webhook.office.com`) are not accepted.
 */
export interface ChatWebhookCredentials {
  webhook_url: string;
}

/** Pub/Sub, and GCS instead of an HMAC key. */
export interface ServiceAccountCredentials {
  /** The service account key file (JSON), as a string or an object. */
  service_account: string | Record<string, unknown>;
}

/** Destination settings when creating or updating. On update, omit `credentials` to keep the current ones. */
export type DestinationParams = DestinationConfig & { credentials?: DestinationCredentials };

/** Destination settings as returned by the API. */
export type Destination = Record<string, string> & {
  /** Masked hint of the stored credentials, such as `AKIA…MPLE`. */
  credentials_hint: string;
};

export interface DestinationTestParams {
  /** Use this endpoint's saved settings and credentials. */
  endpoint_id?: string;
  /** Required when `endpoint_id` is omitted. */
  type?: DestinationType;
  /** Overrides the saved settings. Required when `endpoint_id` is omitted, with credentials. */
  destination?: DestinationParams;
  /** Send through the static-IP relay. Default: the endpoint's setting. */
  fixed_ip?: boolean;
}

/** Result of sending one test message right away. Nothing is recorded. */
export interface DestinationTestResult {
  ok: boolean;
  via: DestinationType;
  response_status: number | null;
  duration_ms: number;
  error: string | null;
  /** First 1024 bytes of the response when it failed. */
  response_head: string | null;
  ref: string | null;
}

export interface EndpointWithSecret extends Endpoint {
  /** Signing secret (`whsec_…`), or the imported `secret`. Returned only when the endpoint is created. */
  secret: string;
  /** For a polling endpoint, the URL the receiver polls (`…/v1/poller/{endpoint_id}`). `null` for an http endpoint. */
  poller_url: string | null;
}

export interface EndpointDetail extends Endpoint {
  /** Latest attempts to this endpoint this month (up to 20). */
  recent: Attempt[];
  /** Deliveries waiting for a retry. */
  retrying_count: number;
  /** With `ordering: 'fifo'`, deliveries waiting behind the one being sent. `0` otherwise. */
  waiting_count: number;
  /** The latest bulk resend, or `null`. */
  recovery: Recovery | null;
  /** For a polling endpoint, the URL the receiver polls (`…/v1/poller/{endpoint_id}`). `null` for an http endpoint. */
  poller_url: string | null;
}

export interface EndpointCreateParams {
  consumer_id: string;
  /** https (port 443 or 8443). Required for webhooks (`type: 'http'`, the default); omit it for a polling endpoint. */
  url?: string;
  /**
   * Default `http`. `polling` has no `url`. Other types need `destination` instead of `url` (Pro plan and above).
   * Cannot be changed later.
   */
  type?: EndpointType;
  destination?: DestinationParams;
  /** Omit or `null` to receive all event types. */
  event_types?: string[] | null;
  fixed_ip?: boolean;
  description?: string;
  /** Omit or `null` for the default policy. */
  retry?: RetryPolicy | null;
  /** Omit or `null` for none. */
  compat_signature?: CompatSignatureParams | null;
  /** Default `none`. */
  ordering?: EndpointOrdering;
  /** Default `standard`. */
  body_format?: EndpointBodyFormat;
  /**
   * An existing signing secret to keep, such as one from another webhook service: `whsec_` and standard base64 of 24 to 75 bytes
   * (`whsec_` may be omitted). Omit to generate one. Only on create; use `rotateSecret()` to change it later.
   */
  secret?: string;
}

export interface EndpointUpdateParams {
  /** Webhooks only. */
  url?: string;
  /** Destinations other than webhooks only. Changing the host of a `kafka` or `rabbitmq` URL requires new credentials. */
  destination?: DestinationParams;
  event_types?: string[] | null;
  /** `active` also re-enables a disabled endpoint and sends messages held while paused. */
  status?: 'active' | 'paused';
  description?: string;
  /** Send through the static-IP relay (paid plans). */
  fixed_ip?: boolean;
  /** `null` goes back to the default policy. */
  retry?: RetryPolicy | null;
  /** `null` removes it. */
  compat_signature?: CompatSignatureParams | null;
  /** Switching to `none` sends the waiting deliveries right away, in parallel. */
  ordering?: EndpointOrdering;
  body_format?: EndpointBodyFormat;
}

/** An endpoint's transformation: JavaScript that defines `handler(webhook)` (Pro plan and above). */
export interface Transformation {
  endpoint_id: string;
  code: string;
  /** Unix milliseconds. */
  updated_at: number;
  /** `false` keeps the code but does not apply it. */
  enabled: boolean;
  /**
   * Read-only values for the code, as `webhook.env`. `null` when none. Values are returned only to keys with
   * `endpoints:write`; other keys get the names with each value hidden as `••••` (sending `••••` back keeps the saved value).
   */
  variables: Record<string, string> | null;
}

/** Omitted fields keep their current values. */
export interface TransformationSetParams {
  /**
   * JavaScript defining `function handler(webhook)`, up to 51,200 characters. Required when the endpoint has no transformation yet.
   * `webhook` is `{ method, url, eventType, payload, headers, cancel, env, transformationsParams }`; return it after changing
   * `payload`, `headers`, `method` (`POST` / `PUT` / `PATCH`) or the path and query of `url`, or set `cancel: true`.
   */
  code?: string;
  /** `false` keeps the code but stops applying it. Default `true` for a new transformation. */
  enabled?: boolean;
  /** Up to 50 string values (names of 1 to 100 characters, up to 4 KB as JSON), read as `webhook.env`. `null` removes them. */
  variables?: Record<string, string> | null;
}

export interface TransformationTestParams {
  /** Code to run. Omit to use the saved transformation. */
  code?: string;
  /** Sample `data`. Default `{ test: true, endpoint_id }`. */
  payload?: unknown;
  /** Default `webhook.test`. */
  event_type?: string;
  /** `webhook.env`. Omit to use the saved variables. */
  variables?: Record<string, string> | null;
  /** `webhook.transformationsParams`, as given to `messages.send()`. */
  transformations_params?: Record<string, unknown>;
}

export type TransformationErrorKind =
  | 'code_too_large'
  | 'syntax'
  | 'no_handler'
  | 'timeout'
  | 'memory'
  | 'runtime'
  | 'invalid_output'
  | 'output_too_large'
  | 'internal';

/** What the transformation would do. Nothing is sent. `logs` holds `console.log` output. */
export type TransformationTestResult =
  | {
      result: 'send';
      method: 'POST' | 'PUT' | 'PATCH';
      url: string;
      /** Headers the transformation adds. */
      headers: Record<string, string>;
      /** The body that would be sent (the whole JSON body, as parsed). */
      payload: unknown;
      changed: boolean;
      logs: string[];
    }
  | { result: 'cancel'; logs: string[] }
  | { result: 'error'; error: { kind: TransformationErrorKind; message: string }; logs: string[] };

/** A token the receiver uses to poll one polling endpoint. It can only read that endpoint. */
export interface PollerToken {
  /** `ptk_…` */
  id: string;
  endpoint_id: string;
  name: string;
  /** First characters of the token, such as `sk_poll_abcd…`. */
  prefix: string;
  /** Unix milliseconds. */
  created_at: number;
  /** Unix milliseconds (recorded at most once a minute), or `null` when never used. */
  last_used_at: number | null;
}

export interface PollerTokenCreated extends PollerToken {
  /** The token (`sk_poll_…`). Returned only when it is created. */
  token: string;
}

export interface PollerTokenCreateParams {
  /** Up to 100 characters. */
  name?: string;
}

export interface PollerTokenList {
  items: PollerToken[];
}

/** A message fetched from a polling endpoint. The same ID, body and signature as a pushed webhook. */
export interface PolledMessage {
  /** `msg_…`, also sent as `webhook-id`. */
  id: string;
  event_type: string;
  /** ISO 8601. */
  timestamp: string;
  /** The Standard Webhooks body, `{ type, timestamp, data }`. With `body_format: 'raw'`, the message `data` itself. */
  payload: WebhookEvent;
  /** `webhook-id`, `webhook-timestamp` and `webhook-signature` (signed with the endpoint's secret). */
  headers: Record<string, string>;
}

/** One page from `GET /v1/poller/{endpoint_id}`. */
export interface PollPage {
  data: PolledMessage[];
  /**
   * Pass it to the next call. That call acknowledges this page; calling with an older iterator returns the same messages again.
   * Save it after you have processed `data` to resume from there.
   */
  iterator: string;
  /** `true` when there is nothing more right now. */
  done: boolean;
}

export interface PollParams {
  /** The `iterator` of the previous page. Omit to start at the beginning of your plan's retention. */
  iterator?: string;
  /** 1 to 250. Default 50. */
  limit?: number;
  /** Only these event types (within the endpoint's `event_types`). Up to 100. */
  event_types?: string[];
  /** Without `iterator`, start from messages accepted at or after this time. Ignored when `iterator` is given. */
  after?: Date | string;
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

export interface EventType {
  /** Such as `invoice.paid`. */
  name: string;
  description: string;
  /** Unix milliseconds when archived, or `null`. */
  archived_at: number | null;
}

export interface EventTypeCreateParams {
  /** Letters, digits and `_ . : -`, up to 100 characters. */
  name: string;
  /** Up to 200 characters. */
  description?: string;
}

export interface EventTypeList {
  /** Sorted by name. */
  items: EventType[];
}

export interface EnsureEventTypesResult {
  /** Event types registered by this call. */
  created: EventType[];
  /** Event types that already existed, as they are stored. */
  existing: EventType[];
}

/**
 * How a source verifies the webhooks it receives. `stripe`, `github`, `shopify`, `slack`, `meta` and `zoom` check each service's
 * signature (`meta` also answers the subscription check with `config.verify_token`, and `zoom` answers its URL validation),
 * `standard` checks the Standard Webhooks headers, `hmac` checks an HMAC-SHA256 of the body in the header set in `config.header`,
 * `basic` checks Basic authentication (`config.username` and the secret as the password), `api_key` checks the secret in the
 * header `config.header` or the query parameter `config.query`, and `none` does not verify.
 */
export type SourceProvider =
  | 'stripe'
  | 'github'
  | 'shopify'
  | 'slack'
  | 'meta'
  | 'zoom'
  | 'standard'
  | 'hmac'
  | 'basic'
  | 'api_key'
  | 'none';

/**
 * `paused` still accepts webhooks (after verifying them) and holds them; they become messages when the source is set back to
 * `active`. `Source.held` is the number waiting.
 */
export type SourceStatus = 'active' | 'paused';

/** What a source answers when it accepts a webhook. */
export interface SourceResponse {
  /** 200 to 299. Default 200. */
  status: number;
  /** Default `text/plain; charset=utf-8`. */
  content_type: string;
  /** Up to 4 KB. Default empty. */
  body: string;
}

/** Settings of a source. Which fields apply depends on the provider. */
export interface SourceConfig {
  /** Event type used when none can be read from the webhook. Default `inbound`. */
  event_type?: string;
  /** `hmac`, `basic`, `api_key` and `none`: the body field that holds the event type (`.` for nested fields, numbers for array items). */
  event_type_field?: string;
  /** `hmac`, `basic`, `api_key` and `none`: the header that identifies a delivery, used to drop duplicates. */
  id_header?: string;
  /** `hmac`: the signature header (required). `api_key`: the header that holds the key (set `header` or `query`). */
  header?: string;
  /** `api_key`: the query parameter that holds the key. */
  query?: string;
  /** `hmac`: only `sha256`. */
  algorithm?: 'sha256';
  /** `hmac`: default `hex`. */
  encoding?: 'hex' | 'base64';
  /**
   * `hmac`: prefix removed from the header value before comparing, such as `sha256=`.
   * `api_key`: prefix of the key header value, such as `Bearer `.
   */
  prefix?: string;
  /** `meta`: compared with `hub.verify_token` when Meta checks the subscription (a `GET` to the URL). */
  verify_token?: string;
  /** `basic`: the user name (required). The password is the secret. */
  username?: string;
  /** Headers received that are passed on to the endpoints as they are (up to 20, lowercase). */
  forward_headers?: string[];
  /** What to answer when a webhook is accepted. Default 200 with an empty body. */
  response?: SourceResponse;
}

export interface SourceRef {
  id: string;
  /** The source's name when the message was received. */
  name: string;
  /** The received request (`sreq_…`) the message was made from. */
  request_id?: string;
}

/** Receives webhooks from another service at `url` and turns them into messages of one consumer. */
export interface Source {
  /** `src_…` */
  id: string;
  name: string;
  provider: SourceProvider;
  consumer_id: string;
  consumer: ConsumerRef;
  status: SourceStatus;
  /** The URL to register with the sending service, such as `https://api.webhookadmin.com/in/…`. */
  url: string;
  /** Masked hint of the signing secret, or `null` when none is set. */
  secret_hint: string | null;
  config: SourceConfig;
  /** Number of received webhooks held while the source is paused. */
  held: number;
  /** Unix milliseconds. */
  created_at: number;
  /** Unix milliseconds. */
  updated_at: number;
}

export interface SourceCreateParams {
  /** 1 to 100 characters. */
  name: string;
  provider: SourceProvider;
  /** The consumer whose messages the received webhooks become. */
  consumer_id: string;
  /**
   * The signing secret from the sending service. `standard` takes `whsec_` and base64; the others take printable ASCII
   * without spaces. Only on create; use `setSecret()` later.
   */
  secret?: string;
  config?: SourceConfig;
  /** Default `active`. */
  status?: SourceStatus;
}

export interface SourceUpdateParams {
  name?: string;
  /** Changing the provider removes the signing secret and, when `config` is omitted, resets the settings. */
  provider?: SourceProvider;
  consumer_id?: string;
  status?: SourceStatus;
  config?: SourceConfig;
}

export interface SourceListParams {
  /** 1 to 100. Default 50. */
  limit?: number;
  cursor?: string;
}

/**
 * `duplicate` means the service sent the same delivery again within 24 hours; the same message ID was returned.
 * `held` means it was received while the source was paused; it is processed when the source is set back to `active`.
 */
export type SourceRequestStatus = 'accepted' | 'duplicate' | 'rejected' | 'held';

/** One webhook a source received. Kept for your plan's retention. */
export interface SourceRequest {
  /** `sreq_…` */
  id: string;
  /** Unix milliseconds. */
  at: number;
  /** `POST`, `PUT`, `PATCH`, `DELETE` or `GET`. */
  method: string;
  status: SourceRequestStatus;
  /** The status code returned to the sending service. */
  response_status: number;
  /** Why it was rejected (such as `invalid signature`), or a note such as `url_verification`. */
  reason: string | null;
  /** The message created, or `null`. */
  message_id: string | null;
  event_type: string | null;
  content_type: string | null;
  /** Body size in bytes. */
  size: number;
  /** Headers received, without credentials and cookies. */
  headers: Record<string, string>;
  /** Unix milliseconds when a held or rejected request was processed later, or `null`. */
  processed_at: number | null;
  /** `true` for a rejected request whose body was kept: `sources.reprocessRequest()` can process it again. */
  reprocessable: boolean;
}

export interface SourceRequestListParams {
  /** 1 to 100. Default 50. */
  limit?: number;
  cursor?: string;
  /** Only requests with this status. */
  status?: SourceRequestStatus;
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
