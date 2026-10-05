# WhatsApp sales agent

Administrators configure the agent in **WhatsApp Connection → AI sales agent**.
It is disabled by default. Staff can take over, pause, or resume the agent in a
conversation. Assigned, resolved, archived, historical and expired-window threads
are excluded. A staff reply switches ownership to HUMAN_HANDLING before sending.

Production needs GEMINI_API_KEY and an explicitly chosen supported Gemini model
in WHATSAPP_SALES_AI_MODEL, plus existing WhatsApp inbox and Railway object storage
configuration. Enter secrets in Railway service variables. No secrets are stored
in agent settings or exposed in the UI. Save settings as an approved administrator
so outbound authorization can be rechecked against that account on every batch.
An approved admin account and a working Meta sender for the conversation are also
required; the agent cannot invent a destination or select another sender number.

Add approved company facts and reviewed reusable package PDFs (10 MB maximum),
including equipment descriptions and an expiry date. PDFs are shareable only while
approved and unexpired. Do not approve another customer's personalized document for
this reusable library. The agent shares signed PDF download links in WhatsApp.

Automatic estimates use the public Smart Quote catalogue and calculator. No LLM
prices or discounts are accepted. The agent gathers equipment choices and client
name/city, then the server sends an equipment/standard-allowances summary. A separate
explicit affirmative within 30 minutes is required to generate a quote. Changes
restart confirmation. Generated quotes use the conversation phone, create a Smart
Quote CRM lead with the full BOQ snapshot, and archive the generated proposal PDF.
They are estimates pending site survey, not approved engineering designs.

Jobs and execution claims use existing WhatsApp idempotency records. A run is
claimed once across replicas. An uncertain send/crashed execution is not replayed;
its conversation is handed to staff. Older incoming messages are skipped when a
newer incoming message exists, and ownership, settings revision, latest message,
manual replies and the 24-hour window are rechecked before sending. The daily
budget counts execution claims, including failures. Across concurrent replicas the
budget is approximate; it is not a billing guarantee.

Settings use conditional S3 writes and revisions; concurrent changes return a
visible conflict. Provider/configuration or storage failures do not silently enable
sending. Complaints, account payments, unsupported requests, prompt injection and
requests for a person hand over to staff. Audit events record state/reason, not
client message contents or credentials. The older draft-only AI remains separate.

Validation: `npm run test:whatsapp-sales-agent`, existing WhatsApp webhook/inbox
regressions, Vite build and server bundle. A real provider/Meta round trip must be
verified after production credentials and model are configured.
