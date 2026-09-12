/**
 * AI Quote Builder mobile-app invariants (source-level).
 *
 * The mobile app bundles the same Vite build as the web CRM, so there is one
 * AI Quote Builder and one quotation engine. These tests guard two things:
 *
 *  1. the mobile presentation the phone app needs (full-screen sheet, reachable
 *     action bar, no phone-hostile multi-column grids or 640px tables), and
 *  2. that the presentation work did NOT fork the quotation engine, drop
 *     advanced fields, or add an automatic save / message / catalog sync.
 *
 * Run: npm run test:ai-quote-mobile
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "../..");
const modal = readFileSync(join(here, "AIQuoteBuilderModal.tsx"), "utf8");
const scopeSection = readFileSync(join(here, "ProjectScopeSection.tsx"), "utf8");
const lineTable = readFileSync(join(here, "ScopeLineTable.tsx"), "utf8");
const picker = readFileSync(join(here, "CatalogProductPicker.tsx"), "utf8");
const appModal = readFileSync(join(srcRoot, "components/ui/AppModal.tsx"), "utf8");

/* ── 1. one quotation system, not two ─────────────────────────────── */

await test("there is exactly one AI Quote Builder component", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() ? [full] : [];
    });
  const builders = walk(srcRoot).filter((f) => /AIQuoteBuilder.*\.tsx$/.test(f));
  assert.deepEqual(
    builders.map((f) => f.slice(srcRoot.length + 1)),
    ["components/quoteAuthoring/AIQuoteBuilderModal.tsx"]
  );
});

await test("no mobile-only fork of the project scope engine", () => {
  const scopeDir = join(srcRoot, "lib/quoteProjectScope");
  const forks = readdirSync(scopeDir).filter((f) => /mobile|phone|native/i.test(f));
  assert.deepEqual(forks, []);
});

await test("the modal still applies the shared engine's payload verbatim", () => {
  // Pricing, BOQ rows and the scope snapshot all come from the shared builder.
  assert.ok(modal.includes("buildCommercialDraftApply(commercialConfig)"));
  assert.ok(modal.includes("onApplyDraft(applyPayload)"));
  // No mobile-specific pricing arithmetic was introduced.
  assert.equal(/mobileRate|phoneRate|mobilePrice|MOBILE_RATE/.test(modal), false);
});

await test("validation still comes from the shared commercial validator", () => {
  assert.ok(modal.includes("validateCommercialQuoteConfig(commercialConfig)"));
});

/* ── 2. apply flow is still manual ────────────────────────────────── */

await test("Apply draft does not save, message, or sync the catalog", () => {
  const handler = modal.slice(modal.indexOf("const handleApply"), modal.indexOf("const structureSummary"));
  assert.ok(handler.includes("if (validationErrors.length) return;"));
  assert.ok(handler.includes("onApplyDraft(applyPayload)"));
  // Draft only: no persistence, no customer contact, no catalog job.
  for (const forbidden of ["saveQuote", "fetch(", "whatsapp", "WhatsApp", "catalogSync", "syncNow"]) {
    assert.equal(handler.includes(forbidden), false, `handleApply must not reference ${forbidden}`);
  }
});

await test("the draft-only wording stays visible to the salesperson", () => {
  assert.ok(modal.includes("Draft only"));
  assert.ok(modal.includes("you must save manually"));
});

/* ── 3. mobile shell ──────────────────────────────────────────────── */

await test("AppModal full-screen mode is opt-in so other modals are untouched", () => {
  assert.ok(appModal.includes("mobileFullScreen?: boolean"));
  assert.ok(appModal.includes("mobileFullScreen = false"));
  // Full screen below md, centred dialog from md up.
  assert.ok(appModal.includes('mobileFullScreen ? "p-0 md:p-4" : "p-4"'));
  assert.ok(appModal.includes('h-full max-h-none md:h-auto md:max-h-[90vh]'));
});

await test("the AI Quote Builder opts into the full-screen mobile sheet", () => {
  assert.ok(modal.includes("<AppModal open={open} onClose={onClose} mobileFullScreen"));
  // Desktop keeps its wide centred panel.
  assert.ok(modal.includes('panelClassName="max-w-7xl"'));
  // Column shell on phones; the original block layout from md up.
  assert.ok(modal.includes("flex h-full flex-col"));
  assert.ok(modal.includes("md:h-auto md:block"));
});

await test("mobile top bar has a Back affordance and a title", () => {
  assert.ok(modal.includes('aria-label="Back"'));
  assert.ok(modal.includes("md:hidden"));
  assert.ok(modal.includes("AI Quote Builder</h2>"));
  // Respects the status bar / notch.
  assert.ok(modal.includes("safe-area-top"));
});

await test("the content area is the single scroll region on mobile", () => {
  assert.ok(modal.includes("min-h-0 flex-1 overflow-y-auto overscroll-contain"));
  assert.ok(modal.includes("md:flex-none md:overflow-visible"));
});

await test("sticky action area shows total, error count and Apply above the keyboard", () => {
  assert.ok(modal.includes("Estimated total"));
  assert.ok(modal.includes("{validationErrors.length} to fix"));
  assert.ok(modal.includes("Apply draft to BOQ"));
  // Bottom inset keeps the button clear of the Android nav bar / home indicator.
  assert.ok(modal.includes("pb-[max(0.75rem,env(safe-area-inset-bottom))]"));
  // Apply stays gated on validation.
  assert.ok(modal.includes("disabled={validationErrors.length > 0}"));
});

/* ── 4. no phone-hostile layout ───────────────────────────────────── */

await test("no multi-column grid is left unprefixed in the builder", () => {
  // An unprefixed `grid-cols-3` applies at 390px too. Every multi-column grid
  // must either start at 1 column or be explicitly narrowed for phones.
  const classNames = modal.match(/className="[^"]*grid-cols-[^"]*"/g) || [];
  assert.ok(classNames.length > 0, "expected grid classes to exist");
  for (const cls of classNames) {
    const multiCol = /(?:^|["\s])grid-cols-([2-9])/.exec(cls);
    if (!multiCol) continue;
    // A multi-column base is only acceptable at 2 columns (compact numeric pairs).
    assert.ok(
      multiCol[1] === "2",
      `phone layout starts at ${multiCol[1]} columns: ${cls}`
    );
  }
});

await test("number fields request a numeric keyboard", () => {
  const numberFields = (modal.match(/type="number"/g) || []).length;
  const numericKeyboards = (modal.match(/inputMode="decimal"/g) || []).length;
  assert.ok(numberFields > 0);
  assert.equal(numericKeyboards, numberFields);
});

await test("chips and pickers meet the 44px touch target on phones", () => {
  assert.ok(modal.includes("min-h-[44px] rounded-xl px-3 py-2 text-xs font-bold md:min-h-0"));
  assert.ok(scopeSection.includes("min-h-[44px]"));
  assert.ok(picker.includes("min-h-[44px]"));
});

/* ── 5. advanced project scope on a phone ─────────────────────────── */

await test("scope lines render as cards on phones and as the table from md up", () => {
  assert.ok(lineTable.includes('<ul className="space-y-2 md:hidden">'));
  assert.ok(lineTable.includes('<div className="hidden overflow-x-auto md:block">'));
  // The desktop table is unchanged, including its minimum width.
  assert.ok(lineTable.includes('className="w-full min-w-[640px] text-left text-[11px]"'));
});

await test("the mobile card keeps every field the table shows", () => {
  const card = lineTable.slice(lineTable.indexOf("function ScopeLineCard"));
  for (const field of ["Include", "Specification", "Qty", "Rate", "Total", "scopeStatus"]) {
    assert.ok(card.includes(field), `mobile card dropped ${field}`);
  }
  // Same mutation path as the table row — no second source of truth.
  assert.ok(card.includes("patchLine(line, { include:"));
  assert.ok(card.includes('rateSource: "manual"'));
  assert.ok(card.includes("lineAmount(line)"));
  // Pending / excluded lines still are not priced.
  assert.ok(card.includes('line.inclusionState === "included" ? money(total) : "—"'));
  assert.ok(card.includes("no invented price"));
});

await test("advanced scope sections stay collapsible with a real touch target", () => {
  assert.ok(lineTable.includes("<details"));
  assert.ok(lineTable.includes("min-h-[44px] cursor-pointer"));
});

await test("the scope matrix stays a stacked Included / Excluded / Pending view", () => {
  const matrix = readFileSync(join(here, "ScopeMatrix.tsx"), "utf8");
  assert.ok(matrix.includes("grid-cols-1 md:grid-cols-3"));
  assert.ok(matrix.includes('title="Included"'));
  assert.ok(matrix.includes('title="Excluded"'));
  assert.ok(matrix.includes("Conditional / pending site survey"));
});

await test("advanced fields were not removed to make the phone layout smaller", () => {
  // Spot-check the engineering fields PR #43 introduced.
  const structure = readFileSync(join(here, "StructureScopeEditor.tsx"), "utf8");
  const electrical = readFileSync(join(here, "ElectricalScopeEditor.tsx"), "utf8");
  for (const field of ["Girder type", "Steel grade", "Base plate", "Wind-load design"]) {
    assert.ok(new RegExp(field, "i").test(structure), `missing structure field: ${field}`);
  }
  for (const section of ["DC cabling", "AC cabling", "Earthing", "Lightning", "Monitoring"]) {
    assert.ok(new RegExp(section, "i").test(electrical), `missing electrical section: ${section}`);
  }
  assert.ok(scopeSection.includes("Advanced Project Scope"));
  for (const cls of ["Residential", "Commercial", "Industrial", "Custom"]) {
    assert.ok(scopeSection.includes(cls), `missing project class: ${cls}`);
  }
});

/* ── 6. desktop is untouched ──────────────────────────────────────── */

await test("no mobile style leaks above the md breakpoint", () => {
  // Every mobile-only affordance is either md:hidden or reset at md.
  assert.ok(modal.includes("md:min-h-0"));
  assert.ok(modal.includes("md:px-0"));
  assert.ok(modal.includes("md:rounded-3xl"));
  // The desktop two-column layout with the live summary sidebar survives.
  assert.ok(modal.includes("xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]"));
});

await test("the picker closes on an outside tap instead of floating over fields", () => {
  assert.ok(picker.includes('document.addEventListener("pointerdown", onPointerDown)'));
  assert.ok(picker.includes('document.removeEventListener("pointerdown", onPointerDown)'));
  // Catalog identity is still what gets selected — no local product invention.
  assert.ok(picker.includes("onSelect(product)"));
});

await test("mobile presentation adds no browser storage for quote data", () => {
  for (const [name, source] of [
    ["AIQuoteBuilderModal", modal],
    ["ScopeLineTable", lineTable],
    ["CatalogProductPicker", picker],
    ["ProjectScopeSection", scopeSection],
  ] as const) {
    assert.equal(/localStorage|sessionStorage|indexedDB/.test(source), false, `${name} must not persist to browser storage`);
  }
});

if (failed > 0) {
  console.error(`\n${failed} AI quote builder mobile test(s) failed.`);
  process.exit(1);
}
console.log("\nAll AI quote builder mobile layout tests passed.");
