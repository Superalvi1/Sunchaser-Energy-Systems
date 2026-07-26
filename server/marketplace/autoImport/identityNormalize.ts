/**
 * Exact-variant identity normalization for CEO-authorized automatic import.
 *
 * Safety: never merge on-grid with hybrid; never merge different capacities,
 * phases, battery voltages, panel wattages, or model suffixes. When identity
 * is uncertain, callers must keep separate listings.
 */
export type Topology = "hybrid" | "ongrid" | "offgrid" | "n_a" | "uncertain";
export type CategoryFamily =
  | "inverter"
  | "battery"
  | "panel"
  | "protection"
  | "structure"
  | "accessory"
  | "other"
  | "uncertain";

export type VariantIdentity = {
  manufacturer: string | null;
  modelCore: string | null;
  modelSuffix: string | null;
  categoryFamily: CategoryFamily;
  topology: Topology;
  capacityKw: number | null;
  phase: 1 | 3 | null;
  batteryVoltageV: number | null;
  panelWattW: number | null;
  /** True when identity is safe for cross-supplier exact merge. */
  exactMatchEligible: boolean;
  matchReason: string;
};

function normToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectTopology(blob: string): Topology {
  const hybrid = /\bhybrid\b/.test(blob);
  const ongrid = /\bon[-\s]?grid\b|\bgrid[-\s]?tie\b/.test(blob);
  const offgrid = /\boff[-\s]?grid\b/.test(blob);
  const count = Number(hybrid) + Number(ongrid) + Number(offgrid);
  if (count > 1) return "uncertain";
  if (hybrid) return "hybrid";
  if (ongrid) return "ongrid";
  if (offgrid) return "offgrid";
  if (/\binverter\b/.test(blob)) return "uncertain";
  return "n_a";
}

function detectCategoryFamily(blob: string, productType: string | null): CategoryFamily {
  if (/\bvfd\b|variable\s*frequency/.test(blob)) return "other";
  if (/\blithium\b|\bbattery\b|\bpowerwall\b|\bli[-\s]?ion\b/.test(blob)) {
    return "battery";
  }
  if (/\bsolar\s*panel|\bpv\s*module|\bphotovoltaic\b|\b\d+\s*w\b.*panel/.test(blob)) {
    return "panel";
  }
  if (
    /\bbreaker\b|\bmccb\b|\bmcb\b|\bsurge\b|\bspd\b|\bcontactor\b|\bchangeover\b|\bmts\b|\bats\b/.test(
      blob,
    )
  ) {
    return "protection";
  }
  if (/\bmount|\bracking\b|\bstructure\b|\bsolar\s*stand/.test(blob)) {
    return "structure";
  }
  if (/\bcable\b|\bmc4\b|\boptimizer\b|\bcombiner\b|\baccessor/.test(blob)) {
    return "accessory";
  }
  if (/\binverter\b/.test(blob) || /inverter/i.test(productType || "")) {
    return "inverter";
  }
  if (/\bsolar\b/.test(blob)) return "other";
  return "uncertain";
}

function detectCapacityKw(blob: string): number | null {
  const patterns = [
    /\b(\d+(?:\.\d+)?)\s*k\s*w\b/i,
    /\b(\d+(?:\.\d+)?)\s*kw\b/i,
    /\bpv\s*(\d{4,5})\b/i, // PV18000 → treat as model token, not kW
  ];
  for (const re of [patterns[0]!, patterns[1]!]) {
    const m = blob.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n <= 200) return n;
    }
  }
  return null;
}

function detectPhase(blob: string): 1 | 3 | null {
  if (/\b3[-\s]?phase\b|\bthree[-\s]?phase\b|\b3ph\b/.test(blob)) return 3;
  if (/\b1[-\s]?phase\b|\bsingle[-\s]?phase\b|\b1ph\b/.test(blob)) return 1;
  return null;
}

function detectBatteryVoltage(blob: string): number | null {
  const m = blob.match(/\b(\d+(?:\.\d+)?)\s*v\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if ([12, 24, 48, 51.2].includes(n) || (n >= 12 && n <= 800)) return n;
  return null;
}

function detectPanelWatt(blob: string): number | null {
  const m = blob.match(/\b(\d{2,4})\s*w(?:att)?s?\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 50 && n <= 800) return n;
  return null;
}

const KNOWN_BRANDS = [
  "inverex",
  "knox",
  "fronus",
  "pylontech",
  "crown",
  "growatt",
  "huawei",
  "solis",
  "luminous",
  "tesla",
  "byd",
  "canadian",
  "longi",
  "jinko",
  "trina",
  "ja solar",
  "kripal",
  "alladin",
  "kamal",
];

function detectManufacturer(title: string, vendor: string | null): string | null {
  const blob = normToken(`${vendor || ""} ${title}`);
  for (const b of KNOWN_BRANDS) {
    if (blob.includes(b)) return b;
  }
  if (vendor && vendor.trim()) return normToken(vendor);
  const first = normToken(title).split(" ")[0];
  if (first && first.length >= 2) return first;
  return null;
}

function detectModelCore(
  title: string,
  sku: string | null,
  manufacturer: string | null,
): { modelCore: string | null; modelSuffix: string | null } {
  let t = normToken(title);
  if (manufacturer) t = t.replace(new RegExp(`^${manufacturer}\\s*`), "");
  // Strip topology / capacity noise for core
  t = t
    .replace(/\b(hybrid|on[-\s]?grid|off[-\s]?grid|grid[-\s]?tie|single[-\s]?phase|3[-\s]?phase|three[-\s]?phase)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*k\s*w\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*kw\b/g, " ")
    .replace(/\b\d{2,4}\s*w(?:att)?s?\b/g, " ")
    .replace(/\b(solar|inverter|lithium|battery|panel|module)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const skuNorm = sku ? normToken(sku) : "";
  const tokens = t.split(" ").filter(Boolean);
  if (!tokens.length && !skuNorm) return { modelCore: null, modelSuffix: null };

  const coreTokens = tokens.slice(0, 3);
  const suffixTokens = tokens.slice(3);
  const modelCore = (skuNorm || coreTokens.join(" ") || null);
  const modelSuffix = suffixTokens.length ? suffixTokens.join(" ") : null;
  return { modelCore, modelSuffix };
}

export function buildVariantIdentity(input: {
  title: string;
  brand?: string | null;
  modelSku?: string | null;
  category?: string | null;
  productType?: string | null;
}): VariantIdentity {
  const blob = normToken(
    [input.title, input.brand, input.modelSku, input.category, input.productType]
      .filter(Boolean)
      .join(" "),
  );
  const manufacturer = detectManufacturer(input.title, input.brand ?? null);
  const categoryFamily = detectCategoryFamily(blob, input.productType ?? input.category ?? null);
  const topology =
    categoryFamily === "inverter" ? detectTopology(blob) : detectTopology(blob) === "n_a"
      ? "n_a"
      : detectTopology(blob);
  const capacityKw = detectCapacityKw(blob);
  const phase = detectPhase(blob);
  const batteryVoltageV =
    categoryFamily === "battery" || categoryFamily === "inverter"
      ? detectBatteryVoltage(blob)
      : null;
  const panelWattW = categoryFamily === "panel" ? detectPanelWatt(blob) : null;
  const { modelCore, modelSuffix } = detectModelCore(
    input.title,
    input.modelSku ?? null,
    manufacturer,
  );

  const inverterNeedsTopology =
    categoryFamily === "inverter" && (topology === "uncertain" || topology === "n_a");
  const missingCore = !manufacturer || !modelCore || categoryFamily === "uncertain";

  let exactMatchEligible = !missingCore && !inverterNeedsTopology;
  let matchReason = "exact_identity";

  if (missingCore) {
    exactMatchEligible = false;
    matchReason = "uncertain_identity_keep_separate";
  } else if (inverterNeedsTopology) {
    exactMatchEligible = false;
    matchReason = "uncertain_topology_keep_separate";
  } else if (categoryFamily === "inverter" && capacityKw == null) {
    // Capacity missing on inverter → do not cross-merge
    exactMatchEligible = false;
    matchReason = "missing_capacity_keep_separate";
  }

  return {
    manufacturer,
    modelCore,
    modelSuffix,
    categoryFamily,
    topology,
    capacityKw,
    phase,
    batteryVoltageV,
    panelWattW,
    exactMatchEligible,
    matchReason,
  };
}

/** Deterministic exact-match key, or null when not eligible. */
export function exactIdentityKey(identity: VariantIdentity): string | null {
  if (!identity.exactMatchEligible) return null;
  return [
    identity.manufacturer,
    identity.modelCore,
    identity.modelSuffix ?? "",
    identity.categoryFamily,
    identity.topology,
    identity.capacityKw ?? "",
    identity.phase ?? "",
    identity.batteryVoltageV ?? "",
    identity.panelWattW ?? "",
  ].join("|");
}

export function separateListingKey(supplier: string, sourceKey: string): string {
  return `separate:${supplier}:${sourceKey}`;
}

/** True when two identities must never be merged (hard conflicts). */
export function hasHardIdentityConflict(a: VariantIdentity, b: VariantIdentity): boolean {
  if (
    a.categoryFamily === "inverter" &&
    b.categoryFamily === "inverter" &&
    a.topology !== "uncertain" &&
    b.topology !== "uncertain" &&
    a.topology !== "n_a" &&
    b.topology !== "n_a" &&
    a.topology !== b.topology
  ) {
    return true;
  }
  if (
    a.capacityKw != null &&
    b.capacityKw != null &&
    a.capacityKw !== b.capacityKw
  ) {
    return true;
  }
  if (a.modelSuffix && b.modelSuffix && a.modelSuffix !== b.modelSuffix) {
    return true;
  }
  if (a.phase != null && b.phase != null && a.phase !== b.phase) return true;
  if (
    a.batteryVoltageV != null &&
    b.batteryVoltageV != null &&
    a.batteryVoltageV !== b.batteryVoltageV
  ) {
    return true;
  }
  if (
    a.panelWattW != null &&
    b.panelWattW != null &&
    a.panelWattW !== b.panelWattW
  ) {
    return true;
  }
  return false;
}
