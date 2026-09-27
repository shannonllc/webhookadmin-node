// API のエラー（{ error, message, fields? }）を状態コードごとのクラスにする。

export type ErrorOptions = {
  status?: number;
  code?: string;
  fields?: Record<string, string>;
  requestId?: string;
  cause?: unknown;
};

/** Base class for every error thrown by the SDK. */
export class WebhookAdminError extends Error {
  override name = 'WebhookAdminError';
  /** HTTP status. Undefined when no response was received. */
  readonly status: number | undefined;
  /** API error code, such as `invalid` or `not_found`. */
  readonly code: string | undefined;
  /** Per-field messages for validation errors. */
  readonly fields: Record<string, string> | undefined;
  /** Request ID (`x-request-id`, or Cloudflare's `cf-ray`) to quote when contacting support. */
  readonly requestId: string | undefined;

  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.status = options.status;
    this.code = options.code;
    this.fields = options.fields;
    this.requestId = options.requestId;
  }
}

/** 401: the API key is missing, wrong, revoked or expired. */
export class AuthenticationError extends WebhookAdminError {
  override name = 'AuthenticationError';
}

/** 403: the API key does not have the scope for this operation. */
export class PermissionError extends WebhookAdminError {
  override name = 'PermissionError';
}

/** 404: the resource does not exist in the key's environment. */
export class NotFoundError extends WebhookAdminError {
  override name = 'NotFoundError';
}

/** 400, 413 or 422: the request body or parameters are invalid. See `fields`. */
export class ValidationError extends WebhookAdminError {
  override name = 'ValidationError';
}

/** 402: the plan's limit was reached (monthly messages, or a feature not in the plan). */
export class PlanLimitError extends WebhookAdminError {
  override name = 'PlanLimitError';
}

/** 409: conflicts with the current state (duplicate external_id, delivery still in progress). */
export class ConflictError extends WebhookAdminError {
  override name = 'ConflictError';
}

/** 429: too many requests. Thrown after retries are used up. */
export class RateLimitError extends WebhookAdminError {
  override name = 'RateLimitError';
  /** Seconds to wait before retrying, from `retry-after`. */
  readonly retryAfter: number | undefined;

  constructor(message: string, options: ErrorOptions & { retryAfter?: number } = {}) {
    super(message, options);
    this.retryAfter = options.retryAfter;
  }
}

/** Any other error response, including 5xx. */
export class ApiError extends WebhookAdminError {
  override name = 'ApiError';
}

/** The request could not reach the API (DNS, TCP, TLS) or was aborted. */
export class ConnectionError extends WebhookAdminError {
  override name = 'ConnectionError';
}

/** The request did not complete within `timeout`. */
export class TimeoutError extends ConnectionError {
  override name = 'TimeoutError';
}

/** Signature verification of an incoming webhook failed. */
export class WebhookVerificationError extends WebhookAdminError {
  override name = 'WebhookVerificationError';
}

type ErrorBody = { error?: unknown; message?: unknown; fields?: unknown };

/** Seconds from `retry-after` (seconds or HTTP date). */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, (at - now) / 1000);
}

export function requestIdOf(headers: Headers): string | undefined {
  return headers.get('x-request-id') ?? headers.get('cf-ray') ?? undefined;
}

/** Builds the error for a non-2xx response. `text` is the raw response body. */
export function errorFromResponse(status: number, text: string, headers: Headers): WebhookAdminError {
  let body: ErrorBody = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') body = parsed as ErrorBody;
  } catch {
    // HTML from a proxy, empty body, etc.
  }
  const options: ErrorOptions = {
    status,
    code: typeof body.error === 'string' ? body.error : undefined,
    fields: body.fields && typeof body.fields === 'object' ? (body.fields as Record<string, string>) : undefined,
    requestId: requestIdOf(headers),
  };
  const message = typeof body.message === 'string' ? body.message : `HTTP ${status}`;
  switch (status) {
    case 401:
      return new AuthenticationError(message, options);
    case 403:
      return new PermissionError(message, options);
    case 404:
      return new NotFoundError(message, options);
    case 400:
    case 413:
    case 422:
      return new ValidationError(message, options);
    case 402:
      return new PlanLimitError(message, options);
    case 409:
      return new ConflictError(message, options);
    case 429:
      return new RateLimitError(message, { ...options, retryAfter: parseRetryAfter(headers.get('retry-after')) });
    default:
      return new ApiError(message, options);
  }
}
