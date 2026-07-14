# RC-2 Gate 0 — Codex Review Packet

**Purpose:** Materialize approved Gate 0 authority documents for Codex review prior to any Cursor implementation.

**Branch:** `integration/rc-2`  
**Baseline tip (pre-docs):** `f4b2ac7f6473a235f7c702b543faa232d1ea5a5f`  
**Current tip after documentation commit:** this commit (SHA in git log / Codex review of HEAD)  
**Date:** 14 July 2026

---

## Controlling authority

**Architecture v1.2 is the controlling architecture for RC-2 Gate 0.**

All Gate 0 planning and any future implementation must conform to:

`docs/architecture/SUNCHASER_OS_RC-2_Technical_Architecture_v1.2.md`

That document supersedes RC-2 Technical Architecture v1.1.

The Gate 0 implementation plan is subordinate to Architecture v1.2 and must not redefine engine ownership, formula authority, or the mandatory single-pipeline chain.

---

## Documents under review (exact paths)

1. **Architecture (controlling):**  
   `docs/architecture/SUNCHASER_OS_RC-2_Technical_Architecture_v1.2.md`  
   **SHA-256:** `49e910a8ba21bda2521fb9c1f38141d92cfe54340f0d480cba1f1dd9e1a59054`

2. **Gate 0 implementation plan (Claude v1.2):**  
   `docs/plans/RC-2_Gate_0_Single_Pipeline_Consolidation_Plan_v1.2.md`  
   **SHA-256:** `6c390e55a1152f27c2cb3f19e4cd35bb6d6997052cf192e9a0bf147994dd9f38`

---

## Cursor implementation status

**Cursor implementation remains blocked.**

No production code, tests, schema, or architecture changes may be implemented by Cursor until Codex returns a final result of:

`APPROVE FOR CURSOR IMPLEMENTATION`

and has approved every planned commit in the Gate 0 plan.

---

## Requested Codex output format

Codex must return a structured review covering:

1. **Architecture conformance** — Does the Gate 0 plan fully conform to Architecture v1.2 (single `SolarDesignPipeline` orchestrator, V2 engines only, Proposal inside the Engineering Run, PDF render-only from sealed Proposal Snapshot, one CRM Engineering Workspace)?
2. **Per-commit verdict** — For **each** planned commit in the Gate 0 plan: `APPROVE` | `HOLD` | `REJECT`, with a one-line reason.
3. **Open API-boundary assumption** — Explicit verdict on the plan’s open assumption about whether “Engineering API” must be a real network boundary or may remain an in-process module contract.
4. **Risk / missing gates** — Any missing tests, rollback gaps, or residual duplicate runtime paths.
5. **Final result** — Exactly one of:
   - `APPROVE FOR CURSOR IMPLEMENTATION`
   - `HOLD — revise plan`
   - `REJECT`

Do not approve Cursor implementation unless every planned commit is approved and the API-boundary assumption is resolved.
