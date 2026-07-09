# Sunchaser OS — Roadmap

**Source of truth for product and engineering priorities.**  
Human-oriented phase detail: [`docs/roadmap/ROADMAP.md`](docs/roadmap/ROADMAP.md) · [`docs/backlog/PRODUCT-BACKLOG.md`](docs/backlog/PRODUCT-BACKLOG.md)

---

## Completed Foundation

### Phase 1A — Security Foundation ✅

- JWT access tokens, Bearer auth, `/api/auth/me`
- Login rate limiting, production `JWT_SECRET` validation
- High-risk route protection

### Phase 1B — Authorization & Ownership ✅

| Phase | Delivered |
|-------|-----------|
| **1B.1** | Centralized auth middleware, `req.actor`, route policy, fail-closed defaults, AI chat auth |
| **1B.2A** | Customer ownership (`OwnershipResolver`), portal isolation |
| **1B.2B** | Technician ownership, `/api/technical/jobs/me` |
| **1B.2C** | Sales ownership, scoped `GET /api/state` |
| **1B.3A** | Finance route lockdown middleware |
| **1B.3B** | Finance ownership resolver, invoice/delivery guards |

**Status:** Phase 1B security and ownership **complete**. All `test:phase-1b*` suites green.

---

### AI Platform ✅

| Version | Capability | Location |
|---------|------------|----------|
| **V1** | Provider-agnostic chat, `/api/ai/chat`, JWT + role gates | `server/ai/chatV1.ts` |
| **V2** | `SafeBusinessContext` — bounded role-scoped summaries | `server/ai/context/` |
| **V3** | `BusinessInsightPromptBuilder` — safe prompt assembly | `server/ai/context/` |
| **V4** | `BusinessIntelligenceEngine` — deterministic insights, health score | `server/ai/intelligence/` |

Agents: CEO, Sales, Finance, Operations, Support, Procurement.

---

### Platform Architecture Modules

| Module | Backend status | Routes | UI |
|--------|----------------|--------|-----|
| **Knowledge** (V5) | ✅ Repository, permissions, collections, 150+ tests | ❌ | Mock only (`VITE_ENABLE_KNOWLEDGE_MOCK_UI`) |
| **Documents** | ✅ Pipeline, OCR/embedding queues (stubs), tests | Partial | — |
| **Workflow** | ✅ Engine, approvals, delays, audit, tests | ❌ | — |
| **Inventory** | ✅ Engine, ledger, serial uniqueness, 316+ tests | ❌ | — |
| **Automation** | ✅ Rules, triggers, queue, history, 342+ tests | ❌ | — |

### CRM / Finance (production)

- Leads, quotes, projects, customers, tickets, deliveries — **live** with ownership
- Invoices, party ledger, finance dashboard — **live** with finance ownership
- Enterprise Admin Overview dashboard — **live** (sanitized activity, no PII leakage)

---

## Next Visible Product Priorities

Ordered by user-facing impact after security foundation:

| # | Initiative | Description | Depends on |
|---|------------|-------------|------------|
| 1 | **AI Quote Builder** | AI-assisted quotation drafting with CRM context, PDF export, approval flow | AI V1–V4, sales ownership, quote APIs |
| 2 | **AI Executive Dashboard** | CEO/Director view powered by `BusinessIntelligenceEngine` + enterprise UI | V4 intelligence, dashboard component |
| 3 | **Global Search** | Unified search across leads, projects, documents, knowledge | Knowledge indexer, documents pipeline |
| 4 | **Knowledge Center** | Production knowledge UI wired to `server/knowledge` + documents | V5 backend, routes, permissions |
| 5 | **Mobile / PWA** | Field technician and sales mobile experience | Capacitor, auth, technician ownership APIs |

---

## 3-Month Roadmap (Q3 2026)

### Month 1 — Quote & Executive Intelligence

- [ ] AI Quote Builder MVP: template + line items + safe CRM context injection
- [ ] Wire `BusinessIntelligenceEngine` to Executive Dashboard (replace static mock metrics)
- [ ] Quote PDF pipeline audit (ownership on preview/download)
- [ ] Inventory engine route wiring design doc (no implementation required for MVP)

### Month 2 — Search & Knowledge

- [ ] Global Search API: unified query endpoint, ownership-filtered results
- [ ] Knowledge Center production UI (replace mock behind feature flag)
- [ ] Documents → Knowledge indexing path (OCR queue integration)
- [ ] Automation engine: wire `lead_created` + `quote_accepted` triggers to CRM events

### Month 3 — Mobile & Automation

- [ ] PWA manifest, offline shell, technician job list mobile UX
- [ ] Capacitor Android beta (field photo upload, job status)
- [ ] Automation rules admin UI (read-only rules list first)
- [ ] Inventory GRN flow UI (warehouse manager role)

---

## 12-Month Roadmap (2026–2027)

| Quarter | Theme | Milestones |
|---------|-------|------------|
| **Q3 2026** | Intelligent sales | AI Quote Builder, Executive Dashboard, search MVP |
| **Q4 2026** | Operations platform | Knowledge Center live, workflow approvals on quotes/projects, inventory routes |
| **Q1 2027** | Field & automation | Mobile GA, automation rules production, delivery ↔ inventory linkage |
| **Q2 2027** | Multi-tenant SaaS prep | `companyId` auth, tenant provisioning, billing hooks, per-tenant feature flags |

---

## Release Milestones

| Milestone | Target | Exit criteria |
|-----------|--------|---------------|
| **M1 — Secure CRM** | Shipped | Phase 1A + 1B complete |
| **M2 — AI Assistant** | Shipped | V1 chat + safe context in production |
| **M3 — AI Intelligence** | Shipped | V4 deterministic insights + tests |
| **M4 — Architecture engines** | Shipped | Knowledge, workflow, inventory, automation backends + test suites |
| **M5 — AI Quote Builder** | Q3 2026 | End-to-end quote draft → PDF → ownership checks |
| **M6 — Executive OS** | Q3 2026 | Live BI dashboard for Admin/Director |
| **M7 — Knowledge Center** | Q4 2026 | Production UI + document indexing |
| **M8 — Mobile Field** | Q1 2027 | Technician PWA/Capacitor in field use |
| **M9 — SaaS Platform** | Q2 2027 | Multi-tenant auth + onboarding |

---

## Explicitly Not Started (do not assume shipped)

- FIFO inventory costing (architecture only)
- Supplier payments / accounting integration
- WhatsApp/email automation delivery (stubs only)
- Knowledge embeddings / vector search
- Multi-tenant production auth

---

## How Agents Should Use This Document

1. Check **Completed Foundation** before proposing work already done.
2. Align new features with **Next Visible Product Priorities** unless the user overrides.
3. Architecture-only backend work follows **extension points** in [`ARCHITECTURE.md`](ARCHITECTURE.md) — routes and UI come later.
4. Update this file when a milestone ships — not when code is merely drafted.

---

*Last updated: 2026-07-08*
