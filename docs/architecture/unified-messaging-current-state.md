# Unified Messaging — Official Meta Current-State Inventory

**Scope:** Characterization baseline for the official Meta WhatsApp Cloud API integration before introducing a transport-adapter abstraction.

**Baseline commit:** `8b1f82745d8d9c4595b6f9346e855f033e61c6a5` (`fix(whatsapp): launch Embedded Signup in Business App coexistence mode`)

**Constraints of this document:** No secrets, tokens, customer PII, or production credentials. This is an architecture inventory only; production behaviour is intentionally unchanged.

---

## 1. Current official Meta inbound flow

```
Meta Cloud API
  → GET/POST /api/whatsapp/webhook   (public allowlist; mounted before JWT)
  → installWhatsAppRawBodyMiddleware (POST body kept as Buffer)
  → createWhatsAppWebhookRouter
```

| Step | Behaviour |
|------|-----------|
| GET verify | `hub.mode=subscribe` + `hub.verify_token` matches `WHATSAPP_WEBHOOK_VERIFY_TOKEN` → plain-text `hub.challenge`. Allowed even when conversations are disabled. |
| Feature flag | POST requires `WHATSAPP_CONVERSATIONS_ENABLED`; else 404. |
| Signature | HMAC-SHA256 on exact raw bytes via `X-Hub-Signature-256` and `WHATSAPP_APP_SECRET`. Fail → 401. |
| Envelope idempotency | `payloadHash = sha256(rawBody)`; `claimWebhookEvent`. Duplicate already-processed → 200 `{ duplicate: true }`. |
| Normalize | `parseWebhookRawBody` → inbound text/media/location and status events. |
| Persist | Channel → contact → open conversation → `insertInboundMessage` (unique on `wa_message_id`) → update `last_message_at` → optional `autoLinkLead`. |
| Status events | `insertStatusEvent` updates matching outbound message status when found. |

Primary modules: `whatsappWebhookRoutes.ts`, `whatsappEnvelope.ts`, `whatsappSignature.ts`, `whatsappRepository.ts`.

---

## 2. Current official Meta outbound flow

Two HTTP entry points share the same Graph sender (`sendOutboundPlainText`):

| Path | Auth | Idempotency |
|------|------|-------------|
| `POST /api/conversations/:id/messages` | JWT + `canSendOutboundWhatsApp` | None (PR-1) |
| `POST /api/inbox/messages/send` | JWT + inbox RBAC | Required `Idempotency-Key` |

Outbound sequence:

1. Enabled + actor Approved + `crm_leads` permission + outbound config present.
2. Validate plain text (max 4096).
3. Load conversation bundle; authorize actor; channel `phoneNumberId` must match config.
4. Insert outbound row (`queued` → `sending`).
5. **Single** Graph call (`sendWhatsAppTextMessage`) — no retry after Meta response/timeout.
6. Persist `sent` / `failed` / `timeout` (degraded path may return 202 with incomplete persistence).
7. Inbox path completes/fails idempotency and may `autoOpenOnSuccessfulReply`.

**Credential note:** Graph send still reads `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` from **environment** via `readWhatsAppConfig`. Embedded Signup credentials live in `whatsapp_connections` (encrypted) and drive connection UI/status, not yet the send path.

Recipient / channel / phone are never taken from the browser body.

---

## 3. Existing database tables and RPCs

### Tables (PR-1 transport) — `scripts/whatsapp-transport-schema.sql`

- `whatsapp_channels`
- `whatsapp_contacts`
- `whatsapp_conversations`
- `whatsapp_messages`
- `whatsapp_message_status_events`
- `whatsapp_webhook_events`
- `whatsapp_audit_events`

### Tables (PR-2 inbox) — `scripts/whatsapp-inbox-schema.sql`

- `whatsapp_conversation_assignment_events`
- `whatsapp_conversation_status_events`
- `whatsapp_read_watermarks`
- `whatsapp_conversation_crm_links`
- `whatsapp_outbound_idempotency_keys`

### Tables (RC-1.2.4 hardening)

- `whatsapp_connections` (encrypted access token)
- `whatsapp_oauth_states` (CSRF nonces)

### Additive conversation/message columns

- Assignment: `assigned_user_id`, `assigned_at`, `assigned_by`, `lock_version`, `has_failed_message`
- Status: `open | pending | resolved | archived`
- AI: `ai_ownership_state` (`AI_SHADOW | AI_ACTIVE | HUMAN_HANDLING | AI_PAUSED`)
- Messages: `message_type`, media/location columns, `raw_metadata`

### RPCs

| Function | Role |
|----------|------|
| `whatsapp_inbox_list_conversations_by_activity` | Activity keyset list |
| `whatsapp_inbox_list_conversations_delta` | Delta poll |
| `whatsapp_inbox_apply_status_change` | OCC status + audit |
| `whatsapp_inbox_apply_assignment_change` | OCC assignment + audit |
| `whatsapp_oauth_consume_state` | Atomic CSRF consume |

All WhatsApp tables: RLS enabled, no anon/authenticated grants; service-role backend only.

---

## 4. Existing normalized message fields

From `whatsappEnvelope.ts`:

**Inbound (text / message):** `phoneNumberId`, `displayPhoneNumber`, `wabaEntryId`, `waMessageId`, `fromWaId`, `profileName`, `occurredAt`, `rawEvent`, `messageType`, `text` / `textBody`, media fields (`metaMediaId`, `mimeType`, `caption`, `filename`, `sha256`, `voice`), location fields (`latitude`, `longitude`, `address`, `placeName`).

**Status:** `waMessageId`, `status` ∈ `sent | delivered | read | failed`, `statusTimestamp`, `recipientWaId`.

Supported inbound types normalized without crashing: text, image, document, audio/voice, video, location; unknown types become safe `inbound_message` / unsupported handling.

Persisted metadata is minimized (`buildMinimizedMetadata`) — not full Meta payloads and no binary media download in PR-1/PR-2.

---

## 5. Connection and credential storage

| Concern | Location |
|---------|----------|
| Bootstrap / Graph send | Server env: `WHATSAPP_CONVERSATIONS_ENABLED`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_APP_ID`, `WHATSAPP_TOKEN_ENCRYPTION_KEY` |
| Tenant connection row | `whatsapp_connections` via `WhatsAppConnectionRepository`; token AES-256-GCM (`v1:iv:tag:ciphertext`) |
| OAuth CSRF | `whatsapp_oauth_states` (hashed nonce, TTL, single-use consume) |
| Connection mode | Hardcoded `connectionMode: "COEXISTENCE"` on status payloads |
| Status enum | `DISCONNECTED \| CONNECTING \| CONNECTED \| ERROR \| TOKEN_EXPIRED \| WEBHOOK_PENDING` |
| Browser exposure | Masked IDs/phones only; never access token or verify token |

**Embedded Signup (COEXISTENCE):**

- Browser: `launchMetaEmbeddedSignup` → Facebook JS SDK `FB.login`
- Extras (commit `8b1f827`): `featureType: "whatsapp_business_app_onboarding"`, `sessionInfoVersion: "3"`, `setup: {}`, plus OAuth `state`
- Server: `generateEmbeddedSignupState` → `processEmbeddedSignupOnboarding` (code exchange, WABA/phone ownership, `subscribed_apps`, encrypt+upsert)
- Disconnect: Meta revoke then clear local credentials

Env credentials alone do **not** yield `CONNECTED` without a persisted connection record.

---

## 6. Inbox services and routes

Mount: `/api/inbox` with `requireInboxRbac` (Approved + `crm_leads`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/conversations` | Activity list |
| GET | `/conversations/:id` | Detail |
| GET | `/conversations/:id/messages` | Timeline |
| GET | `/delta` | Delta poll |
| POST | `/messages/send` | Outbound (+ Idempotency-Key) |
| POST | `/messages/read`, `/watermark` | Read watermark |
| POST | `/assign`, `/unassign`, `/status` | OCC mutations |
| POST/DELETE | `/crm/link` | Link / unlink |
| POST | `/crm/create-lead` | Create lead |
| GET | `/admin/whatsapp/connection-status` | Connection status |
| POST | `/admin/whatsapp/embedded-signup/state` | CSRF state |
| POST | `/admin/whatsapp/embedded-signup` | Complete onboarding |
| POST | `/admin/whatsapp/disconnect` | Disconnect |
| GET | `/admin/whatsapp/diagnostics` | Diagnostics (redacted) |
| POST | `/admin/whatsapp/test-connection` | Connectivity test |

Service layer: `ConversationService`, `MessageService`, `ReadStateService`, `AssignmentService`, `StatusService`, `CRMLinkService`.

UI: `src/inbox/` (React Query client over authenticated `/api/inbox/*` only).

---

## 7. CRM lead / link behaviour

- Entity types: `lead` | `customer`.
- `CRMLinkService.link` requires a **confirmed** `linkedEntityId` via `normalizeLeadId` (rejects empty, whitespace, `__pending_create_lead__`, and `pending_lead:*` prefixes).
- Create-lead protocol:
  1. Claim exclusivity with `CREATE_LEAD_PENDING_ENTITY_ID`
  2. Call CRM callback
  3. Require real `leadId`
  4. Intermediate `pending_lead:{id}`
  5. Final confirmed id
- Auto-link on inbound (production wiring): duplicate lookup by Pakistan phone forms, then create/link; no claim of success without confirmed entity id.
- Company scope currently fail-closed for non-`DEFAULT_COMPANY_ID` (`"sunchaser"`).

---

## 8. AI shadow / active / human-handoff behaviour

| State | Current behaviour |
|-------|-------------------|
| `AI_SHADOW` (default) | Schema + in-memory default. `AiShadowEngine.evaluateShadow` evaluates offline only when `AI_SHADOW_ENGINE_ENABLED=true`. |
| `AI_ACTIVE` | Enum present; **not wired** to outbound send. |
| `HUMAN_HANDLING` | Set on human assign in the in-memory conversation repository (ownership field). Prevents treating the thread as AI-owned at the data model level. |
| `AI_PAUSED` | Enum only. |

Shadow engine contract: **zero outbound WhatsApp**, **zero CRM mutation**. Not hooked into production webhook persistence today.

**Known gap:** Supabase RPC `whatsapp_inbox_apply_assignment_change` does not currently update `ai_ownership_state`; in-memory path does.

---

## 9. Current security controls

- Webhook on public allowlist only; signature on exact raw Buffer; timing-safe compare.
- Raw-body middleware before `express.json`; non-Buffer POST rejected; body size capped.
- Outbound/inbox: JWT + role/`crm_leads` + Approved; recipient never from client.
- No browser credentials / verify token in UI (contract tests).
- Tokens encrypted at rest; status/diagnostics redact secrets.
- OAuth state CSRF + replay protection; WABA/phone ownership checks on onboarding.
- RLS lockdown on WhatsApp tables; sanitized Graph errors; at-most-once Meta send call.
- Admin-only Embedded Signup / disconnect / diagnostics routes.

---

## 10. Gaps vs planned multi-channel adapter model

1. No channel adapter interface — Meta Graph types and paths are first-class.
2. Dual credential sources — send uses env; connection UI uses `whatsapp_connections`.
3. Provider-specific schema (`wa_message_id`, `phone_number_id`, Meta status values).
4. Envelope idempotency keyed on Meta raw payload hash.
5. AI not integrated into inbound pipeline; `AI_ACTIVE` unused.
6. Human handoff incomplete on Supabase RPC path for `ai_ownership_state`.
7. Single-company placeholder (`DEFAULT_COMPANY_ID`); not multi-tenant isolation.
8. Inbox send transport is a thin Meta wrapper (`createInboxOutboundSendPort`), not a pluggable channel port.
9. Plain-text outbound only (no templates/media outbound in this stack).
10. Legacy CRM WhatsApp helpers outside this transport remain separate.

---

## 11. Components that must remain unchanged

Treat as frozen contracts unless deliberately versioned in a later phase:

- Signature verification on raw Buffer + public path `/api/whatsapp/webhook`
- Webhook claim/idempotency + message `wa_message_id` uniqueness
- Inbox RBAC + no secrets in browser
- Outbound at-most-once Meta call; no recipient from client
- OCC `lock_version` + status/assignment RPCs
- Create-lead pending/confirmed entity ID protocol
- Free-form 24h window semantics
- AES-GCM token format + CSRF consume RPC
- Embedded Signup launch contract: `featureType: "whatsapp_business_app_onboarding"`, `sessionInfoVersion: "3"`, OAuth `state`, status `connectionMode: "COEXISTENCE"`
- AI shadow: zero outbound / zero CRM mutation until explicit active-mode design
- Meta env variable names and webhook URL path

---

## 12. Safe future adapter insertion points

1. **After** `parseWebhookRawBody` / before persist — map provider events into a channel-agnostic message DTO.
2. **`createInboxOutboundSendPort` / `InboxSendPort`** — already injectable; natural multi-provider swap point.
3. **`whatsappInboxServicePorts.ts`** — DI pattern for CRM/assignee; mirror for `MessagingProvider`.
4. **`persistNormalizedEvents` + `autoLinkLead`** — keep CRM side effects above transport.
5. **Connection layer** — generalize status payload beyond Meta COEXISTENCE without changing Meta path behaviour.
6. **Webhook mount** — keep Meta path stable; add sibling providers with their own signature middleware.
7. Prefer wrapping Meta envelope/Graph client behind an adapter boundary rather than rewriting them in place.

---

## Module map (quick reference)

| Area | Path |
|------|------|
| Transport package | `server/whatsappTransport/` |
| AI shadow | `server/whatsappTransport/aiEngine/` |
| Inbox UI | `src/inbox/` |
| Embedded Signup client | `src/inbox/lib/metaEmbeddedSignup.ts` |
| SQL | `scripts/whatsapp-transport-schema.sql`, `scripts/whatsapp-inbox-schema.sql`, `scripts/whatsapp-hardening-rc124.sql`, `scripts/whatsapp-connect-phase1a-2a-migration.sql` |
| Characterization tests | `server/whatsappTransport/unifiedMessagingBaseline.test.ts` |
