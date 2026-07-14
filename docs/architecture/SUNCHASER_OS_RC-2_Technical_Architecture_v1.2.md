# Sunchaser OS RC-2 Technical Architecture v1.2

**Document status:** Single-flow controlling architecture — approved for implementation planning after Gate 0  
**Release class:** Internal development release  
**Date:** 14 July 2026  
**Owner:** Sunchaser OS CTO Architecture Review  
**Baseline:** RC-1.1 on `develop-local-integration`

**Supersedes:** RC-2 Technical Architecture v1.1  
**Revision reason:** Removes the remaining dual-orchestrator ambiguity and places Proposal inside the immutable Engineering Run.

---

## 1. Executive decision

RC-2 will add a CRM-native **Engineering Workspace** that converts the RC-1.1 roof and panel design into a versioned engineering package containing:

- Single Line Diagram (SLD)
- panel-to-string and string-to-MPPT visualization
- physical DC, AC, battery, earth and communications cable routes
- inverter and battery placement
- cable and protection schedules
- an auditable engineering report

RC-2 is an **orchestration, visualization, persistence and engineering-documentation release**. It will not create replacement solar calculations.

The repository currently contains two overlapping calculation paths. RC-2 must not build on that ambiguity. Before feature work, **Gate 0 — Single Pipeline Consolidation** must establish one runtime chain:

1. Roof Geometry Engine in `server/solar/roof`
2. Panel Layout Engine V2 in `server/solar/panel`
3. Electrical Design Engine in `server/solar/electrical`
4. Solar Simulation Engine in `server/solar/simulation`
5. the existing `server/solar/pipeline/SolarDesignPipeline.ts`, refactored to become the sole orchestrator over those engines
6. Proposal assembly as the final stage inside that same Engineering Run
7. one immutable **Engineering Run Snapshot** containing inputs and every stage output
8. PDF rendering from the stored Proposal Snapshot only

`SolarDesignPipeline` is chosen as the only RC-2 orchestration entry because it is already the repository’s named cross-stage pipeline. Its current internals are not acceptable: Gate 0 must replace its calls to legacy `server/solar/proposal/PanelLayoutEngine`, `CableCalculator` and `ProtectionCalculator` with the canonical V2 panel and electrical engines.

Proposal is not regenerated after the run. `SolarDesignPipeline` must assemble the Proposal Snapshot from the exact roof, layout, electrical and simulation results before the Engineering Run is sealed. It must not snap DC capacity to a nominal size and rerun `generateSolarProposal` to reconstruct technical quantities.

The only active CRM engineering surface will be the canonical Engineering Workspace evolved from `ProjectDesignWorkspace`. `sunchaserDesignStudioClient` becomes a thin client over the SolarDesignPipeline API. It may shape requests, display stage status and map stored results into view models; it may not import or invoke server engines, proposal generation or PDF compilation.

RC-2 is not, by itself, a licensed professional-engineering certification system. Every report must state its status and required reviewer approval.

### 1.1 v1.2 architecture decision

**Decision:** `SolarDesignPipeline` becomes the only orchestration entry. `sunchaserDesignStudioClient` becomes a thin client over it. These are complementary decisions, not alternatives.

The single flow is:

**Engineering Workspace → SolarDesignPipeline → Roof Geometry → Panel Layout V2 → Electrical Design → Solar Simulation → Proposal Snapshot → seal immutable Engineering Run → PDF renderer.**

The flow is mandatory for preview/final execution. Preview may stop after an earlier stage, but it must still enter through SolarDesignPipeline and cannot create an approvable artifact. A final run must complete through Proposal before it can be sealed.

### 1.2 HOLD resolution summary

| HOLD finding | v1.2 resolution |
|---|---|
| Duplicate pipeline ownership | `SolarDesignPipeline` is the single orchestration entry; every other orchestrator/adapter is removed, retired or reduced to a thin client. |
| Proposal source-of-truth | Proposal Snapshot is produced inside and stored with the immutable Engineering Run; no post-run technical proposal regeneration exists. |
| Competing workspaces | One CRM Engineering Workspace route, state model and command surface; legacy studios become internal components, redirects, read-only compatibility views or are retired. |

---

## 2. Goals and non-goals

### 2.1 Goals

1. Give a Sunchaser engineer one workspace from roof design through engineering report.
2. Preserve a single source of truth for equipment, panel positions, strings, routes and assumptions.
3. Generate SLDs and schedules from validated engine output rather than manually typed values.
4. Make cable length changes automatically trigger electrical recalculation.
5. Keep every revision reproducible through input snapshots, engine versions and hashes.
6. Support on-grid, hybrid and off-grid design workflows within existing engine limits.
7. Integrate engineering output with the lead, customer, documents, quotation, inventory and approval workflows.
8. Fail closed when inputs, catalogs, schema, permissions or calculations are invalid.

### 2.2 Non-goals for RC-2

- No replacement for the existing Roof Geometry, Panel Layout, Electrical Design, Solar Simulation, Solar Proposal or Quotation engines.
- No AI-generated engineering values.
- No automatic structural certification.
- No protection-coordination or short-circuit study beyond existing engine rules.
- No claim of PVsyst-equivalent bankability or loss-model validation.
- No automatic approval of battery fire safety or structural loading.
- No public production launch.
- No direct merge to `main` before a separate production gate.

---

## 3. Architecture principles

### 3.1 Single calculation authority

Each engineering fact has one owner:

| Engineering fact | Authoritative owner |
|---|---|
| Roof geometry, usable area, pitch, azimuth and setbacks | Roof Geometry Engine |
| Panel positions, capacity and utilization | Panel Layout Engine |
| String length, string membership and MPPT allocation | Electrical Design Engine |
| Cable sizing, voltage drop, protection, earthing and electrical BOQ | Electrical Design Engine |
| Production, losses and financial output | Solar Simulation Engine |
| Cross-stage orchestration and stage status | `SolarDesignPipeline`; the only orchestration entry and owner of sequencing, never formulas |
| Immutable technical source | Engineering Run Snapshot containing normalized input and stored outputs for every completed stage |
| Engineering Proposal | Proposal stage inside `SolarDesignPipeline`, consuming exact prior-stage outputs |
| Commercial prices, margins, services and terms | versioned commercial inputs supplied before Proposal stage or a separately labeled non-engineering quotation |
| Proposal presentation | stored Proposal Snapshot inside the immutable Engineering Run |
| PDF rendering | Existing Playwright PDF pipeline |
| Map, geocoding and satellite imagery | Existing map-provider adapters |
| Draft persistence and optimistic concurrency | Design Session persistence |
| Engineering revision, approval and audit state | RC-2 Engineering Workspace domain |

UI components, SLD renderers and report templates may format these results but must not recalculate them.

`SolarDesignPipeline` becomes authoritative only after Gate 0 changes its dependencies to the registered V2 engines and removes all legacy proposal-layer calculators. Its authority is architectural and enforced by imports/tests, not by its filename.

### 3.2 Derived views, not parallel models

- The SLD is derived from a validated electrical result.
- String colors are derived from panel IDs in the electrical string groups.
- Cable schedules are derived from saved route geometry plus Electrical Design Engine results.
- Placement schedules are derived from catalog equipment and saved spatial placements.
- Reports are derived from an immutable engineering revision and its successful engine run.
- Proposal is a stored stage result inside the Engineering Run, not a later reconstruction.
- The Proposal stage may enrich exact technical results with pinned commercial inputs, but may not regenerate panel count, DC capacity, stringing, cable size, protection or production.
- PDF is a pure renderer of the stored Proposal Snapshot and Engineering Run Snapshot.

### 3.3 Deterministic and reproducible

Every engineering run records:

- immutable revision identifier
- normalized input snapshot
- engine versions
- catalog versions
- input hash
- result hash
- warnings and validation failures
- user and timestamp

Re-running the same revision with the same engine and catalog versions must produce the same engineering result.

### 3.4 Modular monolith first

RC-2 remains within the existing React, Node/Express and Supabase application. It should use clear modules and repositories rather than creating new microservices. The PDF worker may later be separated if workload requires it, but RC-2 should not introduce distributed-system complexity prematurely.

### 3.5 Fail closed

- Invalid geometry cannot reach layout.
- Invalid layout cannot reach electrical design.
- Invalid stringing cannot be presented as ready.
- Invalid or missing cable routes cannot silently use zero length.
- Missing production schema cannot fall back to local JSON.
- Missing map configuration cannot invent coordinates or satellite imagery.
- A report cannot receive “Approved” status without an authorized approval record.
- A proposal cannot claim an engineering basis unless it is the stored Proposal Snapshot of a sealed Engineering Run.
- A PDF cannot be generated from live UI state or by rerunning Proposal.

### 3.6 Canonical runtime invariant

For every CRM engineering project, exactly one authoritative chain exists:

**Canonical Engineering Workspace → immutable revision → SolarDesignPipeline → Roof Geometry → Panel Layout V2 → Electrical Design → Solar Simulation → Proposal Snapshot → sealed Engineering Run → PDF.**

No other UI, API, adapter, pipeline or PDF path may invoke an alternate layout, cable, protection, stringing or sizing calculator for that project.

---

## 4. Existing engine reuse map

| Existing capability | RC-2 use | Prohibited duplication |
|---|---|---|
| Roof Geometry Engine | validates planes, areas, pitch, azimuth, setbacks, obstacles and walkways | polygon area, self-intersection, scale or setback math in the UI |
| Panel Layout Engine | produces placed panels, orientation, utilization and DC capacity | a second packing algorithm in Engineering Workspace |
| Electrical Design Engine | produces strings, MPPT allocation, cable sizes, voltage drop, protection, earthing and BOQ | string voltage, current, cable size or breaker calculations in SLD/report code |
| Solar Simulation Engine | produces hourly/monthly energy, performance ratio, losses and financial summaries | report-side production formulas |
| `SolarDesignPipeline` | sole RC-2 orchestration entry after Gate 0; sequences canonical V2 engines and Proposal stage | engineering formulas or delegation to an alternate orchestrator |
| `sunchaserDesignStudioClient` | thin HTTP/request and view-model adapter over SolarDesignPipeline results | direct server-engine imports, engine execution, proposal generation or PDF compilation |
| Proposal-layer `PanelLayoutEngine`, `CableCalculator`, `ProtectionCalculator` (legacy) | legacy budgetary quotation compatibility only during migration | RC-2 engineering runs or engineering-derived proposals |
| Solar Proposal Engine/assembler | final stage called only by SolarDesignPipeline with exact stored prior-stage outputs | standalone engineering-proposal execution or nominal-size technical regeneration |
| Quotation Engine | applies product, cable, structure, margin and approval pricing rules | hard-coded prices in Engineering Workspace |
| Roof Vision pipeline | optional roof extraction and manual-correction provenance | silent replacement of engineer-confirmed geometry |
| Google/map-provider adapters | address search, coordinates and satellite background when configured | fake geocoding or unapproved third-party calls |
| Design Sessions | draft save/restore, dirty state, optimistic version conflict | browser local storage as authoritative persistence |
| Documents pipeline | private report storage, checksum, versioning, permissions and events | public report URLs or unmanaged file storage |
| Workflow/approval engine | reviewer assignment, approval, rejection and escalation | local-only approval flags |
| Inventory engine | equipment availability and serial/batch linkage after approval | engineering-side stock mutation |
| Existing PDF renderer | renders the final engineering report | a second PDF library or browser-print-only output |

### 4.1 Required engine contract refinement

RC-2 may extend existing engine input/output contracts where a required fact is currently absent, but the extension must remain inside the owning engine.

Examples:

- Electrical Design Engine may accept validated manual string constraints in a later RC-2 increment.
- Electrical Design Engine may expose route-level rather than only aggregate cable results.
- Solar Simulation Engine may later accept a validated battery model and dispatch policy.

Such changes are extensions of the existing engine, not new competing engines.

### 4.2 Engine classification register

Gate 0 creates and enforces a repository-level engine register:

| Classification | Meaning |
|---|---|
| Canonical | allowed to produce RC-2 technical facts |
| Orchestrator | may sequence canonical engines but owns no engineering formulas |
| Commercial | may price/format canonical facts but cannot change them |
| Compatibility | may serve a clearly labeled legacy/budgetary flow during migration |
| Retired | no runtime imports; retained only for history until deletion is approved |

Import-boundary tests must fail if any module other than `SolarDesignPipeline` orchestrates server engines, if the thin client imports a server engine, or if Proposal/PDF imports a compatibility calculator.

---

## 5. System context

### 5.1 Primary actors

| Actor | Responsibilities |
|---|---|
| Sales Advisor | opens the lead design, views engineering readiness and requests engineering review |
| Design Engineer | edits placements/routes, runs validation and creates revisions |
| Engineering Manager | reviews assumptions, warnings, SLD and report; approves or rejects |
| Super Admin | manages catalogs, rules, access, recovery and release flags |
| Accounts/Procurement | consumes approved BOQ and equipment requirements without editing engineering calculations |
| Customer | receives only an explicitly released customer copy, not internal drafts |

### 5.2 High-level layers

| Layer | Responsibility |
|---|---|
| Canonical React Engineering Workspace | the only CRM engineering entry point; spatial editing, diagrams, schedules, status and reviewer workflow |
| Engineering API | authorization, validation, version control, orchestration and report commands |
| Engineering domain | revisions, placements, routes, run snapshots, approvals and audit |
| `SolarDesignPipeline` | the only server path allowed to sequence RC-2 stages from roof through proposal |
| Canonical V2 solar engines | deterministic geometry, layout, electrical and production calculations |
| Engineering Run Snapshot | immutable input plus stored stage outputs, including Proposal Snapshot |
| Existing business engines | quotation, inventory, workflow, documents and CRM integration |
| Supabase PostgreSQL | authoritative operational and revision data with RLS |
| Private object storage | satellite/uploaded images, report files and supporting attachments |
| Existing PDF pipeline | deterministic engineering report rendering |

---

## 6. Engineering Workspace UI

### 6.1 Canonical entry point

The workspace opens from exactly one CRM lead action: **Design Project**. The implementation baseline is `ProjectDesignWorkspace`, evolved into the RC-2 Engineering Workspace shell. It is the only component allowed to own engineering draft state, save, revision creation, engine-run commands, SLD/report commands and engineering-derived proposal creation.

Current competing surfaces are resolved as follows:

| Current surface | v1.2 disposition |
|---|---|
| `ProjectDesignWorkspace` | migration baseline for the canonical Engineering Workspace; calls only the thin client/API |
| `SunchaserDesignStudio` | deprecated as an independent screen; may redirect to or become a presentation wrapper around the canonical workspace, with no separate state/run/export path |
| `RoofIntelligenceStudio` | retained only as an internal canvas/editor component inside the canonical workspace |
| `sunchaserDesignStudioClient` | retained only after direct engine imports are removed; request/response and view-model mapping over SolarDesignPipeline |
| `DesignStudioProposalPreview` | cannot remain an active calculator; it reads the stored Proposal Snapshot of the selected Engineering Run |
| Solar Proposal Studio/legacy proposal flows | remain clearly labeled **Budgetary Estimate** only, or redirect to canonical proposal creation when an engineering project exists |

There must be one canonical feature flag and one navigation route for Engineering Workspace. Legacy flags must not independently expose competing studios.

Header context:

- customer and lead
- project address
- system type and target capacity
- current engineering revision
- save status and concurrency status
- validation status
- report status
- assigned engineer/reviewer

### 6.2 Workspace layout

The desktop workspace uses four persistent regions:

| Region | Contents |
|---|---|
| Top command bar | save, run engineering, compare revision, submit review, export report |
| Left tool rail | roof, panels, strings, equipment, cable routes, SLD, report |
| Central canvas | site/roof plan, equipment layout, string overlay or SLD depending on mode |
| Right inspector | selected-object properties, catalog details, warnings and assumptions |
| Bottom status drawer | stage results, route schedule, string table, validation messages and audit activity |

Tablet use is view/review first. Precision editing is a desktop requirement for RC-2.

### 6.2.1 Command ownership

| User command | Sole destination |
|---|---|
| Save Draft | versioned Engineering Workspace draft API |
| Freeze Revision | immutable engineering revision API |
| Preview/Run Engineering | SolarDesignPipeline API; preview can stop early, final run must complete through Proposal |
| Preview Strings/SLD | projection from the selected successful run |
| Preview Proposal | stored Proposal Snapshot from the selected run |
| Generate PDF | PDF renderer using the stored Proposal Snapshot; no proposal or engine execution |

No component-local Generate Proposal or Download PDF action may rebuild technical content from live React state. There is no standalone engineering-proposal generation endpoint outside SolarDesignPipeline.

### 6.3 Workspace modes

1. **Site & Roof** — displays the approved RC-1.1 roof state and background image.
2. **Panel Layout** — displays placed panels, obstacles, walkways, setbacks and unused areas.
3. **Strings** — color-coded panel strings and MPPT assignments.
4. **Equipment** — inverter, battery, combiner, DB, meter and point-of-connection placement.
5. **Cable Routes** — DC, AC, battery, earth and communication paths.
6. **SLD** — logical electrical topology generated from engine output.
7. **Report** — live report completeness and page preview.

### 6.4 Status language

The UI uses explicit engineering states:

- Draft — not validated
- Invalid — blocking issues exist
- Valid with warnings — calculations succeeded but reviewer attention is required
- Ready for review — immutable revision created
- Changes requested
- Approved for internal use
- Released to customer
- Superseded

“Ready,” “approved” and “released” must never be interchangeable.

### 6.5 Save and concurrency

- Draft edits autosave through the existing versioned design-session mechanism.
- Explicit **Save Revision** creates an immutable engineering revision.
- An expected version is required for every draft mutation.
- A stale update returns a conflict and never overwrites the newer version.
- The user chooses reload, duplicate as a new revision or request manager resolution.

---

## 7. Single Line Diagram architecture

### 7.1 Purpose

The SLD provides a logical electrical view for review and reporting. It is not an independent calculation editor.

### 7.2 Supported RC-2 topology

| System | Logical chain |
|---|---|
| On-grid | PV strings → combiner/isolator → inverter → AC protection/DB → meter/PCC → grid/load |
| Hybrid | PV strings → hybrid inverter → AC DB/grid/load, plus battery/BMS → battery disconnect/protection → inverter backup path |
| Off-grid | PV strings → charge/inverter stage → battery/BMS → protected essential-load DB |

Optional nodes appear only when supported by engine/catalog data:

- DC combiner
- DC isolator
- surge protection
- AC breaker
- AC surge protection
- transformer
- earthing electrode/busbar
- generation meter/net meter
- backup and non-backup load boards

### 7.3 Data source

The SLD consumes:

- Electrical Design Engine string groups
- MPPT allocations
- inverter phase and rating
- protection-device result
- battery disconnect requirement
- saved equipment placements
- saved cable routes
- point-of-connection definition

### 7.4 SLD behavior

- DC conductors and nodes use one consistent visual family; AC and earth use distinct families.
- Each string node shows module count, voltage range, current and MPPT.
- Each conductor shows type, length, size and voltage drop where available.
- Clicking a string highlights the same panels and physical cable route on the site canvas.
- Clicking an SLD warning opens the authoritative engine warning and related object.
- Layout positions of SLD symbols may be adjusted for readability without altering electrical topology.
- Electrical topology changes require new validated inputs and a new engine run.

### 7.5 SLD validity

The SLD is valid only when its source engineering run is valid. If source inputs change, the SLD becomes **stale** until the engines are rerun.

---

## 8. String Visualization architecture

### 8.1 RC-2.0 capability

RC-2.0 provides engine-derived visualization:

- unique color per string
- panel sequence numbers
- MPPT grouping
- string module count
- cold Voc and hot Vmp
- string current
- validity and issue badges
- orphan/unassigned panel detection

### 8.2 Interaction

- Hovering a panel highlights its complete string and MPPT.
- Selecting an MPPT highlights all connected strings.
- A table and canvas remain synchronized.
- Filters allow valid, warning, invalid, unassigned and MPPT-specific views.
- Print colors must remain distinguishable in grayscale through line styles and labels.

### 8.3 Manual override policy

RC-2.0 does not permit arbitrary drag-and-drop string reassignment if the existing Electrical Design Engine cannot validate the assignment as an input.

Manual string editing may enter RC-2.1 only by extending the existing Electrical Design Engine contract to accept a proposed assignment, validate every panel exactly once, recalculate temperature voltage and MPPT compatibility, and return a structured result. The UI must never approve a manual string locally.

---

## 9. Cable Routing architecture

### 9.1 Route types

| Route type | Examples |
|---|---|
| DC string route | module-to-module string path |
| DC home run | string/combiner to inverter |
| DC trunk | combiner/recombiner to inverter |
| AC inverter route | inverter to AC DB or PCC |
| Battery DC route | battery/BMS/disconnect to hybrid inverter |
| Earthing/bonding route | array, structure, inverter, battery and DB bonding |
| Communications route | meter, inverter, BMS and monitoring communications |

### 9.2 Route editor

The editor stores physical polylines anchored to equipment or panel/string endpoints. A route may include:

- horizontal path segments
- vertical rise/drop
- route factor/slack
- installation method
- conduit/tray identifier
- conductor count
- indoor/outdoor exposure
- notes and manual measurement evidence

### 9.3 Calculation boundary

The workspace may measure route geometry using existing coordinate/measurement utilities. It may aggregate physical length and route metadata. It must pass the normalized DC and AC lengths to the Electrical Design Engine for cable sizing and voltage-drop calculation.

The route editor must not calculate conductor size, current capacity or voltage drop.

### 9.4 Route lifecycle

1. User places equipment.
2. User draws or auto-suggests a physical path.
3. Route geometry produces measured length.
4. Engineer confirms vertical rise, slack and installation method.
5. Engineering orchestration submits lengths to the Electrical Design Engine.
6. Engine returns conductor size, voltage drop and warnings.
7. Route and schedule display the returned result.

Moving an inverter or battery marks connected routes and all dependent electrical results stale.

### 9.5 Auto-routing

RC-2 may suggest the shortest visible path that avoids defined no-route zones. The suggestion is convenience only. It must be labeled **Suggested route — engineer confirmation required** and cannot automatically approve conduit method, penetration, fire stopping or physical constructability.

---

## 10. Inverter Placement architecture

### 10.1 Placement model

An inverter placement references a versioned inverter catalog item and records:

- site/floor/roof plane context
- x/y position and optional elevation
- mounting surface
- indoor/outdoor designation
- orientation
- service-clearance envelope
- ingress-protection rating
- ambient/ventilation assumption
- distance to PV array, battery, DB and PCC
- photograph or survey evidence
- engineer notes

### 10.2 Validation categories

- catalog compatibility with system type and DC/AC capacity
- MPPT and string compatibility from Electrical Design Engine
- required service clearances from manufacturer/catalog data
- ventilation and temperature warning
- wet/flood/exposure warning
- cable-distance and voltage-drop effect
- access and maintenance warning
- phase and grid-connection compatibility

Manufacturer-specific clearances must come from versioned catalog/manual data. The application must not present a universal invented clearance as a manufacturer requirement.

---

## 11. Battery Placement architecture

### 11.1 Scope

Battery Placement is a spatial, catalog, protection and review module. RC-2 will not create an unvalidated battery chemistry or thermal model.

### 11.2 Placement data

- battery catalog/version
- chemistry and nominal energy
- usable energy where cataloged
- BMS compatibility
- quantity and series/parallel configuration descriptor
- floor, wall or rack mounting
- x/y position and elevation
- enclosure/IP classification
- indoor/outdoor location
- manufacturer clearance envelope
- ambient temperature range
- ventilation requirement
- flood/water exposure
- structural load confirmation status
- distance to inverter and disconnect
- emergency isolation label/location
- survey evidence and notes

### 11.3 Validation

The module validates declared data against catalog rules and project policy:

- inverter/BMS compatibility
- required battery disconnect/protection from Electrical Design Engine
- manufacturer clearance
- route length completeness
- temperature and ventilation warnings
- flood and water exposure
- access and emergency isolation
- weight/structural review requirement
- combustible-material separation policy

Any missing manufacturer data produces a warning and requires engineering-manager confirmation. It does not silently substitute a safety value.

### 11.4 Simulation boundary

Current Solar Simulation results may describe hybrid/off-grid production within existing supported inputs. Battery dispatch, degradation, autonomy and state-of-charge claims must not appear unless the existing Simulation Engine is formally extended and validated for those calculations.

---

## 12. Engineering Report architecture

### 12.1 Report package

The report is generated from one immutable revision and one successful engineering run. It contains:

1. Cover, project identity and document status
2. Revision history and approvals
3. Design basis and declared assumptions
4. Site location and source imagery
5. Roof geometry, obstacles, setbacks and usable area
6. Panel layout and capacity
7. String schedule and MPPT allocation
8. Single Line Diagram
9. Cable routing plan and cable schedule
10. Inverter placement schedule
11. Battery placement schedule, where applicable
12. Protection, earthing and lightning recommendations
13. Production and loss summary
14. Electrical and engineering BOQ
15. Warnings, exclusions and unresolved items
16. Catalog/version references
17. Reviewer sign-off and report verification identifier

### 12.2 Report statuses and watermarks

| Status | Watermark/use |
|---|---|
| Draft | Internal working document; not for construction |
| Review required | Internal review; unresolved warnings visible |
| Approved for internal use | Approved engineering basis; not automatically customer released |
| Released to customer | Controlled customer copy with release record |
| Superseded | Historical only; clearly marked |

### 12.3 PDF behavior

- Reuse the existing Playwright PDF pipeline.
- Store reports through the private Documents pipeline.
- Record checksum, file size, page count, template version and source revision.
- Use authenticated downloads or short-lived signed access.
- Never use a public bucket URL.
- A report is immutable; changes create a new report version.
- Generation failures remain visible and retryable without changing the engineering revision.

### 12.4 Report traceability

Every report displays:

- report number
- engineering revision
- generation time
- engine/catalog version summary
- prepared by/reviewed by
- approval status
- verification/checksum reference
- explicit limitations

### 12.5 Proposal source-of-truth

Proposal is the final deterministic stage of `SolarDesignPipeline`. It is created before the Engineering Run is sealed and stored as the run’s immutable Proposal Snapshot. It is not generated later by the workspace, a proposal client, a report service or the PDF renderer.

The Proposal stage consumes exact stored outputs from Roof Geometry, Panel Layout V2, Electrical Design and Solar Simulation. Those stage outputs are the sole source for:

- exact placed panel count and DC capacity
- selected module and inverter catalog versions
- string membership and MPPT allocation
- cable routes, sizes and voltage-drop results
- protection, earthing and lightning results
- production/loss results within supported scope
- engineering quantities and warnings

The Proposal stage may also consume commercial inputs pinned in the run input:

- unit prices and supplier price versions
- margins, discounts and approval status
- services, taxes and payment terms
- validity period and commercial exclusions
- customer-facing template content

These values are captured before the run starts and included in the run input hash. They may not alter or independently regenerate technical quantities.

The current pattern in `designStudioProposalIntegration`—snapping calculated DC capacity to a supported nominal size and calling `generateSolarProposal` again—is prohibited for engineering-derived proposals. `snapToSupportedSystemSizeKw` may remain only in a clearly separated budgetary-estimate flow; it cannot define an engineered system.

The sealed Engineering Run stores:

- engineering project ID
- engineering revision ID
- engineering run ID
- Engineering Run Snapshot hash
- Proposal Snapshot hash
- catalog versions
- commercial pricing version
- proposal version/status

Any change to proposal data after sealing—including price, margin or terms—creates a new final SolarDesignPipeline run. For v1.2 there is no stage-reuse shortcut: the pipeline reruns the complete canonical chain and seals a new Proposal Snapshot. A technical design change also requires a new engineering revision. This deliberately favors one obvious source-of-truth over optimization.

### 12.5.1 PDF boundary

PDF generation occurs only after the Engineering Run is sealed. The PDF renderer receives the stored Proposal Snapshot plus approved presentation assets. It may paginate, style, watermark and embed stored diagrams; it may not call SolarDesignPipeline, any engine, `generateSolarProposal`, Quotation Engine or live UI state.

### 12.6 Budgetary estimate separation

A pre-engineering quotation may still use the legacy Solar Proposal/Quotation flow for rapid sales estimates, but it must:

- be labeled **Budgetary Estimate — not engineering-derived**
- use a separate route and document type
- never show an engineering approval badge
- never be accepted as the source for SLD, engineering report or construction BOQ
- convert into a new Engineering Project rather than silently becoming an engineering revision

---

## 13. Backend architecture

### 13.1 Modules

| Module | Responsibility |
|---|---|
| Engineering Project Service | project identity, lead link, assignment and lifecycle |
| Engineering Draft Service | design-session integration, autosave and conflict handling |
| Engineering Revision Service | immutable snapshots and revision comparison |
| Placement Service | inverter, battery, DB, meter and equipment spatial data |
| Cable Route Service | route geometry, measured length and endpoint integrity |
| `SolarDesignPipeline` | sole orchestration entry; sequences Roof, Layout V2, Electrical, Simulation and Proposal, then seals the run |
| Engineering Run Service | stores input/stage outputs, hashes, status and the final Proposal Snapshot |
| SLD Projection Service | converts validated electrical results into display nodes/edges |
| Report Service | completeness gate, PDF job, document storage and versions |
| PDF Renderer Adapter | renders the stored Proposal Snapshot and diagrams; cannot execute engines or proposal logic |
| Approval Adapter | connects engineering revisions to the existing workflow engine |
| Catalog Adapter | resolves versioned panels, inverters, batteries and protection items |
| Audit Adapter | records user actions and state changes |

### 13.2 Orchestration sequence

1. **Engineering Workspace** saves/finalizes an immutable revision and submits one pipeline command through `sunchaserDesignStudioClient`.
2. **SolarDesignPipeline** authorizes the user, loads the revision, pins catalog/commercial inputs and creates an Engineering Run in `running` state.
3. **Roof Geometry** validates and stores the roof-stage output.
4. **Panel Layout V2** consumes the roof output and stores exact placed panels.
5. **Electrical Design** consumes exact placed panels, equipment and normalized cable routes; it stores strings, MPPTs, cables, protection and electrical BOQ.
6. **Solar Simulation** consumes the exact design/electrical inputs and stores production, losses and assumptions within supported scope.
7. **Proposal** consumes only the stored outputs of stages 3–6 plus pinned commercial inputs; it stores the complete Proposal Snapshot.
8. **Seal Engineering Run** computes hashes, persists engine/catalog versions and makes every stage output immutable.
9. **PDF** reads the stored Proposal Snapshot, SLD/route projections and presentation assets; it renders and stores the document without executing any prior stage.

If a stage fails, subsequent dependent stages do not run and the failure identifies the owning stage.

### 13.2.1 Sole-entry rule

Only `SolarDesignPipeline` may import and sequence more than one canonical engine. Individual engines remain independently unit-testable, but no UI, client adapter, proposal adapter, server route, report builder or PDF renderer may compose them into another business flow.

`sunchaserDesignStudioClient` may expose operations such as preview through layout or finalize through proposal, but each operation is a request to SolarDesignPipeline. It cannot call `layoutPanelsOnPlane`, `designElectricalSystem`, `runSolarSimulation`, `generateSolarProposal` or equivalent functions directly.

### 13.2.2 Canonical stage contract

| Stage | Receives | Produces/stores | Must never do |
|---|---|---|---|
| Engineering Workspace | editable draft and user commands | immutable revision request through thin client | import engines, calculate technical results, generate proposal/PDF |
| SolarDesignPipeline | revision ID, run mode, pinned catalog/commercial versions | run ID, stage sequence, status, hashes and sealed run | delegate orchestration to another pipeline or own engineering formulas |
| Roof Geometry | normalized roof/site input | validated planes, areas, orientation, setbacks and warnings | layout panels or infer missing geometry silently |
| Panel Layout V2 | stored roof output, module and layout constraints | exact placed panel IDs/coordinates, count, DC capacity and warnings | choose inverter, size cables or use nominal-system panel count |
| Electrical Design | exact placed panels, equipment, temperatures and routes | strings, MPPT mapping, cable sizes/losses, protection, earthing and electrical BOQ | regenerate panel layout or use legacy proposal calculators |
| Solar Simulation | exact stored design/electrical/site inputs | production, loss, assumptions and support limitations | change technical design or invent unsupported battery claims |
| Proposal | stored outputs from the same run plus pinned commercial inputs | immutable Proposal Snapshot with all source hashes | snap system size, rerun prior stages, read live UI state |
| PDF | sealed Proposal Snapshot, stored diagrams and approved assets | immutable private PDF/document metadata | call Proposal, Quotation, pipeline or any engine |

Each stage records `inputHash`, `outputHash`, engine/schema version, start/end status and warnings. A downstream stage accepts only the stored output reference of the immediately preceding successful run stages; it cannot accept a second client-provided version of the same fact.

### 13.3 Authorization

- Every endpoint requires authentication.
- Lead ownership and company isolation apply before resource access.
- Sales may view/request review but cannot approve engineering.
- Engineers may edit assigned projects and create revisions.
- Engineering Managers may approve/reject.
- Super Admin manages catalogs, feature flags and recovery.
- Report download permissions follow customer-document rules.
- Service-role database credentials remain server-only.

---

## 14. API architecture

The following are contracts, not implementation code.

### 14.1 Project and draft APIs

| Method and path | Purpose |
|---|---|
| `GET /api/leads/:leadId/engineering-project` | load project summary, active draft and readiness |
| `POST /api/leads/:leadId/engineering-project` | create project from the current Design Session |
| `GET /api/engineering-projects/:projectId/draft` | load current editable draft |
| `PUT /api/engineering-projects/:projectId/draft` | save draft with expected version |
| `POST /api/engineering-projects/:projectId/revisions` | freeze current draft as immutable revision |
| `GET /api/engineering-projects/:projectId/revisions` | list revision history |
| `GET /api/engineering-revisions/:revisionId` | load one immutable revision and run status |
| `GET /api/engineering-revisions/:left/compare/:right` | compare inputs, routes, placements, results and warnings |

### 14.2 Placement and route APIs

| Method and path | Purpose |
|---|---|
| `PUT /api/engineering-projects/:projectId/placements` | replace validated placement set within draft version |
| `PUT /api/engineering-projects/:projectId/cable-routes` | replace validated route set within draft version |
| `POST /api/engineering-projects/:projectId/routes/measure` | normalize and measure route geometry only |
| `GET /api/engineering-projects/:projectId/cable-schedule` | return route-linked engine results |

### 14.3 Engineering and SLD APIs

| Method and path | Purpose |
|---|---|
| `POST /api/engineering-revisions/:revisionId/run` | sole execution command; invokes SolarDesignPipeline in preview or final mode |
| `GET /api/engineering-runs/:runId` | load stage outcomes, warnings and hashes |
| `GET /api/engineering-runs/:runId/snapshot` | load immutable input and all stored stage outputs/provenance |
| `GET /api/engineering-runs/:runId/proposal` | load the Proposal Snapshot produced inside the run |
| `GET /api/engineering-runs/:runId/strings` | load string and MPPT projection |
| `GET /api/engineering-runs/:runId/sld` | load derived SLD projection |
| `GET /api/engineering-runs/:runId/readiness` | load explicit readiness and blocking issues |

### 14.4 Report and approval APIs

| Method and path | Purpose |
|---|---|
| `POST /api/engineering-runs/:runId/pdf` | render PDF from the sealed run’s stored Proposal Snapshot only |
| `GET /api/engineering-reports/:reportId` | report metadata and generation status |
| `GET /api/engineering-reports/:reportId/download` | authorized report download |
| `POST /api/engineering-revisions/:revisionId/submit-review` | submit revision to workflow engine |
| `POST /api/engineering-revisions/:revisionId/approve` | manager approval with comment and confirmation |
| `POST /api/engineering-revisions/:revisionId/request-changes` | reject to draft with required action notes |
| `POST /api/engineering-reports/:reportId/release` | create controlled customer release record |

### 14.4.1 Legacy/budgetary API separation

Any endpoint that directly runs `generateSolarProposal`, a canonical engine, or proposal-layer layout/cable/protection calculators without entering through `SolarDesignPipeline` must be classified as legacy/budgetary. The canonical Engineering Workspace must not call it. Only sealed SolarDesignPipeline runs can produce an RC-2 Proposal Snapshot or engineering PDF.

### 14.5 API behavior

- Mutations use idempotency keys where retries may duplicate work.
- Draft mutations require `expectedVersion`.
- Conflict returns HTTP 409 with current version metadata.
- Invalid input returns structured field/stage errors.
- Forbidden ownership/role access returns 403 without resource leakage.
- Missing resource returns 404.
- Missing production schema or unavailable database returns 503; no JSON fallback.
- Long report generation returns job status instead of holding a browser request indefinitely.

---

## 15. Database architecture

### 15.1 Reuse

- `leads`, customers, users and company/ownership data remain CRM authorities.
- `design_sessions` remains the editable design-draft mechanism.
- existing catalog, quotation, workflow, document, inventory and audit data remain authoritative in their domains.

### 15.2 New RC-2 tables

| Table | Purpose and key fields |
|---|---|
| `engineering_projects` | project ID, company, lead, source design session, status, assigned engineer/reviewer, active draft version |
| `engineering_revisions` | immutable revision number, project, source draft version, normalized snapshot, creator, timestamp, parent revision, status |
| `engineering_equipment_placements` | revision/draft, equipment type, catalog version, coordinates/elevation, mounting, clearance and survey metadata |
| `engineering_cable_routes` | revision/draft, route type, endpoints, polyline, vertical length, route factor, method, measured length and confirmation |
| `engineering_runs` | revision, mode, status, input hash, aggregate result hash, engine/catalog/commercial versions, warnings and timestamps |
| `engineering_run_results` | immutable structured outputs by named stage: roof, layout, electrical, simulation and proposal |
| `engineering_run_snapshots` | one sealed normalized input/output manifest per successful final run, with schema version and snapshot hash |
| `engineering_proposal_snapshots` | one-to-one final Proposal-stage output for a sealed run; never independently generated |
| `engineering_sld_projections` | derived display topology and renderer version; never calculation authority |
| `engineering_reports` | revision/run, report number, status, template version, document ID, checksum and generation job state |
| `engineering_approvals` | revision, workflow instance, reviewer, decision, comment, timestamp and signature metadata |
| `engineering_release_records` | controlled customer release, recipient/customer identity, report version and release timestamp |
| `engineering_audit_events` | append-only project/revision actions with actor, event, before/after references and correlation ID |

### 15.3 Storage strategy

- Normalized searchable metadata lives in relational columns.
- Complete immutable revision and engine snapshots may use JSONB, versioned by schema.
- Large images and PDFs live in private object storage, not database JSON.
- Persisted image references must be stable storage objects; never `blob:` browser URLs.
- Every table includes company/tenant scope where applicable.

### 15.4 Integrity rules

- One lead may have multiple engineering projects only when explicitly cloned as variants.
- Revision numbers are unique within a project.
- Revisions cannot be updated after creation.
- Runs reference immutable revisions.
- A successful final SolarDesignPipeline run produces exactly one sealed Engineering Run Snapshot and one Proposal Snapshot.
- Reports reference successful runs.
- Engineering PDFs reference the stored Proposal Snapshot hash and may not store conflicting technical quantities.
- Approved revisions cannot be edited; changes create a child revision.
- Cable endpoints must reference valid placements, strings, equipment or PCC nodes.
- Every placed panel in a valid string projection appears exactly once.
- RLS enforces tenant and permitted-role access.

### 15.5 Backup and recovery

- New tables enter existing Super-Admin-gated backup/restore coverage.
- Schema migration is additive and idempotent.
- A pre-release data export is mandatory.
- Restore drills must prove project, revision, report and private-document recovery.
- Database unavailability or a paused Supabase project is a visible service outage, never permission to use production JSON fallback.

---

## 16. Engine boundaries and dependency rules

### 16.1 Allowed direction

| Caller | May call |
|---|---|
| Engineering Workspace | `sunchaserDesignStudioClient` only |
| `sunchaserDesignStudioClient` | Engineering API only; request shaping and view-model mapping |
| Engineering API | SolarDesignPipeline and run/repository services |
| `SolarDesignPipeline` | canonical V2 roof, panel, electrical, simulation and proposal-stage assembler |
| Proposal-stage assembler | stored outputs from earlier stages of the same run plus pinned proposal inputs |
| SLD projection | saved engine outputs only |
| PDF renderer | sealed Proposal Snapshot, stored diagrams and presentation assets only |
| Quotation/inventory integration | sealed run outputs through explicit downstream adapters |

### 16.2 Forbidden direction

- Engines must not import React, Express, Supabase, CRM, PDF or storage code.
- UI and `sunchaserDesignStudioClient` must not import server engine internals or proposal generators.
- Only `SolarDesignPipeline` may import multiple canonical engines or sequence engineering stages.
- `SolarDesignPipeline` must not import legacy proposal-layer layout, cable or protection calculators.
- No route or adapter may bypass SolarDesignPipeline to create an engineering stage output.
- Proposal integration must not use nominal-size snapping to regenerate engineered quantities.
- Proposal cannot be executed outside a SolarDesignPipeline run.
- PDF rendering cannot call SolarDesignPipeline, Proposal, Quotation or any engineering engine.
- Report templates must not calculate engineering values.
- SLD renderer must not change string or protection results.
- Inventory availability must not change an approved engineering result silently.
- AI may explain warnings or suggest next actions, but may not invent or approve engineering output.

### 16.3 Staleness graph

Changes invalidate dependent results:

| Change | Results marked stale |
|---|---|
| Roof geometry/scale/obstacle | layout, strings, routes, electrical, simulation, SLD, report |
| Panel module/layout | strings, electrical, simulation, SLD, report |
| Inverter catalog/placement | strings, routes, electrical, simulation, SLD, report |
| Battery catalog/placement | battery route, protection, applicable simulation, SLD, report |
| Cable route | electrical, simulation cable loss, SLD cable schedule, report |
| Catalog version | affected calculations, BOQ and report |
| Approval comment only | no calculation invalidation; audit/report status may change |

---

## 17. Security and governance

1. Enforce Supabase RLS and server ownership checks for every new table and endpoint.
2. Store service-role keys only on the server.
3. Keep engineering images and reports private.
4. Use short-lived signed downloads where direct storage access is necessary.
5. Validate all provider, route, geometry and report inputs as untrusted.
6. Sanitize image URLs and embedded report content.
7. Record approval and customer release as append-only audit events.
8. Prevent Sales and Customer roles from approving engineering.
9. Restrict catalog/rule changes and record their effective versions.
10. Treat the currently public repository as a commercial/IP risk; production approval requires a repository-visibility and secret-history decision.

---

## 18. Testing architecture

### 18.1 Unit tests

| Area | Required coverage |
|---|---|
| Route geometry | polyline length, vertical rise, route factor, invalid points, scale changes |
| Placement validation | catalog rules, missing clearance data, invalid anchors, stale dependencies |
| SLD projection | topology by system type, node/edge integrity, stable ordering, missing optional nodes |
| String projection | every panel once, colors/labels, MPPT grouping, invalid/orphan handling |
| Revision service | immutability, numbering, hashes, parent links and staleness |
| Report completeness | blocking gates, warning inclusion, status watermark and source references |
| Authorization | tenant isolation, ownership, engineer/manager separation and download controls |

Existing engine suites remain mandatory and must not be replaced by UI tests.

Gate 0 adds mandatory architecture tests:

- canonical Engineering Workspace has no imports from legacy proposal-layer layout/cable/protection calculators
- canonical run API reaches exactly one orchestrator
- `SolarDesignPipeline` is the only module that imports and sequences multiple canonical engines
- every Engineering Workspace preview/final command reaches `SolarDesignPipeline` through the thin client/API
- `sunchaserDesignStudioClient` has no direct server-engine, proposal-generator or PDF-compiler imports
- Proposal executes exactly once as a named stage inside a final SolarDesignPipeline run
- Proposal stage never calls `snapToSupportedSystemSizeKw` or reconstructs technical quantities from nominal size
- PDF rendering reads the stored Proposal Snapshot and invokes no engineering/proposal engine
- only one CRM navigation route can open an editable engineering workspace

### 18.2 Contract tests

- normalized workspace-to-engine inputs match engine schemas
- engine result-to-SLD projection preserves string, MPPT and protection identity
- engine result-to-report preserves exact values and units
- report-to-document pipeline preserves checksum/version/private access
- quotation/inventory adapters consume approved outputs without mutating engineering revisions
- Engineering Run Snapshot exactly preserves input, panel count, DC capacity, equipment, strings, routes, electrical, simulation, proposal and warnings
- engineering report/PDF references the same sealed run and Proposal Snapshot hashes
- any proposal/pricing change creates a new complete final SolarDesignPipeline run; no out-of-run or stage-reuse shortcut exists in RC-2

### 18.3 Golden/snapshot tests

Maintain reviewed reference projects:

1. 6 kW single-phase on-grid residential
2. 8 kW hybrid with one battery bank
3. 10 kW three-phase on-grid with multiple MPPTs
4. 15 kW large residential/commercial boundary case
5. invalid cold-Voc stringing
6. excessive DC cable route/voltage drop
7. missing battery clearance data
8. multi-plane roof with obstacles and walkways

For each, compare:

- panel count and IDs
- string membership and MPPT mapping
- route lengths
- cable sizes and voltage drop
- protection schedule
- SLD topology
- report values and page presence

### 18.4 End-to-end tests

1. Open lead and create engineering project.
2. Restore RC-1.1 design session.
3. Place inverter/battery.
4. Draw routes.
5. Freeze revision and run engineering.
6. Inspect strings and SLD.
7. Generate and download private PDF.
8. Submit, request changes, revise and approve.
9. Release controlled customer copy.
10. Verify an unauthorized user cannot access project or report.
11. Create a commercial proposal and verify every technical value matches the engineering snapshot.
12. Attempt legacy studio/pipeline entry points and verify redirect, read-only or budgetary labeling behavior.

### 18.5 Non-functional tests

- complex 500+ panel visualization performance
- report generation duration and memory
- concurrent edit conflicts
- repeated idempotent run/report requests
- Supabase outage behavior
- private storage outage behavior
- provider unavailable/key missing behavior
- mobile/tablet review rendering
- keyboard accessibility and color-independent string identification
- restore from backup

### 18.6 Release gate

RC-2 cannot pass unless:

- existing RC-1.1 tests remain green
- all new unit/contract/E2E suites pass
- no cross-tenant access is possible
- no public report or image URL is used
- report values match engine results exactly
- rollback and restore are demonstrated
- all P0/P1 issues are closed or explicitly accepted by the CTO
- no canonical path imports or executes a compatibility calculator
- one and only one editable Engineering Workspace is reachable from CRM
- engineering report and commercial proposal prove snapshot-hash consistency

---

## 19. Competitor comparison

This comparison uses current official documentation and is a product-direction benchmark, not a certification of equivalence.

| Capability | HelioScope | Aurora Solar | PVsyst | Sunchaser RC-2 target |
|---|---|---|---|---|
| Electrical/string design | Strong wiring-zone, stringing, combiner and inverter workflow | Strong design-to-plan-set workflow | Detailed sub-array/system definition | Existing Electrical Design Engine plus CRM-native visualization |
| Physical conductor routing | Inverter/combiner movement reroutes conductors and updates lengths | Plan-set conductor/circuit workflow | Primarily electrical/loss definition rather than CRM spatial workflow | Explicit DC/AC/battery/earth route layers tied to placements |
| SLD | Detailed electrical summary | Single-line and three-line plan-set options | SLD editor/viewer for grid-connected systems | Derived on-grid/hybrid/off-grid SLD with CRM revision control |
| Voltage drop/loss | Conductor distance and resistance-based modeling | Conductor tables can include circuit length and voltage drop | Deep ohmic-loss modeling and wire optimization | Existing Electrical and Simulation engines; must remain honest about model depth |
| Battery | Product-dependent workflow; not RC-2 benchmark authority | Storage design/plan workflows available in product ecosystem | Storage simulation is a major strength, while current SLD documentation excludes storage | Battery placement/protection/review first; dispatch model only after engine validation |
| Report/plan set | Production report, BOM and SLD | Highly polished permit/plan sets | Detailed simulation report and loss diagram | CRM-native engineering report plus approval, quotation and documents |
| CRM/business integration | Limited relative to Sunchaser business workflow | Strong sales/design platform | Primarily engineering simulation | Native lead, quotation, inventory, workflow and customer-document integration |
| Pakistan localization | Not Sunchaser-specific | Not Sunchaser-specific | User-configurable engineering tool | Pakistan-first catalogs, earthing/protection policies, PKR quotation and Sunchaser workflow |

### 19.1 Lessons adopted

From **HelioScope**:

- moving equipment should affect route lengths and voltage-drop results
- wiring zones, strings, home runs and conductor schedules need linked visual behavior
- SLD and BOM must derive from the same electrical definition

From **Aurora Solar**:

- report/plan-set generation should be a persistent project workflow with revisions
- electrical diagrams, conductor tables and fire/access information belong in one controlled package
- the design and its generated document must remain linked

From **PVsyst**:

- assumptions and losses must be explicit
- simulation depth and electrical-loss models require validation, not marketing language
- complex topology may fail; the system must report the limitation rather than fabricate a diagram

### 19.2 Deliberate Sunchaser differentiation

RC-2 should not try to clone all three products. Its advantage is:

- CRM-native engineering from lead to approved report
- Pakistan-focused equipment and business rules
- hybrid/battery placement inside the same workflow
- quotation and inventory handoff
- private customer-document delivery
- explicit revision, approval and audit history

### 19.3 Honest gap statement

At RC-2, Sunchaser will still trail mature competitors in validated weather datasets, bankable simulation depth, automated permitting content, large-commercial topology handling, shading sophistication and catalog breadth. Those gaps must remain visible in product claims and reports.

Official benchmark references:

- HelioScope Electrical Design: https://help-center.helioscope.com/hc/en-us/articles/4419953067411-4-Electrical-Design
- HelioScope stringing: https://help-center.helioscope.com/hc/en-us/articles/8198326521491-Stringing-in-HelioScope
- HelioScope conductor optimization: https://help-center.helioscope.com/hc/en-us/articles/8198466034323-Optimize-conductor-sizes
- Aurora Instant Plan Sets: https://help.aurorasolar.com/hc/en-us/articles/33543611295379-Instant-Plan-Sets
- PVsyst Single Line Diagram: https://www.pvsyst.com/help/project-design/grid-connected-system-definition/single-line-diagram.html
- PVsyst array ohmic wiring loss: https://www.pvsyst.com/help/project-design/array-and-system-losses/ohmic-losses/array-ohmic-wiring-loss.html
- PVsyst wire optimization: https://www.pvsyst.com/help/glossary/pv-system/wire-diameter-optimisation.html

---

## 20. Key risks and controls

| Risk | Impact | Control |
|---|---|---|
| Duplicate calculations appear in UI/report | conflicting engineering values | architectural dependency tests and one-owner rule |
| `SolarDesignPipeline` remains falsely “unified” | two valid-looking technical outputs | make it the sole entry and replace its legacy dependencies with canonical V2 engines |
| Proposal reruns design from snapped nominal size | panel/BOQ/PDF divergence | Proposal is an in-run stage consuming exact stored prior-stage outputs |
| Multiple editable studios remain reachable | divergent state, saves and exports | one CRM route/feature flag; legacy surfaces redirect, wrap read-only or retire |
| Aggregate cable length loses route detail | inaccurate BOQ and voltage-drop interpretation | persist route-level data and extend owning engine contract where needed |
| SLD appears valid after source edit | unsafe/stale report | dependency staleness graph and run/revision ID shown on SLD |
| Battery rules become generic safety claims | safety and liability | versioned manufacturer data, warnings and manager confirmation |
| Manual string editing bypasses engine | invalid voltage/MPPT design | view-only RC-2.0; engine-validated override only later |
| Uploaded roof image cannot restore | incomplete revision | private asset upload before revision; no blob URL persistence |
| Large commercial system exceeds engine limits | false readiness | supported-range gate, explicit unsupported status and no report approval |
| PDF generated but not retained | audit/commercial gap | Documents pipeline, immutable report versions and checksums |
| Supabase RLS error exposes projects | severe privacy breach | tenant/role tests, RLS review and server ownership checks |
| Public repository exposes IP/history | commercial/security risk | separate governance decision before production |
| Google provider cost/quota/key failure | map workflow outage | fail-closed provider status, manual coordinates/upload and monitored quotas |
| Catalog changes alter old designs | irreproducible reports | catalog-version pinning per revision/run |
| Report implies professional certification | legal/commercial risk | document status, limitations and authorized sign-off policy |

---

## 21. Release plan

### RC-2 Gate 0 — Single Pipeline Consolidation

This gate must complete before RC-2A.

Deliver:

- authoritative engine classification register
- refactored `SolarDesignPipeline` contract over V2 roof/panel/electrical/simulation engines and in-run Proposal stage
- legacy proposal-layer layout/cable/protection calculators removed from SolarDesignPipeline and all RC-2 runtime paths
- thin `sunchaserDesignStudioClient` contract with no direct engines
- immutable Engineering Run Snapshot and Proposal Snapshot contracts
- proposal/quotation boundary that consumes snapshot technical facts
- one canonical Engineering Workspace navigation route, feature flag and command surface
- disposition of `SunchaserDesignStudio`, `DesignStudioProposalPreview` and legacy proposal studio flows
- import-boundary and proposal-parity tests

Exit gate:

- one reference project produces one technical output across workspace, SLD, engineering report and commercial proposal
- canonical technical quantities never change during proposal generation
- no competing editable workspace or alternate engineering pipeline is reachable
- Codex architecture audit returns PASS

### RC-2A — Foundation and revision model

Deliver:

- Engineering Project lifecycle
- Design Session handoff
- draft/version conflict handling
- immutable revisions
- engine-run snapshots and hashes
- immutable Engineering Run/Proposal Snapshot persistence
- RLS/ownership/audit foundation

Exit gate: create, save, restore, revise and compare without data loss or cross-tenant access.

### RC-2B — Placements and routes

Deliver:

- inverter placement
- battery placement
- equipment inspector
- cable route editor and schedules
- stale-dependency behavior
- route-to-Electrical-Engine integration

Exit gate: moving equipment changes measured routes and refreshed engine results correctly.

### RC-2C — Strings and SLD

Deliver:

- string/MPPT canvas overlay
- synchronized string table
- derived SLD for supported on-grid, hybrid and off-grid topologies
- linked warnings and route highlighting

Exit gate: every SLD/string value traces exactly to one successful Electrical Design Engine result.

### RC-2D — Engineering Report and approval

Deliver:

- report completeness gate
- PDF generation through existing renderer
- private document storage
- report versions/checksums
- review, approval, changes-requested and controlled release

Exit gate: approved report is immutable, private, reproducible and linked to revision/run.

### RC-2E — Hardening and development release

Deliver:

- full regression suite
- 500+ panel performance test
- outage/concurrency/security tests
- backup/restore drill
- user acceptance by Sales, Engineer and Manager roles
- release verification and rollback package

Exit gate: CTO approves **development release** only.

### Later production gate

Production launch requires a separate decision after:

- public-repository and security-history resolution
- real catalog/manual review
- supported-system-size policy
- engineering disclaimer/legal review
- provider keys, quotas and monitoring
- operational support and incident plan
- customer-facing UAT
- production backup and rollback rehearsal

---

## 22. Delivery ownership protocol

| Tool/agent | Assigned responsibility |
|---|---|
| **Codex** | architecture guardianship, engine-boundary review, risk review and release-gate audit |
| **Claude Code** | implementation decomposition, dependency sequencing, migration/merge preparation and conflict analysis |
| **Cursor** | all repository code implementation, tests and commits from approved work packages |
| **Antigravity** | UI walkthrough, browser/E2E verification, screenshots, regression evidence and release orchestration |
| **GPT-5.6 Work Mode** | final CTO/commercial review, evidence reconciliation and approve/hold decision |

No implementation agent may change an engine boundary or add a calculation without returning the proposal to Codex architecture review.

---

## 23. Definition of done

RC-2 Technical Architecture is implemented only when:

1. One CRM Engineering Workspace covers all seven requested modules.
2. `SolarDesignPipeline` is the only RC-2 orchestration runtime and calls only registered V2 engines plus its in-run Proposal assembler.
3. `sunchaserDesignStudioClient` is a thin client over SolarDesignPipeline and imports no engines.
4. Legacy proposal-layer layout/cable/protection calculators are not reachable from any RC-2 engineering path.
5. Proposal is stored inside the sealed Engineering Run and never regenerated by workspace, report or PDF paths.
6. PDF renders the stored Proposal Snapshot without invoking calculations.
7. Placements and cable routes persist and restore without browser-local authority.
8. String and SLD views trace to Electrical Design Engine outputs.
9. Cable route changes invalidate and refresh dependent results.
10. Reports are immutable, private, versioned and auditable.
11. Roles, tenant isolation and approvals are enforced at API and database levels.
12. Supported and unsupported engineering ranges are explicit.
13. Backup and rollback work.
14. RC-2 passes its internal release gate without being represented as production-ready.

---

## 24. Final architecture verdict

**RC-2 Architecture v1.2 defines one canonical flow and is feasible, but implementation remains conditional on Gate 0 passing.**

The Codex HOLD is accepted. v1.2 makes `SolarDesignPipeline` the only orchestration entry, makes `sunchaserDesignStudioClient` a thin client over it, places Proposal inside the immutable Engineering Run, and limits PDF to rendering stored run output.

Implementation must begin with **RC-2 Gate 0**, not RC-2A. RC-2A may start only after Codex verifies that alternate pipelines, proposal recalculation and competing editable studios are no longer reachable from the canonical path.
