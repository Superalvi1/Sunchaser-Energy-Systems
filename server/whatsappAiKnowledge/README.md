# WhatsApp AI Knowledge & Answer Engine (AI-02)

Isolated, **read-only** knowledge retrieval layer for customer-query answer drafts.

This module is designed to plug into AI-01 later. It does **not** send WhatsApp
messages, write CRM, call production Supabase, or browse the web.

## Knowledge model

| Concept | Description |
|--------|-------------|
| `ApprovedKnowledgeSourceType` | Allow-listed origins (`solar_package`, `pricing_approved`, `faq_cms`, …) |
| `KnowledgeRecord` | Tenant-scoped approved fact with freshness metadata |
| `KnowledgeAnswerFact` | Retrieved fact with source id/title, freshness, confidence |
| `KnowledgeAnswerDraft` | Disposition + facts + gaps + conflicts + safe reply hints |

### Freshness

- Every priced record carries `publishedAt` + `maxAgeHours` (default **36h**, aligned with marketplace `staleness_hours`).
- **Authoritative price timestamp** is `price.publishedAt` (must match `record.publishedAt` at ingest). Price quoting never trusts a newer record timestamp over a stale price payload.
- `price.sourceId` / `price.sourceTitle` must match the record id/title at ingest.
- `evaluateFreshness` / `evaluatePriceFreshness` → `current` \| `stale` \| `unknown` \| `missing_timestamp`.
- **Prices may only be quoted** when source type is price-eligible (`pricing_approved` / `solar_package`) **and** price freshness is `current`.
- Stale prices are omitted with an explicit warning; embedded numeric price copy in title/body is prohibited at ingest **regardless of `containsPrice`** (no false non-price bypass) and stripped when omitting stale prices. Currency markers honor common separators (`PKR-900000`, `Rs.900000`, `price-900000`, suffix `PKR`). Technical wattage and validated hyphenated model tokens remain allowed — arbitrary letter/hyphen adjacency is not enough to escape.
- Ingest validates source types, categories, IDs, timestamps, priority, maxAgeHours, and price payloads at runtime (not TypeScript-only). Stored records are deep-copied and deeply frozen.

### Retrieval / ranking

1. Hard **tenant isolation**
2. Deterministic **category classification** (keyword map; unsafe engineering first)
3. Rank by category overlap → keyword overlap → source priority → fresher `publishedAt`
4. Resolve conflicting current prices by keeping the higher-ranked source
5. Compose disposition: `answer` \| `partial` \| `escalate_human` \| `unavailable`

No AI generation and no external web at runtime.

## Supported query categories

`solar_packages`, `on_grid_hybrid`, `batteries`, `panels`, `inverters`, `warranty`,
`installation_process`, `after_sales_support`, `complaints`, `quotation_requirements`,
`net_metering_general`, `human_handover`, plus `unsafe_engineering` / `unknown`.

Missing knowledge → `information unavailable—ask human`.

## Privacy / security

- No full customer message in indexes/logs — only `queryFingerprint`
- `queryFingerprint` is an HMAC-SHA256 digest requiring `WHATSAPP_AI_KNOWLEDGE_FINGERPRINT_SECRET`; without the secret it returns `qfp_unconfigured` (no weak unsalted digest of query content)
- PII redaction on ingest and fingerprints
- Prompt-injection phrases in CMS/knowledge bodies are sanitized
- Fixtures contain **no** customer PII
- `writeCrm()` throws — CRM writes forbidden
- Does not import WhatsApp session/outbound transport modules

## Usage (AI-01 plug-in)

```ts
import { createFixtureKnowledgeEngine, fixtureAsOfIso } from "./whatsappAiKnowledge/index.ts";

const engine = createFixtureKnowledgeEngine();
const draft = engine.retrieveAnswerDraft({
  tenantId: "tenant_sunchaser_demo",
  queryText: "What is the warranty?",
  asOfIso: fixtureAsOfIso(),
});
// Inject draft.safeReplyHints / draft.facts into AI-01 prompts only.
```

## Tests

```bash
npm run test:whatsapp-ai-knowledge
```

## Explicit non-goals

- Outbound WhatsApp messaging
- Production Supabase
- Extending `server/knowledge` (enterprise document platform — separate concern)
- Inventing prices, warranties, savings, technical limits, or government rules
