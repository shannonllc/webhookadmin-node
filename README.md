# webhookadmin

Node.js / TypeScript SDK for [Webhook Admin](https://webhookadmin.com/docs/).

- No dependencies. Uses `fetch` and Web Crypto.
- Node.js 18+, Bun, Deno, Cloudflare Workers.
- ESM and CommonJS, with TypeScript types.

## Install

```sh
npm install webhookadmin
```

## Send a message

```ts
import { WebhookAdmin } from 'webhookadmin';

const wha = new WebhookAdmin('sk_live_...'); // or set WEBHOOK_ADMIN_API_KEY

const { id, deliveries } = await wha.messages.send(
  { consumer: 'cus_123', event_type: 'invoice.paid', payload: { invoice_id: 'inv_1', amount: 1200 } },
  { idempotencyKey: 'invoice-inv_1-paid' },
);
```

`consumer` is your customer's ID (`external_id`). The consumer is created if it does not exist.

## Register event types

Register the event types you send, so they appear in the dashboard and the consumer portal. `ensure` creates the missing ones and leaves existing ones unchanged, so it can run on every deploy. Requires the `endpoints:write` scope.

```ts
const { created, existing } = await wha.eventTypes.ensure([
  { name: 'invoice.paid', description: 'An invoice was paid' },
  'invoice.refunded',
]);
```

`eventTypes.create` throws `ConflictError` when the name already exists. `eventTypes.list()` returns every event type as `{ items }` (not paged), sorted by name. It works with any API key of the environment.

## Verify incoming webhooks

Pass the raw request body, not a parsed object.

```ts
import { Webhook } from 'webhookadmin';

const wh = new Webhook(process.env.WEBHOOK_SECRET!); // whsec_...
const event = await wh.verify(rawBody, headers); // { type, timestamp, data }
```

`verify` throws `WebhookVerificationError` when the signature does not match or the timestamp is more than 5 minutes off (`new Webhook(secret, { tolerance: 300 })`). While a secret is being rotated, messages carry two signatures and either secret verifies.

Express:

```ts
app.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await wh.verify(req.body, req.headers);
    // handle event
    res.sendStatus(204);
  } catch {
    res.sendStatus(400);
  }
});
```

Hono:

```ts
app.post('/webhooks', async (c) => {
  const event = await wh.verify(await c.req.text(), c.req.raw.headers);
  return c.body(null, 204);
});
```

Next.js (App Router, `app/webhooks/route.ts`):

```ts
export async function POST(req: Request) {
  const event = await wh.verify(await req.text(), req.headers);
  return new Response(null, { status: 204 });
}
```

## API

| Method | Endpoint |
|---|---|
| `messages.send(params, { idempotencyKey? })` | `POST /v1/messages` |
| `messages.list({ status?, event_type?, q?, since?, limit?, cursor? })` | `GET /v1/messages` |
| `messages.get(id)` | `GET /v1/messages/:id` |
| `deliveries.retry(id)` | `POST /v1/deliveries/:id/retry` |
| `consumers.create({ external_id, name? })` | `POST /v1/consumers` |
| `consumers.list({ limit?, cursor? })` | `GET /v1/consumers` |
| `endpoints.create({ consumer_id, type?, url?, destination?, event_types?, fixed_ip?, description?, retry?, compat_signature?, ordering?, body_format?, secret? })` | `POST /v1/endpoints` |
| `endpoints.list({ consumer_id? })` | `GET /v1/endpoints` |
| `endpoints.get(id)` | `GET /v1/endpoints/:id` |
| `endpoints.update(id, { url?, destination?, event_types?, status?, description?, fixed_ip?, retry?, compat_signature?, ordering?, body_format? })` | `PATCH /v1/endpoints/:id` |
| `endpoints.testDestination({ endpoint_id?, type?, destination?, fixed_ip? })` | `POST /v1/destinations/test` |
| `endpoints.delete(id)` | `DELETE /v1/endpoints/:id` |
| `endpoints.rotateSecret(id)` | `POST /v1/endpoints/:id/rotate-secret` |
| `endpoints.sendTest(id, { event_type? })` | `POST /v1/endpoints/:id/test` |
| `endpoints.recover(id, { since })` | `POST /v1/endpoints/:id/recover` |
| `endpoints.recovery(id, recoveryId)` | `GET /v1/endpoints/:id/recoveries/:rid` |
| `endpoints.listPollerTokens(id)` | `GET /v1/endpoints/:id/poller-tokens` |
| `endpoints.createPollerToken(id, { name? })` | `POST /v1/endpoints/:id/poller-tokens` |
| `endpoints.deletePollerToken(id, tokenId)` | `DELETE /v1/endpoints/:id/poller-tokens/:tid` |
| `endpoints.getTransformation(id)` | `GET /v1/endpoints/:id/transformation` |
| `endpoints.setTransformation(id, { code?, enabled?, variables? })` | `PUT /v1/endpoints/:id/transformation` |
| `endpoints.deleteTransformation(id)` | `DELETE /v1/endpoints/:id/transformation` |
| `endpoints.testTransformation(id, { code?, payload?, event_type?, variables?, transformations_params? })` | `POST /v1/endpoints/:id/transformation/test` |
| `portal.createLink(consumerId, { frame_origin?, locale? })` | `POST /v1/consumers/:id/portal` |
| `eventTypes.list()` | `GET /v1/event-types` |
| `eventTypes.create({ name, description? })` | `POST /v1/event-types` |
| `eventTypes.ensure([name or { name, description? }, …])` | `GET` and `POST /v1/event-types` |

Every method also takes request options as the last argument: `{ timeout?, maxRetries?, signal? }`.

### Resend failed deliveries of an endpoint

After a receiver is fixed, resend every delivery to that endpoint that ended `failed`, as the same messages (same `webhook-id`). The endpoint must be `active`.

```ts
const recovery = await wha.endpoints.recover('ep_...', { since: Date.now() - 24 * 3600_000 });
// later
const { status, total, queued } = await wha.endpoints.recovery('ep_...', recovery.id); // status: 'running' | 'done' | 'stopped'
```

Messages created while the endpoint was `disabled` are not covered.

### Polling endpoints

A polling endpoint has no URL: the receiver fetches its messages with a poller token (`sk_poll_…`), which can only read that endpoint. Starter plan and above.

```ts
// sender (API key)
const ep = await wha.endpoints.create({ consumer_id: 'con_...', type: 'polling' });
const { token } = await wha.endpoints.createPollerToken(ep.id, { name: 'erp' }); // returned only here
```

The receiver needs only the endpoint ID and the token:

```ts
import { Poller } from 'webhookadmin';

const poller = new Poller({ endpointId: 'ep_...', token: 'sk_poll_...' });
let iterator = await loadIterator(); // undefined the first time: start of your plan's retention
for await (const page of poller.pages({ iterator })) {
  for (const m of page.data) await handle(m.payload); // { type, timestamp, data }
  await saveIterator(page.iterator);
}
```

`pages()` stops after a page with `done: true` (nothing more right now); run it again later with the saved iterator. Delivery is at least once: the next call with a page's `iterator` acknowledges that page, and calling with an older iterator returns the same messages again, so deduplicate by `m.id` if needed. `poll({ iterator?, limit?, event_types?, after? })` fetches one page (`limit` 1 to 250, default 50; `event_types` narrows the event types; `after`, a `Date` or ISO 8601 string, starts from that time when there is no iterator), and `messages()` yields the messages of `pages()` one by one. `m.headers` carries the same `webhook-id`, `webhook-timestamp` and `webhook-signature` as a pushed webhook; checking the signature is optional, since the connection is already authenticated by the token.

### Retry policy per endpoint

```ts
await wha.endpoints.update('ep_...', { retry: { count: 3, interval: '5m' } });
await wha.endpoints.update('ep_...', { retry: null }); // back to the default
```

| Field | Values |
|---|---|
| `count` | `0`, `1`, `2`, `3`, `5`, `7`, `12` (retries after the first send; `0` means no retry) |
| `interval` | `progressive` (5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h, then 10 h each), `1m`, `5m`, `30m`, `1h`, `6h` |

The default is `{ count: 7, interval: 'progressive' }`: up to 8 attempts including the first, over about 28 hours. Combinations whose last retry comes more than 3 days after the first send (`progressive` with `12`) are rejected with `ValidationError`.

### Compatibility signature

For receivers that still verify a custom signature, add one extra header. The Standard Webhooks headers are always sent. HMAC-SHA256 only; the key is the endpoint's signing secret string (`whsec_...`) as UTF-8. GitHub style:

```ts
await wha.endpoints.update('ep_...', {
  compat_signature: { header: 'x-hub-signature-256', content: 'body', encoding: 'hex', prefix: 'sha256=' },
});
```

`content: 'body'` has no replay protection. Use `timestamp_body` (signs `${webhook-timestamp}.${body}`) if you can, and move receivers to `wh.verify()`. Set `compat_signature: null` to remove it.

### Transformations

JavaScript that defines `handler(webhook)` runs right before every attempt (Pro plan and above). Omitted fields keep their current values.

```ts
await wha.endpoints.setTransformation('ep_...', {
  code: 'function handler(webhook) { webhook.headers["x-token"] = webhook.env.TOKEN; return webhook; }',
  variables: { TOKEN: '...' }, // read-only as webhook.env; null removes them
});
await wha.endpoints.setTransformation('ep_...', { enabled: false }); // keep the code, stop applying it
await wha.messages.send({ consumer: 'cus_123', event_type: 'invoice.paid', payload, transformations_params: { channel: '#billing' } });
```

`code` is up to 51,200 characters and required only when the endpoint has no transformation yet. `variables` holds up to 50 string values (up to 4 KB as JSON). `transformations_params` (a JSON object up to 4 KB) reaches the code as `webhook.transformationsParams`.

### Moving from another webhook service

Keep the signing secret your receivers already verify, and send the message `data` as the body:

```ts
await wha.endpoints.create({ consumer_id: 'con_...', url: 'https://example.com/wh', secret: 'whsec_...', body_format: 'raw' });
```

`secret` is `whsec_` and standard base64 of 24 to 75 bytes, and only on create (use `rotateSecret()` later). With `body_format: 'raw'` the signature covers that raw body; the default `standard` sends `{ type, timestamp, data }`.

### Pagination

`list()` returns the first page when awaited, and every item across pages with `for await`.

```ts
const page = await wha.messages.list({ status: 'failed' }); // { items, next_cursor }

for await (const message of wha.messages.list({ status: 'failed' })) {
  console.log(message.id);
}
```

## Errors

| Class | Status |
|---|---|
| `AuthenticationError` | 401 |
| `PermissionError` | 403 |
| `NotFoundError` | 404 |
| `ValidationError` | 400, 413, 422 |
| `PlanLimitError` | 402 |
| `ConflictError` | 409 |
| `RateLimitError` | 429 |
| `ApiError` | other, including 5xx |
| `ConnectionError` | no response |
| `TimeoutError` | no response within `timeout` (subclass of `ConnectionError`) |

All extend `WebhookAdminError`, which has `status`, `code`, `message`, `fields` and `requestId`.

```ts
import { ValidationError } from 'webhookadmin';

try {
  await wha.endpoints.create({ consumer_id: 'con_...', url: 'http://example.com' });
} catch (e) {
  if (e instanceof ValidationError) console.log(e.fields); // { url: '...' }
}
```

## Retries

| Response | Retried |
|---|---|
| 429 | Always. Waits for `retry-after`, or until `x-ratelimit-reset`. |
| 5xx, network error, timeout | Only requests that are safe to repeat: `GET`, `PATCH`, `DELETE`, `messages.send`, `portal.createLink` |
| Other 4xx | Never |

Backoff starts at 0.5 s, doubles up to 8 s, with ±25% jitter. `messages.send` generates an `Idempotency-Key` when you omit it and sends the same key on every retry, so a retried send is delivered once. Keys are kept for 24 hours.

## Configuration

```ts
const wha = new WebhookAdmin('sk_live_...', {
  baseUrl: 'https://api.webhookadmin.com', // default
  timeout: 30_000, // ms per attempt, default 30000
  maxRetries: 2, // default 2
  fetch: customFetch, // default globalThis.fetch
});
```

| Environment variable | Used when |
|---|---|
| `WEBHOOK_ADMIN_API_KEY` | the API key argument is omitted |

## License

MIT
