# Product Backlog

Master planning document for the Sunchaser Energy CRM.

---

## Legend

**Status**

- Completed
- In Progress
- Planned
- Blocked

**Priority**

- Critical
- High
- Medium
- Low

**Complexity**

- Small
- Medium
- Large
- Epic

**Version Target** — Release or milestone label when the work is expected to ship.

**Dependencies** — Other phases, systems, or decisions that must be in place first.

---

## Completed

### Phase 1A — Security Foundation

| Item | Status |
|------|--------|
| JWT Authentication | Completed |
| Login Rate Limiting | Completed |
| JWT Session Restore | Completed |
| Protected Core Routes | Completed |
| Documentation | Completed |

**Commit:** `39ad363`  
**Documentation:** [PHASE-1A-Security-Foundation.md](../phases/PHASE-1A-Security-Foundation.md)

---

### Phase 1B.1 — Authorization Foundation

| Item | Status |
|------|--------|
| Authorization Foundation | Completed |
| `req.actor` | Completed |
| Server-side Actor Hydration | Completed |
| Public Route Allowlist | Completed |
| Fail Closed Authorization | Completed |
| Frontend Bearer Migration | Completed |
| Documentation | Completed |

**Commit:** `480f69c`  
**Documentation:** [PHASE-1B1-Authorization-Foundation.md](../phases/PHASE-1B1-Authorization-Foundation.md)

---

### Phase 1B.2A — Customer Ownership

| Item | Status |
|------|--------|
| Centralized OwnershipResolver | Completed |
| Customer resource ownership (8 types) | Completed |
| Customer JWT route isolation | Completed |
| Staff actor helper (`resolveStaffActor`) | Completed |
| Portal lead lookup scoped to customerId | Completed |
| Codex audit fixes (3 critical) | Completed |
| Documentation | Pending (release prep) |

**Commit:** _Pending_  
**Documentation:** _PHASE-1B2A-Customer-Ownership.md (to be created)_

---

### Phase 1B.2B — Technician Ownership

| Item | Status |
|------|--------|
| Centralized TechnicianOwnershipResolver | Completed |
| Technical job ownership (user id) | Completed |
| Service request / support ticket ownership | Completed |
| Warranty visit ownership | Completed |
| Project delivery ownership | Completed |
| Completion workflow ownership | Completed |
| Authoritative `/api/technical/jobs/me` filter | Completed |
| Admin / Director / Super Admin override | Completed |
| Legacy name fallback (transitional) | Completed |
| Unit tests (`test:phase-1b2b`) | Completed |
| Documentation | Pending (release prep) |

**Commit:** _Pending_  
**Documentation:** _PHASE-1B2B-Technician-Ownership.md (to be created)_

---

### Phase 1B.2C — Sales Ownership

| Item | Status |
|------|--------|
| Centralized SalesOwnershipResolver | Completed |
| Durable `assigned_sales_user_id` enforcement | Completed |
| `guardSalesOwnedResource` route guards | Completed |
| `GET /api/state` scoped for sales staff | Completed |
| Lead / quote / project mutation ownership | Completed |
| Customer admin routes sales-scoped | Completed |
| Manual quote + quotation PDF ownership | Completed |
| Assign API durable user-id resolution | Completed |
| Admin / Director / Super Admin bypass | Completed |
| Non-sales roles denied on guarded routes | Completed |
| Legacy salesperson / bdmName fallback | Completed |
| Unit tests (`test:phase-1b2c`, 26/26) | Completed |
| Documentation | Completed |

**Commit:** _Pending_  
**Documentation:** [PHASE-1B2C-Sales-Ownership.md](../phases/PHASE-1B2C-Sales-Ownership.md)

**Acceptance criteria met:**

- Sales staff access only assigned resources (user id primary, legacy name fallback)
- Cross-rep access returns **403**; missing resources **404**
- Admin/Director/Super Admin bypass confirmed in tests
- Customer and technician ownership unchanged

**Known limitations:**

- No Sales Manager team visibility rollup
- No co-selling / sharing
- `POST /api/export/pdf/manual-quote` without `leadId` not ownership-gated
- Legacy name fields remain until data backfill

---

## Planned

### Phase 1B.3 — Fine-Grained Permissions

| Field | Value |
|-------|-------|
| **Status** | Planned |
| **Priority** | High |
| **Complexity** | Large |
| **Dependencies** | Phase 1B.1; Phase 1B.2 (ownership rules complete) |
| **Version Target** | _TBD_ |

**Description**

Module-level permission keys (`role_permissions`) enforced server-side beyond role + ownership.

**Acceptance Criteria**

- Permission resolver integrated with `req.actor`
- Deny-by-default for unpermissioned module actions
- Admin override preserved

**Known Risks**

- Layering with ownership rules (auth → permission → ownership)

---

### Phase 1B.4 — Sales Teams and Manager Visibility

| Field | Value |
|-------|-------|
| **Status** | Planned |
| **Priority** | Medium |
| **Complexity** | Medium |
| **Dependencies** | Phase 1B.2C |
| **Version Target** | _TBD_ |

**Description**

Sales Manager read visibility to team members' assigned leads without full admin bypass.

**Acceptance Criteria**

- Team membership model
- Manager read-only subordinate pipeline access
- Mutation still requires ownership or admin override

**Known Risks**

- Requires team data model not present in 1B.2C

---

### Phase 2 — Backend Modularization

| Field | Value |
|-------|-------|
| **Status** | Planned |
| **Priority** | _TBD_ |
| **Complexity** | _TBD_ |
| **Dependencies** | _TBD_ |
| **Version Target** | _TBD_ |

**Description**

_TBD_

**Acceptance Criteria**

- _TBD_

**Known Risks**

- _TBD_

---

### Phase 3 — Performance Optimization

| Field | Value |
|-------|-------|
| **Status** | Planned |
| **Priority** | _TBD_ |
| **Complexity** | _TBD_ |
| **Dependencies** | _TBD_ |
| **Version Target** | _TBD_ |

**Description**

_TBD_

**Acceptance Criteria**

- _TBD_

**Known Risks**

- _TBD_

---

### Phase 4 — Enterprise Features

| Field | Value |
|-------|-------|
| **Status** | Planned |
| **Priority** | _TBD_ |
| **Complexity** | _TBD_ |
| **Dependencies** | _TBD_ |
| **Version Target** | _TBD_ |

**Description**

_TBD_

**Acceptance Criteria**

- _TBD_

**Known Risks**

- _TBD_

---

## Technical Debt

| Item | Source | Notes |
|------|--------|-------|
| Backfill `assigned_sales_user_id` on leads | Phase 1B.2C | Legacy `assigned_salesperson` fallback is transitional |
| Add Supabase `leads.assigned_sales_user_id` column | Phase 1B.2C | Assign degrades to name-only if column missing |
| Backfill technician user ids on service requests / tickets | Phase 1B.2B | Name-only rows use transitional fallback |
| Create `PHASE-1B2A-Customer-Ownership.md` | Phase 1B.2A | Phase doc not yet committed |
| Create `PHASE-1B2B-Technician-Ownership.md` | Phase 1B.2B | Phase doc not yet committed |
| Gate `POST /api/export/pdf/manual-quote` without leadId | Phase 1B.2C | Preview path bypasses ownership |

---

## Ideas

_None recorded._
