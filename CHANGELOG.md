# Changelog

## Unreleased

- Comments and tests only: the request ID is described as the ID to quote when contacting support, and internal paths and local addresses were removed from comments and tests. No API changes.

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
