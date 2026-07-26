/**
 * Relevant solar-catalogue category filter for Phase 1 live ingestion.
 * Accepts solar-related catalogue rows; excludes general retail noise (esp. Alladin).
 */

export type CategoryDecision = {
  accepted: boolean;
  reason: string;
  normalizedCategory: string | null;
};

const ACCEPT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bhybrid\b.*\binverter|\binverter\b.*\bhybrid\b/i, label: "hybrid_inverter" },
  { re: /\bon[-\s]?grid\b.*\binverter|\binverter\b.*\bon[-\s]?grid\b/i, label: "ongrid_inverter" },
  { re: /\boff[-\s]?grid\b.*\binverter|\binverter\b.*\boff[-\s]?grid\b/i, label: "offgrid_inverter" },
  { re: /\bsolar\s*inverter|\binverter\b/i, label: "solar_inverter" },
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

  for (const rule of ACCEPT_PATTERNS) {
    if (rule.re.test(blob)) {
      return {
        accepted: true,
        reason: `accepted_${rule.label}`,
        normalizedCategory: productType || rule.label,
      };
    }
  }

  // Kamal is mostly solar; if product_type empty but title mentions solar, accept.
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
