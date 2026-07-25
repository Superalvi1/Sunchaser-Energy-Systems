# Unified Messaging — Transport-Neutral Contract

**Scope:** Task 2 contract definition only. No production wiring, no Official Meta adapter implementation, no QR connector, no website-chat implementation.

**Module:** `server/unifiedMessaging/`

**Baseline:** Builds on Task 1 characterization (`docs/architecture/unified-messaging-current-state.md`) without modifying `server/whatsappTransport/`.

---

## Contract boundaries

| Layer | Responsibility | This task |
|-------|----------------|-----------|
| Transport adapter | Provider I/O, verify/normalize/send, capabilities, health | **Interface only** |
| Messaging gateway (future) | Idempotency, persistence, fan-in events | Not implemented |
| Inbox / CRM services | Conversations, leads, assignment, OCC | Untouched |
| AI engine | Shadow/active decisions | Untouched; adapters must not receive AI clients |

**Hard rules for adapters:**

- Must not receive a CRM repository or lead/conversation writer.
- Must not receive an AI client.
- Must not write directly to conversation or lead tables.
- Credentials are accessed only through opaque `TransportSecretRef` + `TransportSecretResolver`.
- Browser-facing results (`BrowserSafeConnectionStatus`) never contain secret values.
- Adapter results return normalized data/events to a future messaging gateway.
- Outbound operations require an idempotency key.
- Unsupported capabilities fail as `capability_unsupported` **before** provider dispatch.

---

## Channel identifiers

| Transport id | Label | Notes |
|--------------|-------|-------|
| `meta_whatsapp_cloud` | Official Meta WhatsApp Cloud API (Coexistence) | Production path today (unwired to this contract yet) |
| `whatsapp_web_qr` | Experimental WhatsApp Web QR | **experimental**, **internal-only**, **independently disableable** |
| `website_chat` | Website chat | Future |
| `instagram` | Instagram Messaging | Future |
| `messenger` | Facebook Messenger | Future |

QR isolation requirements:

- Identifiable as experimental + internal-only in `TRANSPORT_CHANNEL_DESCRIPTORS`.
- Independently disableable without affecting Meta Cloud.
- No WhatsApp Web library, QR session handling, or browser session storage in this module.
- Capability `qr_authentication` is explicit and off for non-QR profiles.

---

## Connection states

Normalized states: `unconfigured`, `connecting`, `awaiting_qr`, `connected`, `degraded`, `reconnecting`, `disconnected`, `expired`, `disabled`, `failed`.

`BrowserSafeConnectionStatus` includes:

- normalized `state` + `health`
- `lastSuccessfulActivityAt`
- `lastErrorCategory`
- `reconnectEligible`
- `transportMetadata` (masked IDs / non-secret flags only)
- `experimental` / `internalOnly` / `independentlyDisableable`
- `safeErrorSummary` (no tokens, cookies, session blobs, encryption keys, or customer PII)

Forbidden browser fields are listed in `FORBIDDEN_BROWSER_CONNECTION_FIELDS`.

---

## Normalized messages and events

### Message

`NormalizedMessage` carries internal ids, organization/conversation/connection ids, transport, external provider message id, direction, opaque identity refs, message type, normalized text, controlled `structuredContent`, reply-to, client idempotency key, timestamps, processing/delivery status, origin, optional `aiRunRef`, and **safe/redacted** `providerMetadata`.

Message types: `text`, `image`, `audio`, `video`, `document`, `interactive`, `template`, `location`, `reaction`, `system`.

Origins: `customer`, `human`, `ai`, `bot_flow`, `system`, `broadcast`.

Unrestricted raw provider payloads are **not** the primary normalized record.

### Delivery status compatibility

`META_COMPAT_DELIVERY_STATUSES` = `sent`, `delivered`, `read`, `failed` — compatible with the official Meta characterization baseline. Broader `DELIVERY_STATUSES` also includes `queued`, `sending`, `received`.

### Events

- `inbound_message_received`
- `outbound_message_requested`
- `outbound_message_accepted`
- `outbound_message_failed`
- `delivery_status_updated`
- `connection_status_changed`
- `media_received`
- `transport_diagnostic`

Every event has: `eventId`, `transport`, `connectionId`, `occurredAt`, `dedupeKey`, `metadata` (safe).

---

## Capability negotiation

Capabilities are explicit booleans (`TransportCapabilitySet`), including:

`text`, `inbound_media`, `outbound_media`, `templates`, `interactive_messages`, `delivery_receipts`, `read_receipts`, `reactions`, `voice_notes`, `broadcasts`, `reconnect`, `qr_authentication`, `webhook_verification`.

`assertCapability` / `requireCapability` gate operations via `OPERATION_REQUIRED_CAPABILITY`.  
There is **no** assumption that every channel supports Meta templates or broadcasts.

`exampleCapabilityProfile` exists for documentation/tests only — not production wiring.

---

## Adapter operations

`MessagingTransportAdapter`:

`connect`, `disconnect`, `reconnect`, `getConnectionStatus`, `getCapabilities`, `verifyInboundRequest`, `normalizeInbound`, `sendMessage`, `sendTemplate`, `downloadMedia`, `uploadMedia`, `normalizeStatus`, `resolveIdentity`, `healthCheck`.

Outbound envelopes include `idempotencyKey` and optional `AbortSignal`.  
Deps type (`MessagingTransportAdapterDeps`) allows only `secrets` (+ optional `now`) — not CRM/AI.

---

## Error taxonomy

Categories: `unauthorized`, `forbidden`, `invalid_request`, `signature_invalid`, `disconnected`, `session_expired`, `capability_unsupported`, `rate_limited`, `provider_timeout`, `provider_unavailable`, `provider_rejected`, `media_failure`, `credential_failure`, `internal_failure`.

Each `TransportContractError` carries:

- `retryable` / non-retryable
- `safeMessage`
- redacted `diagnostic`
- optional safe `providerCode`
- no raw secrets or customer PII

`requireOutboundIdempotencyKey` fails closed with `invalid_request` when missing/blank.

---

## Credential-handling boundary

1. Server stores/resolves secrets outside the adapter via `TransportSecretRef`.
2. Adapter calls `TransportSecretResolver.resolve(ref)` server-side only.
3. Resolved secret strings must never appear on `BrowserSafeConnectionStatus` or event metadata.
4. No credentials or PII in browser storage from this contract module.

---

## Why official Meta is not wired in this task

Task 1 captured Meta behaviour as a characterization baseline. Task 2 defines the interchange contract **without** changing production runtime:

- Existing webhook URLs, Embedded Signup, env var names, and `server/whatsappTransport/` behaviour remain untouched.
- Connecting Meta through `MessagingTransportAdapter` is deferred to a later façade/adapter phase to avoid dual-path risk.

---

## Planned future compatibility façade

A later phase should:

1. Implement `OfficialMetaAdapter` wrapping current Meta normalize/send/status helpers.
2. Introduce a messaging gateway that persists normalized events and calls inbox/CRM above the adapter.
3. Migrate env Graph credentials toward connection-scoped secret refs without breaking Coexistence.
4. Keep QR (if ever enabled) behind `whatsapp_web_qr` with independent disable + internal-only gates.

Until then, production traffic continues to use `server/whatsappTransport/` exclusively.

---

## Tests

- Runtime: `npm run test:unified-messaging-contract`
- Prior Meta baseline must remain green: `npm run test:unified-messaging-baseline`
