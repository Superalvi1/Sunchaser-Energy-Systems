# WhatsApp sales agent

Administrators configure the agent in **WhatsApp Connection → AI sales agent**.
It is disabled by default. Staff can take over, pause, or resume the agent in a
conversation. Assigned, resolved, archived, historical and expired-window threads
are excluded. A staff reply switches ownership to HUMAN_HANDLING before sending.

Choose Gemini, OpenAI, Grok or Claude in the agent panel and enter the exact
provider model ID. Production needs the matching GEMINI_API_KEY, OPENAI_API_KEY,
XAI_API_KEY or ANTHROPIC_API_KEY in Railway service variables, plus existing
WhatsApp inbox and Railway object storage configuration. Legacy configurations
can use WHATSAPP_SALES_AI_PROVIDER (default gemini) and WHATSAPP_SALES_AI_MODEL;
saved per-agent selections take precedence. Enter secrets in Railway service variables. No secrets are stored
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

## Provider connection checks

The administrator-only Test AI connection action uses one provider request with
a public sample enquiry and no customer history. It does not send WhatsApp
messages or enable the agent. The key is server-only. Fixed provider endpoints,
explicit model IDs, structured decisions, abort timeouts and response validation
apply to all providers. There are no automatic retries or paid-provider fallbacks.
The connection check validates a sample response, not a billing entitlement or
a monthly dollar cap. Provider errors are sanitized.

## Subscription access findings (6 October 2026, Pakistan time)

The CRM currently supports API-key connections only. A subscription login is not
implemented and should not be described as activated or free.

- OpenAI's ChatGPT plan-usage documentation directs remotely hosted apps to its
  partner interest process: https://developers.openai.com/siwc/token-sharing-open-source
- Anthropic directs developers building applications for others to API authentication:
  https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account
- xAI's account-specific API FAQ explicitly states that Grok and developer API
  billing are separate: https://docs.x.ai/developers/faq/accounts
  The general Grok FAQ lists API in its weekly usage breakdown, which does not
  establish that arbitrary external CRM requests are covered by a subscription.

### OpenAI partner request draft

Applicant: Sunchaser Energy Systems
Product: Sunchaser CRM, https://crm.sunchaserenergy.co
Source: https://github.com/Superalvi1/Sunchaser-Energy-Systems
Use case: A remotely hosted solar CRM with an administrator-managed WhatsApp sales
agent. The agent answers from approved company information, shares reviewed package
PDFs, and creates deterministic solar estimates only after customer confirmation.
Staff can take over or pause individual conversations.
Request: Confirm eligibility for ChatGPT plan usage in this remotely hosted
customer-support workflow, including whether an administrator's authorized plan
may cover inbound customer requests, or whether each user must authorize their
own plan. Clarify approved OAuth scopes, permitted deployment architecture, usage
limits, and fallback billing requirements.

This draft has not been submitted. No partner client ID, provider approval or
subscription entitlement has been obtained. Do not use personal chat cookies or
subscription tokens to impersonate native provider applications.
