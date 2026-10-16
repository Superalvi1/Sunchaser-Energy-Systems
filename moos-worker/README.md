# Moos WhatsApp worker

Separate AI sales-agent worker for Sunchaser Energy Systems. Receives signed
inbound events from the CRM (which keeps the only Meta webhook), decides, and
emits typed **actions**. The worker holds **no Meta credentials** — every send
(text, native PDF document), draft and handoff executes server-side in the CRM
via the `/api/moos/*` endpoints, which re-validate ownership, the 24h window,
quote approval/expiry and idempotency on every call.

## Architecture

```
Meta → CRM /api/whatsapp/webhook (verify → record → dedupe)
     → signed relay POST /webhooks/crm (HMAC, this worker)
     → Agent decides (EN/UR/Roman-Urdu rules engine)
     → CRM actions: /send-text, /send-approved-pdf, /custom-quote-draft, /handoff
     → CRM sends via Meta, records provider ids + delivery states
```

## What the worker does

- **Approved quotation matching** — sizes 6/8/10/12/15/20 kW, on-grid vs hybrid
  disambiguation (asks when the library holds both variants), multiple sizes in
  order. Expired/missing/ambiguous → holding reply + human handoff. Never sends.
- **Native PDF documents** — via `POST /api/moos/send-approved-pdf` (the CRM
  fetches bytes from object storage, uploads to Meta, sends `type: document`).
- **Custom quotes** — incremental collection (name → city → size → battery →
  structure → phase), then the worker **recommends one compatible package
  from the CRM catalog** (smallest adequate inverter, highest-watt panel,
  bundled/voltage-matched battery) and the customer only confirms or declines —
  no manual equipment picking. `POST /api/moos/custom-quote-draft` (bound to the
  verified `conversationId` + inbound `wamid`; recipient derived server-side)
  runs the real `calculateAgentQuote` Smart Quote engine server-side. Draft only —
  a holding reply + handoff follows; staff approval is required before any
  customer send.
- **Conversation intelligence** — pending-clarification state per phone, FAQ
  answers from the reviewed `faqs.json` (uncertain → handoff), optional LLM
  intent hook (`MOOS_DECISION_URL`, default off).
- **Human handoff** — complaints, billing, warranty, faults, human requests,
  off-grid, unknown messages, library/CRM outages, draft validation failures.
- **Duplicate prevention** — wamid dedup on ingest, per-phone latest-message
  preflight, atomic send-key reserve, CRM-side idempotency keys
  (`moos:<key>`), ownership re-check immediately before every send.

## Kill switches

- `ENABLE_AUTOSEND=false` (default) — worker processes but never sends.
- CRM `MOOS_ENABLED=false` (default) — every mutating `/api/moos/*` endpoint
  returns 503. Production stays inert until explicitly enabled.
- The legacy CRM sales agent (`whatsapp-agent/settings.json → enabled`) is a
  separate switch and must remain `false` while Moos is active.

## Run

```bash
npm install
node --test tests/*.mjs   # 30 tests
npm start
```

Apply `schema.sql` to the worker Postgres database first.

## Environment

See `.env.example`. Required: `DATABASE_URL`, `RELAY_SECRET`,
`MOOS_PHONE_NUMBER_ID` (non-secret binding), `CRM_BASE_URL`,
`MOOS_SERVICE_TOKEN`, `ENABLE_AUTOSEND`. Optional: `MOOS_DECISION_URL`,
`FAQ_FILE` (default `./faqs.json` — Allauddin must review before any send).
