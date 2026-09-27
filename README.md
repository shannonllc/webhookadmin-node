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
| `messages.list({ status?, event_type?, q?, limit?, cursor? })` | `GET /v1/messages` |
| `messages.get(id)` | `GET /v1/messages/:id` |
| `deliveries.retry(id)` | `POST /v1/deliveries/:id/retry` |
| `consumers.create({ external_id, name? })` | `POST /v1/consumers` |
| `consumers.list({ limit?, cursor? })` | `GET /v1/consumers` |
| `endpoints.create({ consumer_id, url, event_types?, fixed_ip?, description? })` | `POST /v1/endpoints` |
| `endpoints.list({ consumer_id? })` | `GET /v1/endpoints` |
| `endpoints.get(id)` | `GET /v1/endpoints/:id` |
| `endpoints.update(id, { url?, event_types?, status?, description? })` | `PATCH /v1/endpoints/:id` |
| `endpoints.delete(id)` | `DELETE /v1/endpoints/:id` |
| `endpoints.rotateSecret(id)` | `POST /v1/endpoints/:id/rotate-secret` |
| `endpoints.sendTest(id, { event_type? })` | `POST /v1/endpoints/:id/test` |
| `portal.createLink(consumerId, { frame_origin?, locale? })` | `POST /v1/consumers/:id/portal` |

Every method also takes request options as the last argument: `{ timeout?, maxRetries?, signal? }`.

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
