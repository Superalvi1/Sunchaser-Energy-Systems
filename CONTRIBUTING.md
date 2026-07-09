# Contributing to Sunchaser OS

**Source of truth for humans and AI agents.**  
Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md) · Roadmap: [`ROADMAP.md`](ROADMAP.md)

---

## AI Agent Workflow

Sunchaser OS uses a multi-agent development model. Each agent has a defined role — do not blur responsibilities.

| Agent | Role | Responsibility |
|-------|------|----------------|
| **ChatGPT** | CTO / Product Architect | Requirements, phase specs, acceptance criteria, roadmap priorities |
| **Claude Code** | Implementation | Write code, tests, run builds, produce rollback plans |
| **Codex** | Audit | Security review, edge cases, regression risks, correctness audit |
| **Antigravity** | Architecture Review | Module boundaries, ownership compliance, platform vs industry separation |
| **Cursor** | Frontend / UI | React components, styling, client-side wiring — no backend business logic |

### Typical flow

```
ChatGPT (spec) → Claude Code (implement + test) → Codex (audit)
                                              → Antigravity (architecture modules only)
                                              → Cursor (UI, if applicable)
```

1. **Read** `ARCHITECTURE.md` and `ROADMAP.md` before any non-trivial change.
2. **Implement** with minimal scope — match existing conventions in the target module.
3. **Test** — run all applicable suites (see Required Gates).
4. **Audit** — Codex findings must be resolved or explicitly accepted by the user.
5. **Document** — return files changed, architecture notes, tests run, rollback plan.

---

## Required Gates

Every implementation PR or agent session must pass applicable gates before claiming complete.

| Gate | Command / action | Required when |
|------|------------------|---------------|
| **Build** | `npm run build` | Any TS/TSX change |
| **Phase 1B regression** | `npm run test:phase-1b1` through `test:phase-1b3b` | Touching auth, ownership, finance, AI context, knowledge |
| **Module tests** | `test:inventory-engine`, `test:automation-engine`, `test:workflow-engine`, `test:documents-pipeline` | Touching respective `server/*` module |
| **Codex audit** | Codex review of diff | All non-trivial backend changes |
| **Antigravity audit** | Architecture review | New modules, ownership changes, AI context, cross-module wiring |

**Do not mark work complete with failing gates.** Fix or report blockers explicitly.

---

## Coding Standards

1. **Minimal diff** — Solve the stated problem only. No drive-by refactors.
2. **Match conventions** — Read surrounding files for naming, imports (`.ts` suffix), error types, test style (`check()` / `PASS:` pattern).
3. **Pure architecture first** — New domain modules: TypeScript only → in-memory repo → tests → npm script → routes last.
4. **Deterministic** — Use `INVENTORY_DEFAULT_TIMESTAMP` / fixed clocks in tests; inject `now` where needed.
5. **Explicit types** — No `any` in new code; prefer discriminated unions for result types.
6. **Comments** — Only for non-obvious business rules; code should be self-explanatory.
7. **No dead code** — Do not leave unused exports, commented blocks, or duplicate helpers.

---

## Security Rules

1. **No unsafe auth shortcuts** — Never trust `body.role`, query params, or `X-Sunchaser-*` headers for authorization on protected routes. Use `req.actor` from JWT hydration.
2. **Fail closed** — Missing actor → 401. Wrong role → 403. No silent fallbacks to admin access.
3. **Ownership resolvers are mandatory** for CRM row access — do not query DB without scoping.
4. **Finance lockdown** — Finance routes use `FinanceOwnershipResolver` and lockdown middleware; do not add finance bypass paths.
5. **Customer isolation** — Customer actors only access `customerId`-scoped resources.
6. **Secrets server-side** — `JWT_SECRET`, API keys, provider tokens never in `src/` or client bundle.
7. **New permission modules** — Start deny-by-default (see `InventoryPermissions`, `AutomationPermissions`).

---

## Test Requirements

| Rule | Detail |
|------|--------|
| **New architecture module** | 100+ deterministic tests minimum (inventory: 300+, automation: 300+) |
| **Permission module** | Deny cases for customer, unauthenticated, wrong role, and explicit-allow cases |
| **Ownership change** | Add cases to relevant `test:phase-1b2*` / `test:phase-1b3*` suite |
| **AI context change** | `safeBusinessContext.test.ts`, `businessInsightPrompt.test.ts`, intelligence tests |
| **Bug fix** | Regression test that fails without the fix |
| **No flaky tests** | No network, no real LLM calls, no `Math.random()` without fixture |

Run the narrowest suite that covers your change, then full regression before handoff.

---

## Rollback Requirement

Every agent deliverable must include a **rollback plan**:

1. List files created or modified.
2. State whether `package.json` scripts changed.
3. Provide revert steps: `git checkout -- <paths>` or delete new directories.
4. Note data migrations if any (usually none for architecture-only work).

Example:

```
Rollback: Delete server/foo/, remove test:foo-engine from package.json.
No DB changes. No route changes.
```

---

## Prohibited Patterns

| Pattern | Why |
|---------|-----|
| **Hidden business logic in UI** | `src/` displays state; rules live in `server/` |
| **Raw PII in AI context** | Use `SafeBusinessContext` only |
| **Raw activity log details in dashboards** | Sanitize via `sanitizeEnterpriseActivityLog` |
| **Ownership bypass in new modules** | Delegate to resolvers or standalone deny-by-default permissions |
| **Routes before engine tests** | Architecture modules must be test-complete first |
| **External services in architecture phase** | No live email, WhatsApp, webhooks, embeddings until explicitly scoped |
| **Commits without user request** | Only commit when the user asks |

---

## Module-Specific Notes

### AI (`server/ai/`)

- Tools disabled in V1 production chat unless explicitly enabled.
- `BusinessIntelligenceEngine` must remain deterministic without `options.now` injection surprises.
- Never pass raw CRM rows to providers.

### Knowledge (`server/knowledge/`)

- Permissions **must** use ownership resolvers — never bypass.
- Mock UI (`KnowledgeStaff`, `knowledgeMock`) is not production; keep behind feature flag.

### Inventory (`server/inventory/`)

- Standalone permissions — **do not** import `server/ownership/`.
- Serial numbers globally unique per `companyId` (normalized).
- Event IDs unique in repository (`DuplicateInventoryEventError`).

### Automation (`server/automation/`)

- Queue actions (email, WhatsApp, webhook) are stubs — do not wire external APIs without spec.
- Standalone permissions — no ownership bypass.

---

## Documentation Updates

When shipping a phase or milestone:

1. Update root `ROADMAP.md` milestone status.
2. Add phase spec under `docs/phases/` if human-oriented detail is needed.
3. Update module `README.md` in `server/<module>/` for scope boundaries.
4. Keep root `ARCHITECTURE.md` in sync with module boundaries.

Root docs (`ARCHITECTURE.md`, `ROADMAP.md`, `CONTRIBUTING.md`) are the **AI agent source of truth**. `docs/` is supplementary detail for humans.

---

## Questions & Escalation

- **Ambiguous ownership** → Read `server/ownership/*.ts` and phase tests; do not guess.
- **New role permissions** → Propose in spec; implement deny-by-default first.
- **Roadmap conflict** → User instruction overrides `ROADMAP.md` for the current task only; flag the drift.

---

*Last updated: 2026-07-08*
