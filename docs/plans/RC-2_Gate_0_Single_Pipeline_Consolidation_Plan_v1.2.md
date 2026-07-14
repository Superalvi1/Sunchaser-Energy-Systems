## RC-2 Gate 0 — Single Pipeline Consolidation Plan (v1.2)
**Supersedes the v1.1 plan (separate `engineeringOrchestrator` module rejected). No code written. Planning only, for Codex review.**

Mandatory chain restated for reference:
`ProjectDesignWorkspace → thin sunchaserDesignStudioClient → Engineering API → SolarDesignPipeline → Roof Geometry Engine → Panel Layout Engine V2 → Electrical Design Engine → Solar Simulation Engine → Proposal stage (same run) → sealed Engineering Run Snapshot → PDF renderer reads Proposal Snapshot only`

**One assumption flagged for Codex confirmation before Commit 4 starts:** "Engineering API" is specified as a layer, but this codebase currently has no network boundary between client TS and server engine TS (client imports server modules directly, run via `tsx`/vite). Gate 0 treats "Engineering API" as an **in-process module-call contract** (one exported function, one input type, one sealed-snapshot return type) — not a new HTTP route — since item 4 explicitly forbids adding persistence/schema work beyond what Gate 0 needs, and no HTTP boundary is named as in-scope. If the architecture intends a real network hop here, that changes Commit 4/5's shape and should be confirmed before those commits start.

---

### Commit 1 — Classification & import-boundary tests (write tests first, no production code changes)
**Purpose:** Establish the enforcement mechanism before any refactor: a test suite that fails today if canonical paths import legacy calculators, and that will keep failing/passing correctly as later commits move code. This is the safety net item 7 requires ("add import-boundary tests that fail if canonical paths import them") and lets every subsequent commit be verified mechanically.
**Files expected to change:** new test file, e.g. `server/solar/architectureBoundary.test.ts` (source-scan style, matching the existing pattern already used in `roofGeometryConversion.test.ts`'s forbidden-function-body scan). Classifies legacy files explicitly:
- **Legacy — must not be imported by `SolarDesignPipeline.ts` after Commit 2:** `server/solar/proposal/PanelLayoutEngine.ts` (v1 `layoutPanels`), `server/solar/proposal/CableCalculator.ts`, `server/solar/proposal/ProtectionCalculator.ts`.
- **Legacy — must not be imported by `sunchaserDesignStudioClient.ts` after Commit 5:** `server/solar/panel/PanelLayoutEngine.ts` (`layoutPanelsOnPlane`), `server/solar/electrical/ElectricalDesignEngine.ts` (`designElectricalSystem`), `server/solar/simulation/SolarSimulationEngine.ts` (`runSolarSimulation`), `server/solar/proposal/SolarProposalEngine.ts` (`generateSolarProposal`), any PDF/export module.
- **Retained, still-needed (not "legacy panel/electrical duplicates"):** `server/solar/proposal/MarginEngine.ts`, `PricingEngine.ts`, `SolarProposalModels.ts`, `SolarDesignRules.ts`, `ProposalTemplate.ts` — these carry commercial/business rules, not competing engine math, and stay in use by the Proposal stage.
**Files that must not change:** any production `.ts`/`.tsx` file — this commit is tests only.
**Dependencies:** none.
**Tests:** the new boundary test itself (expected to **fail** against current `SolarDesignPipeline.ts` and `sunchaserDesignStudioClient.ts` — that failure is the point; it turns green as Commits 2 and 5 land).
**Migration impact:** none.
**Rollback:** delete the new test file.
**Architecture invariant satisfied:** "Add import-boundary tests that fail if canonical paths import [legacy engines]" (item 7).

---

### Commit 2 — Refactor `SolarDesignPipeline` to canonical engines only
**Purpose:** Make the pipeline orchestration-only, sourcing every domain computation from the canonical engine, per item 1. Concretely: replace the v1 `layoutPanels` call with `layoutPanelsOnPlane` (V2) fed by `server/solar/roof/RoofGeometryEngine.ts`-validated roof/plane input; replace the hand-rolled `buildElectricalSizing`/`CableCalculator`/`ProtectionCalculator` block with a single call into `server/solar/electrical/ElectricalDesignEngine.ts` (`designElectricalSystem`), which already internally owns stringing, MPPT, cable sizing, and protection selection; keep the existing `runSolarSimulation` call (already canonical, unchanged). Also fold in BOQ construction here via `server/solar/proposal/BoqGenerator.ts`, but its residual internal `layoutPanels` fallback path (used when no precomputed layout is supplied) must be closed off — the pipeline always supplies the real V2 layout, so that legacy branch becomes provably dead and is asserted unreachable by a test, not deleted yet (item 7: don't delete unless proven unreferenced, and this specific call site needs one more caller check first).
**Files expected to change:** `server/solar/pipeline/SolarDesignPipeline.ts` (core edit), `server/solar/pipeline/SolarPipelineModels.ts` (input/output types adjusted to match `ElectricalDesignEngine`'s result shape and V2 layout shape), possibly `server/solar/pipeline/SolarPipelineAutoSize.ts`/`SolarPipelineCanvasGeometry.ts` (if they also call the v1 layout engine directly — must be checked, not assumed).
**Files that must not change:** `server/solar/panel/PanelLayoutEngine.ts`, `server/solar/electrical/*`, `server/solar/simulation/*`, `server/solar/roof/*` (all canonical engines — pipeline consumes them, does not modify their formulas), `server/solar/proposal/BoqGenerator.ts`'s non-layout logic (margin application, line-item shape).
**Dependencies:** Commit 1 (boundary test must exist first so this commit's compliance is provable).
**Tests:** Commit 1's boundary test now passes for `SolarDesignPipeline.ts`; existing `test:solar-pipeline` regression suite updated to reflect V2-layout-derived panel counts (numbers will change vs. today's v1-approximated output — expected, not a regression); new equivalence test asserting pipeline's electrical output matches calling `designElectricalSystem` directly with the same layout.
**Migration impact:** panel count / DC kW / electrical sizing produced by the pipeline shifts from the v1 bounding-box approximation to the real obstacle-aware V2 result — this is the core correctness fix Gate 0 exists to deliver, but it changes numbers on anything still consuming this pipeline (currently: `SolarProposalStudio.tsx` only, per the RC-2A audit) — flag for manual QA comparison on a few real roofs before merge.
**Rollback:** single isolated `git revert` — `SolarDesignPipeline.ts` has exactly one production consumer today (`solarPipelineClient.ts`), so blast radius is contained.
**Architecture invariant satisfied:** "Refactor SolarDesignPipeline... Keep orchestration only; no formulas" (item 1); chain segment `SolarDesignPipeline → Roof Geometry → Panel Layout V2 → Electrical → Simulation` (mandatory architecture).

---

### Commit 3 — Proposal stage as the pipeline's final internal stage
**Purpose:** Move proposal generation from a separate, client-triggered `generateSolarProposal()` call into a final stage executed *inside* the same `SolarDesignPipeline` run, consuming the exact roof/layout/electrical/simulation objects already produced in that run — no re-snapping to a nominal system size, no second invocation from anywhere else.
**Files expected to change:** `server/solar/pipeline/SolarDesignPipeline.ts` (add final proposal-assembly step at the end of `runSolarDesignPipeline`), `server/solar/pipeline/SolarPipelineModels.ts` (output type grows a `proposal` field), possibly a new thin internal file `server/solar/pipeline/PipelineProposalStage.ts` if the assembly logic is large enough to warrant separation from the orchestration function itself (kept as pipeline-internal, not a competing engine).
**Files that must not change:** `server/solar/proposal/SolarProposalEngine.ts`'s `generateSolarProposal` export itself is not deleted this commit (item 7 — prove unreferenced first), but nothing in the canonical chain calls it anymore after this commit; `MarginEngine.ts`/`PricingEngine.ts` (reused as-is by the new internal stage, not modified).
**Dependencies:** Commit 2 (pipeline must already produce canonical layout/electrical/simulation before a proposal stage can consume them without re-deriving).
**Tests:** new test asserting the pipeline's `proposal.dcKw`/`proposal.panelCount` are bit-for-bit equal to `layout.dcCapacityKw`/`layout.panelCount` from the same run (no snapping); source-scan asserting the new stage never calls `snapToSupportedSystemSizeKw` or any nominal-size-derived recompute.
**Migration impact:** proposal numbers become exactly consistent with engineering output by construction — same QA note as Commit 2 (numbers may shift from today's snapped-size values).
**Rollback:** isolated revert; `generateSolarProposal` remains available on disk for any as-yet-unmigrated caller.
**Architecture invariant satisfied:** "Proposal executes once as the final SolarDesignPipeline stage... No nominal-size snapping... No proposal regeneration from React state" (item 3).

---

### Commit 4 — Engineering Run Snapshot & Proposal Snapshot contracts (in-memory, no persistence)
**Purpose:** Define the sealed, immutable result types the mandatory chain ends on. Pure type/contract addition — the pipeline's Commit-2/3 output gets wrapped into these before being returned.
**Files expected to change:** new file `server/solar/pipeline/EngineeringRunSnapshot.ts` defining: `EngineeringRunSnapshot` (stage inputs/outputs for roof/layout/electrical/simulation, an `inputHash`/`outputHash` per stage, `engineVersions: { roof, panelLayout, electrical, simulation }`, `sealed: true`, a stable `runId`), and `ProposalSnapshot` (proposal/BOQ output, `engineeringRunId` back-reference, its own hash, `sealed: true`). `SolarDesignPipeline.ts` edited to construct and return these instead of a loose object.
**Files that must not change:** no database/schema files — item 4 explicitly says don't add persistence for Gate 0; this stays an in-memory TypeScript contract.
**Dependencies:** Commits 2, 3.
**Tests:** new `engineeringRunSnapshot.test.ts` — hash determinism (same inputs → same hash), immutability (attempting to mutate a field either throws or is a no-op depending on chosen seal mechanism — must specify one: `Object.freeze` recommended for Gate 0 simplicity), `ProposalSnapshot.engineeringRunId` correctly references its parent run.
**Migration impact:** none — purely additive typing around existing Commit 2/3 output.
**Rollback:** revert; pipeline falls back to its Commit-3 loose-object return shape.
**Architecture invariant satisfied:** item 4 in full ("Define EngineeringRunSnapshot, ProposalSnapshot, stage inputs/outputs, input/output hashes, schema/engine versions, sealed status... no persistence yet").

---

### Commit 5 — Engineering API contract (in-process module boundary)
**Purpose:** The single seam the thin client is allowed to call through. One function, e.g. `runEngineeringApi(request): EngineeringRunSnapshot`, wrapping Commit 2–4's pipeline+snapshot, with a narrow request type (roof state + controls + module — no engine-shaped params leaking through).
**Files expected to change:** new file, e.g. `src/lib/engineeringApi.ts` (client-importable boundary module) or `server/api/engineeringApi.ts` depending on the HTTP-vs-in-process confirmation flagged at the top of this plan — **default assumption: in-process, same-process TypeScript call, no fetch/HTTP** — file placed so it's the *only* file besides the pipeline itself allowed to import `SolarDesignPipeline.ts`.
**Files that must not change:** `SolarDesignPipeline.ts` itself (consumed, not modified further here).
**Dependencies:** Commit 4.
**Tests:** contract test — `engineeringApi.test.ts` — asserts the API's return type is a sealed `EngineeringRunSnapshot`/`ProposalSnapshot`, and a boundary test asserting **no file other than `engineeringApi.ts` and the pipeline's own internals imports `SolarDesignPipeline.ts`** (this is the enforcement point for "thin client" in Commit 6).
**Migration impact:** none yet — nothing calls this API until Commit 6.
**Rollback:** delete the new file.
**Architecture invariant satisfied:** chain segment `Engineering API → SolarDesignPipeline`; sets up enforcement for item 2's import restrictions.

---

### Commit 6 — Thin `sunchaserDesignStudioClient` cutover
**Purpose:** Strip the client down to request-shaping + API call + response-mapping only, per item 2. Remove its direct imports of `layoutPanelsOnPlane`, `designElectricalSystem`, `runSolarSimulation`, `generateSolarProposal`, and any PDF-related internals; replace the internal `runDesignStudioEngineering`/`buildPipelineStudioViewModel` call chain with a single call to Commit 5's `engineeringApi`.
**Files expected to change:** `src/lib/sunchaserDesignStudioClient.ts` (the actual cutover — imports removed, `buildDesignStudioLiveResults` rewritten to call the Engineering API once and map its `EngineeringRunSnapshot`/`ProposalSnapshot` into `DesignStudioLiveResults` view-model fields), `src/lib/designStudioEngineeringRun.ts` (superseded — marked `@deprecated`, not deleted this commit per item 7).
**Files that must not change:** `src/components/roofStudio/ProjectDesignWorkspace.tsx`, `DesignStudioLeftControlPanel.tsx`, `DesignStudioResultsPanel.tsx` (consume the client's existing public shape; if the view-model type is preserved, these need no edits — flag if any field renames are unavoidable, in which case they change too, but the goal is zero UI-component edits here).
**Dependencies:** Commit 5.
**Tests:** Commit 1's boundary test now passes for `sunchaserDesignStudioClient.ts`; existing `sunchaserDesignStudioClient.test.ts` assertions updated for the new (correct) numbers; new test asserting exactly one engineering computation occurs per `buildDesignStudioLiveResults` call (the duplicate-runtime defect from the RC-2A audit becomes structurally impossible, not just avoided).
**Migration impact:** same BOQ/proposal-number shift as Commits 2–3, now live in the canonical UI — this is the actual user-facing fix; requires the QA pass flagged earlier before merge. Run `test:roof-studio`, `test:panel-layout`, `test:solar-electrical-engine`, `test:solar-simulation-engine`, `test:phase-1b1`, and `npm run build`.
**Rollback:** isolated revert of this one file plus the deprecation comment.
**Architecture invariant satisfied:** item 2 in full; eliminates the confirmed duplicate-execution-path defect (RC-2A finding).

---

### Commit 7 — Proposal preview / PDF render-only cutover
**Purpose:** Enforce item 5 — the proposal preview component and PDF export path may only read a sealed `ProposalSnapshot`, never trigger computation.
**Files expected to change:** whichever component currently renders proposal preview (likely under `src/components/roofStudio/` or `src/components/quoteAuthoring/` — must be located precisely before this commit starts, not assumed) renamed/scoped to `DesignStudioProposalPreview` reading only a passed-in `ProposalSnapshot` prop; PDF export entry point (`src/lib/quoteBoqPdf.ts` and/or its route in `server.ts`) changed to accept a `sealed: true` `ProposalSnapshot` as its sole input and reject (fail closed) anything else.
**Files that must not change:** `server/solar/pipeline/SolarDesignPipeline.ts`, `server/solar/proposal/SolarProposalEngine.ts`, `server/quotation/*`, any layout/electrical/simulation engine — the entire point is that the PDF path imports **none** of these.
**Dependencies:** Commit 4 (snapshot types), Commit 6 (client must already be producing snapshots to hand to preview/PDF).
**Tests:** boundary test asserting the PDF render path imports none of `SolarDesignPipeline.ts`, `generateSolarProposal`, `server/quotation/*`, or any layout/electrical/simulation engine file; a fail-closed test asserting PDF export throws/rejects when given a non-sealed or missing snapshot.
**Migration impact:** if the current preview/PDF path recomputes anything today (to be confirmed by inspection at commit time), removing that recompute may change what's shown at preview vs. what was shown before — same QA discipline as prior commits.
**Rollback:** isolated revert of the preview/PDF files only.
**Architecture invariant satisfied:** item 5 in full ("PDF export accepts sealed ProposalSnapshot only... cannot call SolarDesignPipeline / generateSolarProposal / Quotation Engine / engines / live React state").

---

### Commit 8 — Workspace & legacy route cleanup
**Purpose:** Enforce item 6 — one canonical editable engineering workspace, with `SolarProposalStudio` explicitly demoted rather than removed (this differs from the earlier v1.1 plan's "hard-disable" — v1.2 authority instead wants it retained but clearly relabeled).
**Files expected to change:**
- `src/components/roofStudio/SunchaserDesignStudio.tsx` — **delete** if Commit 1's boundary/reference check (re-run fresh, not assumed from the earlier audit) confirms zero real importers still; otherwise reduce to a one-line re-export wrapper pointing at `ProjectDesignWorkspace`.
- `src/components/quoteAuthoring/SolarProposalStudio.tsx` — add a visible, non-dismissable label: "Budgetary Estimate — not engineering-derived"; confirm it does not expose any editable engineering-parameter controls that imply it's a design tool.
- `src/lib/studioFeatureFlags.ts` — collapse to one canonical flag/route for the editable engineering workspace (`ProjectDesignWorkspace`); `SolarProposalStudio`'s route stays reachable but is documented as non-engineering.
**Files that must not change:** `ProjectDesignWorkspace.tsx` itself (already canonical, no edit expected).
**Dependencies:** Commits 6, 7 (workspace cleanup should follow the engine cutover so there's only one correct path left to point at).
**Tests:** build/import check for the deleted-or-wrapped `SunchaserDesignStudio.tsx`; snapshot/DOM-shape check (to the extent this test harness supports it) that `SolarProposalStudio` renders the budgetary-estimate label; `studioFeatureFlags.test.ts` updated for the single-flag shape.
**Migration impact:** none for the delete-if-dead path (confirmed no importers in RC-2A audit, re-verify fresh at commit time since files may have changed); labeling change on `SolarProposalStudio` is purely additive UI text.
**Rollback:** isolated revert per file.
**Architecture invariant satisfied:** item 6 in full.

---

### Commit 9 — Final architecture-source scan
**Purpose:** One last whole-tree verification commit (test-only) asserting the entire mandatory chain holds simultaneously: `ProjectDesignWorkspace` imports only the thin client; the thin client imports only the Engineering API; only the Engineering API and the pipeline itself import `SolarDesignPipeline.ts`; the pipeline imports only canonical `roof`/`panel`/`electrical`/`simulation` engines; no live file outside the pipeline's proposal stage imports `generateSolarProposal`; the PDF path imports nothing but snapshot types.
**Files expected to change:** one new test file, e.g. `server/solar/finalArchitectureScan.test.ts`, consolidating and cross-checking all boundary assertions from Commits 1, 5, 6, 7 into one whole-repo pass (belt-and-suspenders, not a replacement for the per-commit tests).
**Files that must not change:** none — test-only commit.
**Dependencies:** Commits 1–8 (this is the closing gate).
**Tests:** itself.
**Migration impact:** none.
**Rollback:** delete the file.
**Architecture invariant satisfied:** the full mandatory chain, verified as a single standing invariant rather than nine separate assumptions.

---

This plan is ready to return to Codex for approval. No files have been created or modified. The one open item requiring confirmation before Commit 4/5 begin: whether "Engineering API" must be a real network boundary or the in-process module contract assumed above.