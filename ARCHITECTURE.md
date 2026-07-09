# Sunchaser OS — Architecture

**Source of truth for all AI agents working on this repository.**

Sunchaser OS is an integrated operating system for solar energy businesses: sales, projects, finance, field operations, inventory, knowledge, and executive intelligence — delivered as a multi-tenant-ready platform with a clear separation between **platform core** and **industry modules**.

Related docs: [`docs/vision/VISION.md`](docs/vision/VISION.md) · [`ROADMAP.md`](ROADMAP.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)

---

## Vision

Sunchaser OS replaces fragmented spreadsheets, ad-hoc tools, and unsafe shortcuts with a single system where:

1. **Every action is authenticated, authorized, and auditable.**
2. **Business data is scoped by role and ownership** — never exposed wholesale to staff, customers, or AI.
3. **Domain logic lives in explicit modules** with tests, not in routes, UI, or prompt hacks.
4. **AI assists; it does not own business truth.** Deterministic engines produce insights; models explain and recommend.
5. **The platform scales to multi-tenant SaaS** — `companyId` on new modules, tenant isolation designed in from day one.

Deployment today: backend on Render, web client on Vercel, Capacitor path for mobile.

---

## Platform vs Industry Modules

| Layer | What it is | Examples |
|-------|------------|----------|
| **Platform core** | Reusable infrastructure any tenant/industry can use | Security, auth, ownership, AI engine, workflow engine, documents pipeline, permissions |
| **Industry modules** | Solar/CRM domain logic built on the platform | Leads, quotes, projects, invoices, deliveries, inventory SKUs, solar-specific dashboards |
| **Presentation** | UI that consumes APIs — no hidden business rules | `src/components/*`, admin portals, customer portal |

**Rule:** Platform modules must not import industry-specific UI. Industry modules must not bypass platform security or ownership.

---

## Core Modules

### Security (`server/middleware/`, `server/auth/`)

- JWT Bearer authentication (Phase 1A)
- Route policy: public / jwt_only / protected (Phase 1B.1)
- `req.actor` hydration — server is source of truth for role; never trust client-supplied role headers
- Finance route lockdown (Phase 1B.3A)
- Fail closed by default

### Ownership (`server/ownership/`)

- **Customer** — `OwnershipResolver` (Phase 1B.2A)
- **Technician** — `TechnicianOwnershipResolver` (Phase 1B.2B)
- **Sales** — `SalesOwnershipResolver` (Phase 1B.2C)
- **Finance** — `FinanceOwnershipResolver` (Phase 1B.3B)

**Principle:** Ownership resolvers are the only approved way to scope CRM rows. New modules either delegate to them (e.g. Knowledge) or stay standalone with their own deny-by-default permissions (e.g. Inventory).

### AI (`server/ai/`)

| Layer | Path | Status |
|-------|------|--------|
| V1 Chat | `chatRoute.ts`, `chatV1.ts`, providers | Wired to `/api/ai/chat` |
| V2 Safe context | `context/SafeBusinessContext.ts` | Bounded summaries only |
| V3 Prompt builder | `context/BusinessInsightPromptBuilder.ts` | Role-safe prompts |
| V4 Intelligence | `intelligence/BusinessIntelligenceEngine.ts` | Deterministic insights, no LLM |
| Agents & tools | `agents/`, `tools/` | Declarative; permissions enforced |

See [`server/ai/README.md`](server/ai/README.md).

### CRM (application layer)

- Leads, customers, quotations, projects, tickets, deliveries — `dbManager.ts`, route handlers in `server.ts`
- Ownership enforced at route and state-filter level
- Not a separate `server/crm/` package yet; CRM logic lives in DB + routes + ownership resolvers

### Finance (application + ownership)

- Invoices, party ledger, project finance, costing — `*Db.ts` modules
- `FinanceOwnershipResolver` + finance route lockdown
- AI and dashboards receive **aggregated** finance summaries only

### Inventory (`server/inventory/`)

- Pure backend architecture: warehouses, bins, SKUs, ledger, valuation, serial/batch, PO/GRN
- In-memory repository; **no routes wired yet**
- Standalone permissions — does not import ownership resolvers
- `npm run test:inventory-engine`

### Workflow (`server/workflow/`)

- Deterministic workflow engine: triggers, conditions, approvals, delays, escalations, audit log
- `npm run test:workflow-engine`
- Not wired to production CRM events yet

### Knowledge (`server/knowledge/`)

- Document taxonomy, permissions (delegates to ownership), in-memory repository
- Indexer/search are stubs — architecture only
- Mock UI behind `VITE_ENABLE_KNOWLEDGE_MOCK_UI` (default off)
- See [`server/knowledge/README.md`](server/knowledge/README.md)

### Documents (`server/documents/`)

- Upload, versioning, checksum, virus scan stub, OCR/embedding queues, event bus
- Pipeline stage toward Knowledge Platform
- `npm run test:documents-pipeline`

### Automation (`server/automation/`)

- CRM event-driven rules: triggers, conditions, actions, queue, history
- Pure engine; **no routes wired yet**
- `npm run test:automation-engine`

---

## Ownership & Security Principles

1. **Deny by default** — Every new permission module starts with explicit allow lists.
2. **No ownership bypass** — Admin/Director/Super Admin bypass is intentional and documented per resolver; do not add silent bypasses elsewhere.
3. **Staff vs customer** — Customers never receive staff APIs; staff never impersonate customers without audit.
4. **Actor from JWT only** — `req.actor` is hydrated server-side; reject `body.role`, `X-Sunchaser-*` spoofing on protected routes.
5. **Finance is locked down** — Accounts roles, invoice PDFs, and finance dashboards use dedicated resolvers and lockdown middleware.
6. **Module-local permissions** — Inventory and Automation use standalone permission modules when ownership resolvers do not apply.

---

## Module Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  Presentation (src/) — UI only, calls APIs                  │
├─────────────────────────────────────────────────────────────┤
│  Routes (server.ts) — auth middleware, delegate to modules  │
├──────────────┬──────────────┬──────────────┬──────────────┤
│  Ownership   │  AI Engine   │  Workflow    │  Documents   │
│  resolvers   │  (no CRM     │  Engine      │  Pipeline    │
│              │   logic)     │              │              │
├──────────────┴──────────────┴──────────────┴──────────────┤
│  Industry: CRM DB modules · Finance DB · Inventory Engine   │
│            · Automation Engine · Knowledge Repository       │
├─────────────────────────────────────────────────────────────┤
│  Data: PostgreSQL/Supabase · local JSON fallback (dev)      │
└─────────────────────────────────────────────────────────────┘
```

**Allowed dependencies:**
- Routes → middleware → ownership / domain modules
- Knowledge → ownership resolvers
- AI context → `SafeBusinessContext` (bounded summaries)
- Documents → Knowledge (stage)

**Forbidden:**
- `server/inventory/` → `server/ownership/` (unless explicitly redesigned)
- AI providers → raw `dbManager` queries
- UI → direct DB access
- Platform modules → `src/` components

---

## No Raw Data Leakage Rule

Applies to **AI**, **dashboards**, **logs**, **activity feeds**, and **API responses**.

| Do | Don't |
|----|-------|
| Pass `SafeBusinessSummary` / aggregated counts to AI | Pass raw lead rows, invoice line items, or `activityLogs.details` |
| Sanitize enterprise dashboard activity (`sanitizeEnterpriseActivityLog`) | Render PII in overview widgets |
| Use ownership-filtered state (`filterAppStateForActor`) | Return full `GET /api/state` to sales staff |
| Log action types and entity IDs | Log customer emails, phone numbers, or free-text notes in telemetry |

**AI context path:** `SafeBusinessContext` → optional `BusinessInsightPromptBuilder` → provider. Tools disabled in V1 chat unless explicitly enabled in future gated releases.

---

## Multi-Tenant SaaS Direction

Current state: single-company deployment with `companyId` fields on new architecture modules.

Future requirements (design for now, implement when wiring routes):

- `companyId` on all tenant-scoped entities
- Repository queries always filter by `companyId`
- Actor carries `companyId` when multi-tenant auth ships
- No cross-tenant serial numbers, events, or ledger keys
- Per-tenant feature flags and billing hooks at platform layer

---

## Extension Points

| Extension | How to extend |
|-----------|----------------|
| AI agent | Add `server/ai/agents/*.ts` + prompt + `ToolSchemas` |
| AI tool | Register in `AIToolRegistry` with `requiredRoles` |
| Workflow step | `WorkflowDefinition` steps + `ActionHandlerRegistry` |
| Automation trigger/action | Add to `AutomationTrigger.ts` / `AutomationAction.ts` + tests |
| Knowledge collection | `KnowledgeCollections.ts` + permission domain mapping |
| Ownership domain | New resolver in `server/ownership/` + phase tests |
| Inventory movement | `StockMovement.ts` + ledger append + engine method |

New architecture modules follow the pattern: **pure TypeScript → in-memory repo → 100+ tests → npm script → routes last**.

---

## AI Engine Principles

1. **Provider-agnostic** — Anthropic, OpenAI, Gemini via `AIProvider` interface.
2. **Permissions before prompts** — `canAccess(actor, agent)` runs before any model call.
3. **Deterministic intelligence** — `BusinessIntelligenceEngine` uses `SafeBusinessSummary` only; fixed `generatedAt` when `options.now` omitted.
4. **No training on customer data** — Context is ephemeral per request unless explicitly stored in conversation memory.
5. **Tools are opt-in** — V1 chat ships with tools disabled; tool execution goes through `ToolExecutor` + permission checks.
6. **Cost and audit** — `AILogger` records provider, model, usage; no prompt content in production logs by default.

---

## Testing Rules

| Suite | Command | When required |
|-------|---------|---------------|
| Build | `npm run build` | Every change touching `server.ts`, `src/`, or modules |
| Phase 1B.1 | `npm run test:phase-1b1` | Auth, AI, knowledge, dashboard changes |
| Phase 1B.2A–2C | `npm run test:phase-1b2a` … `2c` | Ownership changes |
| Phase 1B.3A–3B | `npm run test:phase-1b3a` … `3b` | Finance changes |
| Inventory | `npm run test:inventory-engine` | `server/inventory/` |
| Automation | `npm run test:automation-engine` | `server/automation/` |
| Workflow | `npm run test:workflow-engine` | `server/workflow/` |
| Documents | `npm run test:documents-pipeline` | `server/documents/` |

**Test quality:**
- Deterministic — no `Date.now()` or `Math.random()` without injection/fixture
- Behavior-focused — not trivial type assertions
- Permission denial cases required for every new permission module
- Regression before merge — all applicable suites green

---

## Directory Quick Reference

```
server/
  middleware/     Auth, route policy, finance lockdown
  ownership/      Customer, sales, technician, finance resolvers
  ai/             AI engine, agents, intelligence, safe context
  knowledge/      Knowledge platform backend (V5)
  documents/      Document processing pipeline
  workflow/       Workflow engine
  inventory/      Inventory engine
  automation/     CRM automation engine
src/              React UI (Vite)
docs/             Phase specs, security, changelog (human-oriented detail)
```

---

*Last updated: 2026-07-08. When this document conflicts with code, code wins until this document is updated — agents must flag drift.*
