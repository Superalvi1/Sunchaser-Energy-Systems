/**
 * Relevant solar-catalogue category filter for Phase 1 live ingestion.
 * Accepts solar-related catalogue rows; excludes general retail noise (esp. Alladin).
 *
 * Ambiguous bare "inverter" tokens require solar/energy context or an approved
 * product_type — UPS / car power inverters without solar context are excluded.
 */

export type CategoryDecision = {
  accepted: boolean;
  reason: string;
  normalizedCategory: string | null;
};

const APPROVED_INVERTER_PRODUCT_TYPES = [
  /^solar\s*inverter$/i,
  /^hybrid\s*solar\s*inverter$/i,
  /^hybrid\s*inverter$/i,
  /^on[-\s]?grid(\s*solar)?\s*inverter$/i,
  /^off[-\s]?grid(\s*solar)?\s*inverter$/i,
  /^vfd\s*inverter$/i,
];

const SOLAR_ENERGY_CONTEXT =
  /\bsolar\b|\bpv\b|\bhybrid\b|\bon[-\s]?grid\b|\boff[-\s]?grid\b|\bnet\s*meter|\bmppt\b|\bphotovoltaic\b|\blithium\b|\bgrid[-\s]?tie\b/;

const NON_SOLAR_INVERTER =
  /\bups\b|\bcar\s*(power\s*)?inverter\b|\bauto(motive)?\s*inverter\b|\bvehicle\s*inverter\b|\bpure\s*sine\s*wave\s*inverter\b(?!.*\bsolar\b)/i;

const ACCEPT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bhybrid\b.*\binverter|\binverter\b.*\bhybrid\b/i, label: "hybrid_inverter" },
  { re: /\bon[-\s]?grid\b.*\binverter|\binverter\b.*\bon[-\s]?grid\b/i, label: "ongrid_inverter" },
  { re: /\boff[-\s]?grid\b.*\binverter|\binverter\b.*\boff[-\s]?grid\b/i, label: "offgrid_inverter" },
  { re: /\bsolar\s*inverter/i, label: "solar_inverter" },
  { re: /\bvfd\b|variable\s*frequency/i, label: "vfd" },
  { re: /\blithium\b|\bli[-\s]?ion\b|\bbattery\b|\bpowerwall\b|\bus5000\b/i, label: "battery" },
  { re: /\bsolar\s*panel|\bpv\s*module|\bphotovoltaic\b/i, label: "solar_panel" },
  {
    re: /\bbreaker\b|\bmccb\b|\bmcb\b|\bsurge\b|\bspd\b|\bcontactor\b|\bchangeover\b|\bmts\b|\bats\b|\bprotection\b|\bvoltage\s*protector\b|\bzero\s*export\b/i,
    label: "protection",
  },
  {
    re: /\bsolar\s*stand|\bsolar\s*structure|\bmounting\b|\bracking\b|\bstructure\b/i,
    label: "structure",
  },
  {
    re: /\bsolar\s*accessor|\bcable\b|\bdc\s*wire|\bmc4\b|\bcombiner\b|\boptimizer\b|\bdatasheet\b|\bsolar\s*panel\s*cleaner\b/i,
    label: "accessory",
  },
];

const EXCLUDE_PATTERNS: RegExp[] = [
  /\bsecurity\s*camera\b|\bcctv\b|\bnvr\b|\bip\s*camera\b/i,
  /\bair\s*fryer\b|\bblender\b|\belectric\s*stove\b|\bpressure\s*washer\b/i,
  /\bfire\s*extinguish/i,
  /\bmemory\s*card\b|\bcalculator\b|\baudio\b|\bplier\b|\bcrimping\s*tool\b/i,
  /\bair\s*fresh|\bair\s*conditioning\s*appliance/i,
];

function blobOf(input: {
  title?: string | null;
  productType?: string | null;
  tags?: string[] | string | null;
  vendor?: string | null;
}): string {
  const tags = Array.isArray(input.tags)
    ? input.tags.join(" ")
    : String(input.tags || "");
  return [input.title, input.productType, tags, input.vendor]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function approvedInverterProductType(productType: string | null): boolean {
  if (!productType) return false;
  return APPROVED_INVERTER_PRODUCT_TYPES.some((re) => re.test(productType.trim()));
}

function hasSolarEnergyContext(blob: string, productType: string | null): boolean {
  if (SOLAR_ENERGY_CONTEXT.test(blob)) return true;
  return approvedInverterProductType(productType);
}

/**
 * Bare "inverter" alone is insufficient. Require solar/energy context or an
 * approved product_type. UPS / automotive inverters without solar context → exclude.
 */
export function classifyInverterToken(input: {
  title?: string | null;
  productType?: string | null;
  tags?: string[] | string | null;
  vendor?: string | null;
}): CategoryDecision | null {
  const blob = blobOf(input);
  const productType = (input.productType || "").trim() || null;
  if (!/\binverter\b/i.test(blob)) return null;

  if (NON_SOLAR_INVERTER.test(blob) && !hasSolarEnergyContext(blob, productType)) {
    return {
      accepted: false,
      reason: "excluded_non_solar_inverter",
      normalizedCategory: productType,
    };
  }

  if (hasSolarEnergyContext(blob, productType)) {
    return {
      accepted: true,
      reason: "accepted_solar_inverter_context",
      normalizedCategory: productType || "solar_inverter",
    };
  }

  // Ambiguous inverter without solar/UPS markers — exclude as uncertain.
  return {
    accepted: false,
    reason: "excluded_ambiguous_inverter",
    normalizedCategory: productType,
  };
}

export function classifySupplierCategory(input: {
  title?: string | null;
  productType?: string | null;
  tags?: string[] | string | null;
  vendor?: string | null;
}): CategoryDecision {
  const blob = blobOf(input);
  const productType = (input.productType || "").trim() || null;

  for (const re of EXCLUDE_PATTERNS) {
    if (re.test(blob)) {
      return {
        accepted: false,
        reason: "excluded_non_solar_retail",
        normalizedCategory: productType,
      };
    }
  }

  // Inverter handling is specialized (no bare \binverter\b accept).
  const inverterDecision = classifyInverterToken(input);
  if (inverterDecision) {
    // Still allow VFD pattern to win for "VFD Inverter" via ACCEPT_PATTERNS below
    // when inverter decision is ambiguous/excluded but VFD context exists.
    if (
      inverterDecision.accepted ||
      inverterDecision.reason === "excluded_non_solar_inverter"
    ) {
      return inverterDecision;
    }
    // For ambiguous inverter, check VFD / other non-inverter accept rules first.
    if (/\bvfd\b|variable\s*frequency/i.test(blob)) {
      return {
        accepted: true,
        reason: "accepted_vfd",
        normalizedCategory: productType || "vfd",
      };
    }
    return inverterDecision;
  }

  for (const rule of ACCEPT_PATTERNS) {
    // Skip solar_inverter / hybrid patterns already covered; keep battery etc.
    if (rule.label.endsWith("_inverter") || rule.label === "solar_inverter") {
      continue;
    }
    if (rule.re.test(blob)) {
      return {
        accepted: true,
        reason: `accepted_${rule.label}`,
        normalizedCategory: productType || rule.label,
      };
    }
  }

  // Re-run hybrid/on/off/solar inverter accepts that include explicit solar context
  // (these also match via classifyInverterToken when solar context present).
  for (const rule of ACCEPT_PATTERNS) {
    if (
      (rule.label.endsWith("_inverter") || rule.label === "solar_inverter") &&
      rule.re.test(blob) &&
      hasSolarEnergyContext(blob, productType)
    ) {
      return {
        accepted: true,
        reason: `accepted_${rule.label}`,
        normalizedCategory: productType || rule.label,
      };
    }
  }

  if (/\bsolar\b/.test(blob)) {
    return {
      accepted: true,
      reason: "accepted_solar_keyword",
      normalizedCategory: productType || "solar",
    };
  }

  return {
    accepted: false,
    reason: "excluded_unclassified",
    normalizedCategory: productType,
  };
}
