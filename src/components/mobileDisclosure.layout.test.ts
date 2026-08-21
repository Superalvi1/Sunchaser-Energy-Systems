/**
 * Mobile CRM disclosure invariants (source-level).
 *
 * Guards the "summary first → tap to expand → details second" mobile rules without
 * removing any existing desktop functionality.
 * Run: npm run test:mobile-disclosure
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const disclosure = readFileSync(join(here, "ui/MobileDisclosure.tsx"), "utf8");
const crm = readFileSync(join(here, "CRMApp.tsx"), "utf8");
const sales = readFileSync(join(here, "SalesTeamApp.tsx"), "utf8");
const adminNav = readFileSync(join(here, "AdminModuleNav.tsx"), "utf8");
const ai = readFileSync(join(here, "AICommandCenter.tsx"), "utf8");

/* ── shared primitive ─────────────────────────────────────────────── */

await test("disclosure primitive is accessible and touch friendly", () => {
  assert.ok(disclosure.includes("aria-expanded={open}"));
  assert.ok(disclosure.includes("aria-controls={panelId}"));
  assert.ok(disclosure.includes('type="button"'));
  // >=48px touch target
  assert.ok(disclosure.includes("min-h-[48px]"));
  // open state is conveyed by chevron rotation, not colour alone
  assert.ok(disclosure.includes('rotate-180'));
  assert.ok(disclosure.includes('aria-hidden="true"'));
});

await test("mobile breakpoint matches the design system md breakpoint", () => {
  assert.ok(disclosure.includes('MOBILE_MEDIA_QUERY = "(max-width: 767px)"'));
  assert.ok(disclosure.includes("matchMedia"));
  // responds to rotation / resize rather than sampling once
  assert.ok(disclosure.includes('addEventListener("change"'));
  assert.ok(disclosure.includes('removeEventListener("change"'));
});

await test("disclosure state is local UI state only — no browser storage", () => {
  assert.equal(/localStorage|sessionStorage/.test(disclosure), false);
});

/* ── 2. CRM client cards ──────────────────────────────────────────── */

await test("CRM client cards collapse by default on mobile", () => {
  // nothing expanded initially
  assert.ok(crm.includes("useState<string | null>(null)"));
  assert.ok(crm.includes("const isExpanded = expandedLeadId === lead.id;"));
  // details render on desktop always; on mobile only when expanded or editing
  assert.ok(crm.includes("const showDetails = !isMobile || isExpanded || isEditing;"));
  assert.ok(crm.includes(") : showDetails ? ("));
});

await test("CRM client card expands on tap and exposes state", () => {
  assert.ok(crm.includes("aria-expanded={isExpanded}"));
  assert.ok(crm.includes("setExpandedLeadId((current) => (current === lead.id ? null : lead.id))"));
  // one open at a time: a single id, not a set
  assert.equal(/expandedLeadIds|Set<string>/.test(crm), false);
});

await test("collapsed CRM row shows only the summary fields", () => {
  assert.ok(crm.includes("{lead.status}"));
  assert.ok(crm.includes("Prob {probPercent}%"));
  assert.ok(crm.includes("formatLeadLocation(lead)"));
  assert.ok(crm.includes("crm-lead-summary-"));
  assert.ok(crm.includes("crm-lead-details-"));
});

await test("CRM keeps every existing action available once expanded", () => {
  for (const marker of ["WhatsAppModule", "handleEditClick", "onDeleteLead", "runAiLeadScoring"]) {
    assert.ok(crm.includes(marker), `missing ${marker}`);
  }
});

/* ── 3. Target Clients ────────────────────────────────────────────── */

await test("Target Clients collapses by default on mobile", () => {
  assert.ok(sales.includes("const [targetClientsOpen, setTargetClientsOpen] = useState(false);"));
  assert.ok(sales.includes('data-testid="target-clients-toggle"'));
  assert.ok(sales.includes("aria-expanded={targetClientsOpen}"));
  assert.ok(sales.includes("{(!isMobile || targetClientsOpen) && ("));
});

await test("Target Clients rows stay compact", () => {
  assert.ok(sales.includes("{lead.status}"));
  assert.ok(sales.includes("Prob: {lead.conversionProbability || 50}%"));
  assert.ok(sales.includes("Units:"));
});

/* ── 4. Sales Advisor tool grid ───────────────────────────────────── */

await test("Sales Tools grid collapses on mobile and keeps every destination", () => {
  assert.ok(sales.includes("const [salesToolsOpen, setSalesToolsOpen] = useState(false);"));
  assert.ok(sales.includes('data-testid="sales-tools-toggle"'));
  assert.ok(sales.includes("aria-expanded={salesToolsOpen}"));
  assert.ok(sales.includes('aria-controls="sales-tools-panel"'));
  for (const label of [
    "Auto Sizer",
    "Roof Studio",
    "Manual BOQ Builder",
    "Quote Templates",
    "Generated Quotes",
    "Product Library",
    "Inventory",
    "After Sales Admin",
  ]) {
    assert.ok(sales.includes(label), `missing tool: ${label}`);
  }
});

/* ── 5. Manual BOQ action area ────────────────────────────────────── */

await test("Manual BOQ keeps every action reachable", () => {
  for (const label of [
    "Add Item",
    "Add Heading",
    "Add Subtotal",
    "AI Quote Builder",
    "New Quote",
    "Load Package",
    "Save as New Package",
    "Copy Auto Sizer",
    "Load Saved Quote",
    "Reset to Defaults",
    "Update Loaded Package",
  ]) {
    assert.ok(sales.includes(label), `missing BOQ action: ${label}`);
  }
});

await test("BOQ secondary actions have a single definition used by both layouts", () => {
  assert.ok(sales.includes("const renderBoqSecondaryActions = () => ("));
  // rendered inline on desktop and inside the mobile sheet
  const calls = sales.match(/renderBoqSecondaryActions\(\)/g) || [];
  assert.equal(calls.length, 2, `expected 2 render sites, got ${calls.length}`);
  assert.ok(sales.includes('data-testid="boq-more-actions"'));
  assert.ok(sales.includes("MobileActionSheet"));
});

/* ── 1. Admin dashboard groups ────────────────────────────────────── */

await test("admin modules are grouped and collapsed on phones", () => {
  assert.ok(adminNav.includes("DisclosureSection"));
  assert.ok(adminNav.includes("useSingleOpen<string>(null)"));
  assert.ok(adminNav.includes("MOBILE_GROUP_META"));
  for (const label of [
    "Business & Finance",
    "Projects & Delivery",
    "Inventory & Suppliers",
    "Service & Support",
    "Reports & Analytics",
    "System Administration",
  ]) {
    assert.ok(adminNav.includes(label), `missing group: ${label}`);
  }
});

await test("admin quick access row exposes the four primary destinations", () => {
  assert.ok(adminNav.includes("Quick access"));
  assert.ok(adminNav.includes('label: "CRM"'));
  assert.ok(adminNav.includes('label: "Sales Advisor"'));
  assert.ok(adminNav.includes('label: "Quotations"'));
  assert.ok(adminNav.includes('label: "Finance"'));
});

await test("desktop admin sidebar behaviour is preserved", () => {
  // desktop still renders the shared nav body in the sticky sidebar
  assert.ok(adminNav.includes('<aside className="hidden lg:block w-64 shrink-0">'));
  assert.ok(adminNav.includes("{navBody}"));
  // tablet keeps the flat grid
  assert.ok(adminNav.includes("hidden gap-2 md:grid md:grid-cols-4"));
});

/* ── 9. Floating AI assistant ─────────────────────────────────────── */

await test("floating AI button respects the Android safe area", () => {
  assert.ok(ai.includes("env(safe-area-inset-bottom"));
  assert.equal(ai.includes('"fixed bottom-6 right-6 z-[60]"'), false);
  // modals/sheets sit above the FAB
  assert.ok(ai.includes("z-[60]"));
  assert.ok(disclosure.includes("AppModal"));
});

if (failed > 0) {
  console.error(`\n${failed} mobile disclosure test(s) failed.`);
  process.exit(1);
}
console.log("\nAll mobile disclosure layout tests passed.");
