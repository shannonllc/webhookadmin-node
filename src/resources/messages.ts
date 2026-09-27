import type { Http } from '../http';
import { PagePromise } from '../pagination';
import { uuid } from '../runtime';
import type {
  Message,
  MessageListParams,
  MessageSummary,
  Page,
  RequestOptions,
  SendMessageOptions,
  SendMessageParams,
  SendMessageResponse,
} from '../types';

const id = (v: string) => encodeURIComponent(v);

export class Messages {
  /** @internal */
  constructor(private readonly http: Http) {}

  /**
   * Sends a message to every active endpoint of the consumer that accepts the event type.
   * Requires the `messages:send` scope.
   */
  async send(params: SendMessageParams, options: SendMessageOptions = {}): Promise<SendMessageResponse> {
    const { idempotencyKey, ...rest } = options;
    const key = idempotencyKey ?? `webhookadmin-node-${await uuid()}`;
    return this.http.request(
      { method: 'POST', path: '/v1/messages', body: params, headers: { 'idempotency-key': key }, idempotent: true },
      rest,
    );
  }

  /** Lists messages, newest first. Requires `logs:read`. */
  list(params: MessageListParams = {}, options?: RequestOptions): PagePromise<MessageSummary> {
    const { cursor, ...query } = params;
    return new PagePromise(
      (c) =>
        this.http.request<Page<MessageSummary>>(
          { method: 'GET', path: '/v1/messages', query: { ...query, cursor: c }, idempotent: true },
          options,
        ),
      cursor,
    );
  }

  /** Gets a message with its deliveries and attempts. Requires `logs:read`. */
  get(messageId: string, options?: RequestOptions): Promise<Message> {
    return this.http.request({ method: 'GET', path: `/v1/messages/${id(messageId)}`, idempotent: true }, options);
  }
}
