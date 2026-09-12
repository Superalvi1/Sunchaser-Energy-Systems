import { finiteNumber } from "../quoteCommercialMath";
import type {
  CostGroup,
  CostGroupTotal,
  GenericChargeFlags,
  ProjectScopeState,
  ScopeContext,
  ScopeLine,
  ScopeMatrixGroup,
  StructureFinish,
} from "./types";
import { COST_GROUP_LABELS, COST_GROUP_ORDER, PENDING_SITE_SURVEY, PENDING_STRUCTURAL_DESIGN } from "./types";
import { applyScopeDependencies } from "./dependencies";
import { canSuppressGenericAc, canSuppressGenericDc, canSuppressGenericEarth } from "./replacement";

export function lineAmount(line: ScopeLine): number {
  if (line.inclusionState !== "included") return 0;
  return finiteNumber(line.qty, 0) * finiteNumber(line.rate, 0);
}

export function isPricedIncludedLine(line: ScopeLine): boolean {
  return line.inclusionState === "included" && lineAmount(line) > 0;
}

export function finishAmount(finish: StructureFinish | undefined): number {
  if (!finish || !finish.finish || finish.finish === "none") return 0;
  const explicit = finiteNumber(finish.amount, 0);
  if (explicit > 0) return explicit;
  const area = finiteNumber(finish.surfaceArea, 0);
  const rate = finiteNumber(finish.rate, 0);
  const coats = Math.max(1, finiteNumber(finish.coats, 1));
  return area * rate * coats;
}

export function girderDesignLoadDisplay(girder: ProjectScopeState["girder"]): string {
  if (girder.designLoadStatus === "provided") {
    const note = String(girder.designLoadNote || "").trim();
    return note || PENDING_STRUCTURAL_DESIGN;
  }
  return PENDING_STRUCTURAL_DESIGN;
}

export function suppressedGenericChargeIds(scope: ProjectScopeState | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!scope || scope.scopeMode !== "advanced") return ids;
  if (canSuppressGenericDc(scope)) ids.add("dc_cable_row");
  if (canSuppressGenericAc(scope)) ids.add("ac_cable_row");
  if (canSuppressGenericEarth(scope)) ids.add("earth_wire_row");
  return ids;
}

export function scopeLineTotalsByGroup(scope: ProjectScopeState | null | undefined): Record<CostGroup, number> {
  const totals = Object.fromEntries(COST_GROUP_ORDER.map((g) => [g, 0])) as Record<CostGroup, number>;
  if (!scope) return totals;
  for (const line of scope.lines) {
    totals[line.costGroup] += lineAmount(line);
  }
  totals.mounting_structure += finishAmount(scope.finish);
  return totals;
}

export function projectScopeExtrasTotal(scope: ProjectScopeState | null | undefined): number {
  const groups = scopeLineTotalsByGroup(scope);
  return COST_GROUP_ORDER.reduce((sum, g) => sum + groups[g], 0);
}

export interface CommercialCostInputs {
  panelTotal: number;
  inverterTotal: number;
  batteryTotal: number;
  structureTotal: number;
  installationTotal: number;
  charges: {
    dcCable: number;
    acCable: number;
    earthWire: number;
    dbBox: number;
    earthingBore: number;
    civilWork: number;
    freight: number;
    netMetering: number;
    surveyDesign: number;
  };
  suppressedGenericIds?: Iterable<string>;
  scope?: ProjectScopeState | null;
}

export interface QuoteCostSummary {
  groups: CostGroupTotal[];
  extrasTotal: number;
  genericChargesTotal: number;
  subtotal: number;
  suppressedGenericIds: string[];
}

export function buildQuoteCostSummary(inputs: CommercialCostInputs): QuoteCostSummary {
  const suppressed = new Set(inputs.suppressedGenericIds || []);
  const scopeGroups = scopeLineTotalsByGroup(inputs.scope);
  const charges = inputs.charges;
  const generic = {
    dcCable: suppressed.has("dc_cable_row") ? 0 : finiteNumber(charges.dcCable, 0),
    acCable: suppressed.has("ac_cable_row") ? 0 : finiteNumber(charges.acCable, 0),
    earthWire: suppressed.has("earth_wire_row") ? 0 : finiteNumber(charges.earthWire, 0),
    dbBox: finiteNumber(charges.dbBox, 0),
    earthingBore: finiteNumber(charges.earthingBore, 0),
    civilWork: finiteNumber(charges.civilWork, 0),
    freight: finiteNumber(charges.freight, 0),
    netMetering: finiteNumber(charges.netMetering, 0),
    surveyDesign: finiteNumber(charges.surveyDesign, 0),
  };

  const amounts: Record<CostGroup, number> = {
    pv_modules: finiteNumber(inputs.panelTotal, 0),
    inverter: finiteNumber(inputs.inverterTotal, 0),
    battery: finiteNumber(inputs.batteryTotal, 0) + scopeGroups.battery,
    mounting_structure: finiteNumber(inputs.structureTotal, 0) + scopeGroups.mounting_structure,
    dc_bos: generic.dcCable + scopeGroups.dc_bos,
    ac_bos: generic.acCable + scopeGroups.ac_bos,
    earthing: generic.earthWire + generic.earthingBore + scopeGroups.earthing,
    protection: generic.dbBox + scopeGroups.protection,
    lightning: scopeGroups.lightning,
    monitoring: scopeGroups.monitoring,
    civil: generic.civilWork + scopeGroups.civil,
    transport: generic.freight + scopeGroups.transport,
    installation: finiteNumber(inputs.installationTotal, 0) + scopeGroups.installation,
    engineering: generic.surveyDesign + scopeGroups.engineering,
    documentation: scopeGroups.documentation,
    net_metering: generic.netMetering + scopeGroups.net_metering,
    other: scopeGroups.other,
  };

  const groups: CostGroupTotal[] = COST_GROUP_ORDER.map((group) => ({
    group,
    label: COST_GROUP_LABELS[group],
    amount: amounts[group],
  }));
  const extrasTotal = projectScopeExtrasTotal(inputs.scope);
  const genericChargesTotal =
    generic.dcCable +
    generic.acCable +
    generic.earthWire +
    generic.dbBox +
    generic.earthingBore +
    generic.civilWork +
    generic.freight +
    generic.netMetering +
    generic.surveyDesign;
  const subtotal = groups.reduce((sum, g) => sum + g.amount, 0);
  return {
    groups,
    extrasTotal,
    genericChargesTotal,
    subtotal,
    suppressedGenericIds: [...suppressed],
  };
}

const MAJOR_LABELS: Record<string, string> = {
  panels: "Panels",
  inverter: "Inverter",
  battery: "Battery",
  standard_structure: "Standard Structure",
  elevated: "Elevated Structure",
  girder: "Girder",
  custom_structure: "Custom Structure",
  dc: "DC Cable",
  ac: "AC Cable",
  earthing: "Earthing",
  installation: "Installation",
  net_metering: "Net Metering",
  lightning: "Lightning Protection",
  crane: "Crane",
  scada: "SCADA",
  civil: "Civil Foundation",
  documentation: "Documentation",
};

export interface ResolvedScopeMatrixInput {
  scope: ProjectScopeState;
  ctx: ScopeContext;
  genericCharges?: Partial<GenericChargeFlags>;
  suppressedGenericIds?: Iterable<string>;
}

function defaultGenericCharges(ctx: ScopeContext): GenericChargeFlags {
  return {
    dcCable: true,
    acCable: true,
    earthWire: true,
    netMetering: ctx.systemType !== "Off-grid",
  };
}

function familyState(opts: {
  genericEnabled: boolean;
  replaced: boolean;
  pricedDetailed: boolean;
  pendingDetailed: boolean;
}): "included" | "excluded" | "pending" {
  if (opts.replaced || opts.pricedDetailed || opts.genericEnabled) return "included";
  if (opts.pendingDetailed) return "pending";
  return "excluded";
}

export function buildResolvedScopeMatrix(input: ResolvedScopeMatrixInput): ScopeMatrixGroup {
  const ctx = input.ctx;
  const resolved = applyScopeDependencies(input.scope, ctx);
  const generic = { ...defaultGenericCharges(ctx), ...input.genericCharges };
  const suppressed = new Set(input.suppressedGenericIds || suppressedGenericChargeIds(resolved));
  const included: string[] = ["Panels", "Inverter"];
  const excluded: string[] = [];
  const pending: string[] = [];

  const push = (label: string, state: "included" | "excluded" | "pending") => {
    if (state === "included") included.push(label);
    else if (state === "pending") pending.push(label);
    else excluded.push(label);
  };

  push("Battery", ctx.batteryEnabled ? "included" : "excluded");
  if (ctx.structureType === "standard") push("Standard Structure", "included");
  else if (ctx.structureType === "elevated") {
    push("Elevated Structure", "included");
    push("Standard Structure", "excluded");
    push("Girder", "excluded");
  } else if (ctx.structureType === "girder") {
    push("Girder", "included");
    push("Standard Structure", "excluded");
    push("Elevated Structure", "excluded");
  } else {
    push("Custom Structure", "included");
    push("Standard Structure", "excluded");
  }

  const hasIncluded = (pred: (line: ScopeLine) => boolean) =>
    resolved.lines.some((l) => pred(l) && l.inclusionState === "included");
  const hasPending = (pred: (line: ScopeLine) => boolean) =>
    resolved.lines.some((l) => pred(l) && l.inclusionState === "pending");
  const hasPriced = (pred: (line: ScopeLine) => boolean) =>
    resolved.lines.some((l) => pred(l) && isPricedIncludedLine(l));

  push(
    "DC Cable",
    familyState({
      genericEnabled: generic.dcCable && !suppressed.has("dc_cable_row"),
      replaced: suppressed.has("dc_cable_row"),
      pricedDetailed: hasPriced((l) => l.section === "dc_cabling"),
      pendingDetailed: hasPending((l) => l.section === "dc_cabling"),
    })
  );
  push(
    "AC Cable",
    familyState({
      genericEnabled: generic.acCable && !suppressed.has("ac_cable_row"),
      replaced: suppressed.has("ac_cable_row"),
      pricedDetailed: hasPriced((l) => l.section === "ac_cabling"),
      pendingDetailed: hasPending((l) => l.section === "ac_cabling"),
    })
  );
  push(
    "Earthing",
    familyState({
      genericEnabled: generic.earthWire && !suppressed.has("earth_wire_row"),
      replaced: suppressed.has("earth_wire_row"),
      pricedDetailed: hasPriced((l) => l.section === "earthing"),
      pendingDetailed: hasPending((l) => l.section === "earthing"),
    })
  );
  push("Installation", "included");

  const nmDetailedIncluded = hasIncluded((l) => l.section === "net_metering");
  const nmPending = hasPending((l) => l.section === "net_metering");
  if (generic.netMetering || nmDetailedIncluded) push("Net Metering", "included");
  else if (nmPending) push("Net Metering", "pending");
  else push("Net Metering", "excluded");

  if (resolved.lightningEnabled) push("Lightning Protection", "included");
  else if (hasPending((l) => l.section === "lightning")) pending.push(`Lightning Protection — ${PENDING_SITE_SURVEY}`);
  else push("Lightning Protection", "excluded");

  push("Crane", resolved.craneEnabled ? "included" : "excluded");
  push("SCADA", resolved.scadaEnabled ? (hasIncluded((l) => l.id === "mon_scada_gw") ? "included" : "pending") : "excluded");
  if (hasPending((l) => l.section === "civil") && !hasIncluded((l) => l.section === "civil")) {
    pending.push("Civil Foundation — Pending Site Survey");
  } else if (hasIncluded((l) => l.section === "civil") || hasPriced((l) => l.section === "civil")) {
    push("Civil Foundation", "included");
  } else {
    push("Civil Foundation", "excluded");
  }
  if (hasIncluded((l) => l.section === "documentation")) push("Documentation", "included");
  else if (hasPending((l) => l.section === "documentation")) push("Documentation", "pending");
  else push("Documentation", "excluded");
  if (resolved.girder.designLoadStatus !== "provided" && ctx.structureType === "girder") {
    pending.push(`Girder load — ${PENDING_STRUCTURAL_DESIGN}`);
  }

  const uniq = (list: string[]) => [...new Set(list.filter(Boolean))];
  return { included: uniq(included), excluded: uniq(excluded), pending: uniq(pending) };
}

export function buildScopeMatrix(scope: ProjectScopeState, ctx: ScopeContext): ScopeMatrixGroup {
  return buildResolvedScopeMatrix({ scope, ctx });
}

export function matrixAgreesWithBoq(args: {
  matrix: ScopeMatrixGroup;
  boqRows: Array<{ id?: string; type?: string; total?: number }>;
  genericCharges: GenericChargeFlags;
  suppressedGenericIds: Iterable<string>;
}): boolean {
  const rows = (args.boqRows || []).filter((r) => String(r.type || "") === "item");
  const suppressed = new Set(args.suppressedGenericIds);
  const has = (id: string) => rows.some((r) => String(r.id) === id);
  const hasPrefix = (prefix: string) => rows.some((r) => String(r.id || "").startsWith(prefix));
  const included = (label: string) => args.matrix.included.includes(label);
  const excluded = (label: string) => args.matrix.excluded.includes(label);

  const dcInBoq = (args.genericCharges.dcCable && !suppressed.has("dc_cable_row") && has("dc_cable_row")) || hasPrefix("scope_dc_");
  const acInBoq = (args.genericCharges.acCable && !suppressed.has("ac_cable_row") && has("ac_cable_row")) || hasPrefix("scope_ac_inv") || hasPrefix("scope_ac_db") || hasPrefix("scope_ac_lt") || hasPrefix("scope_ac_backup");
  const earthInBoq = (args.genericCharges.earthWire && !suppressed.has("earth_wire_row") && has("earth_wire_row")) || rows.some((r) => /^scope_earth_/.test(String(r.id || "")));
  const nmInBoq = (args.genericCharges.netMetering && has("net_metering_row")) || hasPrefix("scope_nm_");

  if (dcInBoq !== included("DC Cable") && !(dcInBoq === false && excluded("DC Cable"))) return false;
  if (acInBoq !== included("AC Cable") && !(acInBoq === false && excluded("AC Cable"))) return false;
  if (earthInBoq !== included("Earthing") && !(earthInBoq === false && excluded("Earthing"))) return false;
  if (nmInBoq !== included("Net Metering") && !(nmInBoq === false && excluded("Net Metering"))) return false;
  return true;
}

export { MAJOR_LABELS };
