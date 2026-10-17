# Changelog

## 0.5.0 (2026-10-17)

- Comments and tests only: the request ID is described as the ID to quote when contacting support, and internal paths and local addresses were removed from comments and tests. No API changes.
- Retrying a delivery to a disabled endpoint (`deliveries.retry()`), sending a test to one (`endpoints.sendTest()`) and starting a bulk resend for one (`endpoints.recover()`) now throw `ConflictError` with code `endpoint_disabled` instead of being accepted and then not sent. Fix the endpoint and set `status: 'active'` first. Retrying a delivery whose endpoint was deleted throws `NotFoundError`. `Delivery.endpoint_status` (the endpoint's current status, or `null` if deleted) tells you in advance.
- The `no_endpoint` message status (`MessageStatus`): the consumer had no endpoint for the message when it was accepted. Such messages used to be listed as `pending`. They are stored but not sent (not even if an endpoint is added later) and are not counted toward the monthly quota. `messages.list({ status: 'no_endpoint' })` lists them. If you switch on `status`, handle the new value.
- `consumers.delete(id)` for `DELETE /v1/consumers/:id`: deletes a consumer with its endpoints and the sources that deliver to it. Portal links for the consumer stop working and deliveries not yet sent are not sent.
- Sources (receiving webhooks from other services): `sources.create({ name, provider, consumer_id, secret?, config?, status? })`, `sources.list()`, `sources.get(id)`, `sources.update(id, { name?, provider?, consumer_id?, status?, config? })`, `sources.delete(id)`, `sources.setSecret(id, secret or null)`, `sources.listRequests(id, { status? })` and `sources.reprocessRequest(id, requestId)` for `/v1/sources`. `list()` and `listRequests()` page like `messages.list()`. `create()` and `reprocessRequest()` are not retried on a 5xx. Types `Source` (with `held`, the number of webhooks held while paused), `SourceProvider` (`stripe`, `github`, `shopify`, `slack`, `meta`, `zoom`, `standard`, `hmac`, `basic`, `api_key`, `none`), `SourceConfig` (with `query`, `verify_token`, `username`, `forward_headers` and `response`), `SourceResponse`, `SourceStatus`, `SourceRequest` (with `method`, `processed_at` and `reprocessable`), `SourceRequestStatus` (`accepted`, `duplicate`, `rejected`, `held`) and `SourceRef`. A paused source accepts and holds webhooks, and sends them on when set back to `active`.
- `Message.source`: the source a message was received from (`{ id, name, request_id }`), or `null`.
- Chat destinations: the `slack`, `teams` and `chatwork` endpoint types (`DestinationType`, Pro plan and above) post a chat message built from the message `data` (`text`, and optionally `title`, `lines` and `link`; otherwise the event type and `data` as JSON) instead of the JSON body, without a signature. `slack` and `teams` take `destination: { credentials: { webhook_url } }` (`ChatWebhookCredentials`: a Slack Incoming Webhook URL, or a Teams Workflows URL on `*.powerplatform.com` or `*.logic.azure.com`); `chatwork` takes `{ room_id, credentials: { api_token } }` (`ChatworkDestination`). `Attempt.via` can be `slack`, `teams` or `chatwork`, and `Attempt.ref` is the Chatwork `message_id` (`null` for `slack` and `teams`).

## 0.4.1 (2026-09-29)

- Documentation only: the README and the type descriptions no longer name other webhook services. No API changes.

## 0.4.0 (2026-09-29)

- Polling endpoints: `endpoints.create({ consumer_id, type: 'polling' })` (no `url`), `endpoints.listPollerTokens(id)`, `endpoints.createPollerToken(id, { name? })` and `endpoints.deletePollerToken(id, tokenId)`. `new Poller({ endpointId, token })` fetches the messages as the receiver with a poller token: `poll({ iterator?, limit? })`, `pages()` and `messages()`. `Endpoint.type` (`http` or `polling`), `Endpoint.last_polled_at`, `poller_url` on the created endpoint and `EndpointDetail`, `Endpoint.url` is `null` for a polling endpoint, the `waiting` delivery status and `Attempt.via: 'poll'`.
- Destinations other than webhooks: `type` (`EndpointType`: `http` or `sqs`, `eventbridge`, `pubsub`, `s3`, `r2`, `gcs`, `azure_blob`, `servicebus`, `kafka`, `rabbitmq`) and `destination` (`DestinationParams`, credentials are write-only) on `endpoints.create()` and `destination` on `endpoints.update()`. `Endpoint.type`, `Endpoint.destination` (settings and `credentials_hint`), `Attempt.ref` and the destination types in `Attempt.via`. `endpoints.testDestination({ endpoint_id?, type?, destination?, fixed_ip? })` for `POST /v1/destinations/test`.
- Transformations: `endpoints.getTransformation(id)`, `endpoints.setTransformation(id, { code })`, `endpoints.deleteTransformation(id)` and `endpoints.testTransformation(id, { code?, payload?, event_type? })` for `/v1/endpoints/:id/transformation`. `Endpoint.transformation_updated_at`, `Attempt.transform`, and the `cancelled` status on messages and deliveries.
- `ordering` on endpoints (`EndpointOrdering`): `fifo` sends deliveries to that endpoint one at a time, in the order the messages were accepted. `EndpointDetail.waiting_count` is the number waiting behind the delivery being sent.
- `secret` on `endpoints.create()`: import an existing signing secret (`whsec_…`, such as one from another webhook service) instead of generating one.
- `body_format` on endpoints (`EndpointBodyFormat`): `raw` sends the message `data` itself as the body (signed as sent) instead of `{ type, timestamp, data }`.
- `transformations_params` on `messages.send()`, passed to transformations as `webhook.transformationsParams`.
- Transformations: `Transformation.enabled` and `Transformation.variables` (read as `webhook.env`). `endpoints.setTransformation(id, { code?, enabled?, variables? })` keeps omitted fields, so `code` is optional once saved. `endpoints.testTransformation()` takes `variables` and `transformations_params`. The code limit is now 51,200 characters.
- `fixed_ip` on `endpoints.update()`.
- `since` on `messages.list()`: only messages created at or after a time (Unix milliseconds).
- `event_types` and `after` on `Poller.poll()`, `pages()` and `messages()`: read only some event types, or start from a time (`Date` or ISO 8601) when there is no iterator.

## 0.3.0 (2026-09-27)

- `endpoints.recover(id, { since })` and `endpoints.recovery(id, recoveryId)` for `POST /v1/endpoints/:id/recover` and `GET /v1/endpoints/:id/recoveries/:rid`: resend every failed delivery of one endpoint since a given time.
- `retry` on endpoints: choose the number of retries and the interval per endpoint (`RetryPolicy`).
- `compat_signature` on endpoints: add one extra HMAC-SHA256 signature header for receivers that verify a custom signature (`CompatSignature`).
- `EndpointDetail.recovery`: the latest bulk resend.

## 0.2.0

- `eventTypes.list()`, `eventTypes.create({ name, description? })` and `eventTypes.ensure(types)` for `GET /v1/event-types` and `POST /v1/event-types`.

## 0.1.0

- First release: messages, consumers, endpoints, deliveries, consumer portal links, and webhook signature verification.
