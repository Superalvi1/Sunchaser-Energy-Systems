import { normalizePakistanMobile } from "../../src/lib/smartQuoteLead.ts";
import type { PublicLeadInput } from "./publicLeadValidation.ts";

const SMART_QUOTE_CAPACITIES = new Set([6, 8, 10, 12, 15, 20]);
const SMART_QUOTE_FIELDS = new Set([
  "name",
  "phone",
  "city",
  "quoteNumber",
  "systemCapacityKw",
  "estimatedTotalPkr",
  "panel",
  "inverter",
  "battery",
  "structure",
  "generatedAt",
  "snapshot",
]);

export type SmartQuoteLeadInput = {
  name: string;
  phone: string;
  city?: string;
  quoteNumber: string;
  systemCapacityKw: number;
  estimatedTotalPkr: number;
  panel: string;
  inverter: string;
  battery: string;
  structure: string;
  generatedAt: string;
  snapshot?: { lines: import("../../src/lib/publicQuotationBuilder.ts").PublicQuoteLine[]; subtotalPkr: number; discountPkr: number };
};

export type SmartQuoteValidationResult =
  | { ok: true; value: SmartQuoteLeadInput }
  | { ok: false; status: 400; error: string };

const QUOTE_RE = /^SES-\d{8}-\d{4}$/;

function requiredText(record: Record<string, unknown>, key: string, max: number): string | null {
  const value = typeof record[key] === "string" ? record[key].trim() : "";
  return value && value.length <= max && !/[\r\n]/.test(value) ? value : null;
}

export function validateSmartQuoteLeadPayload(body: unknown): SmartQuoteValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Request body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !SMART_QUOTE_FIELDS.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, error: `Unknown field(s): ${unknown.sort().join(", ")}` };
  }

  const name = requiredText(record, "name", 200);
  const phoneInput = requiredText(record, "phone", 40);
  const phone = phoneInput ? normalizePakistanMobile(phoneInput) : null;
  const quoteNumber = requiredText(record, "quoteNumber", 32);
  const panel = requiredText(record, "panel", 300);
  const inverter = requiredText(record, "inverter", 300);
  const battery = requiredText(record, "battery", 300);
  const structure = requiredText(record, "structure", 300);
  const city = typeof record.city === "string" ? record.city.trim().slice(0, 200) : undefined;
  const capacity = Number(record.systemCapacityKw);
  const total = Number(record.estimatedTotalPkr);
  const generatedAt = typeof record.generatedAt === "string" ? record.generatedAt.trim() : "";

  if (!name) return { ok: false, status: 400, error: "name is required." };
  if (!phone) return { ok: false, status: 400, error: "phone is invalid." };
  if (!quoteNumber || !QUOTE_RE.test(quoteNumber)) return { ok: false, status: 400, error: "quoteNumber is invalid." };
  if (!SMART_QUOTE_CAPACITIES.has(capacity)) return { ok: false, status: 400, error: "systemCapacityKw is invalid." };
  if (!Number.isFinite(total) || total <= 0 || total > 100_000_000) {
    return { ok: false, status: 400, error: "estimatedTotalPkr is invalid." };
  }
  if (!panel || !inverter || !battery || !structure) {
    return { ok: false, status: 400, error: "Complete quote equipment is required." };
  }
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    return { ok: false, status: 400, error: "generatedAt is invalid." };
  }

  let snapshot: SmartQuoteLeadInput["snapshot"];
  if (record.snapshot !== undefined) {
    const raw = record.snapshot as any;
    const validNumber = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100_000_000;
    if (!raw || !Array.isArray(raw.lines) || raw.lines.length > 80 || !validNumber(raw.subtotalPkr) || !validNumber(raw.discountPkr) || !raw.lines.every((line: any) =>
      line && ["Equipment", "Cables & protection", "Structure", "Services"].includes(line.category) &&
      ["description", "specification", "unit"].every(key => typeof line[key] === "string" && line[key].length <= 500 && !/[\r\n]/.test(line[key])) &&
      ["quantity", "unitPricePkr", "totalPkr"].every(key => validNumber(line[key])))) {
      return { ok: false, status: 400, error: "Quotation snapshot is invalid." };
    }
    snapshot = { lines: raw.lines.map((line: any) => ({ category: line.category, description: line.description, specification: line.specification, unit: line.unit, quantity: line.quantity, unitPricePkr: line.unitPricePkr, totalPkr: line.totalPkr })), subtotalPkr: raw.subtotalPkr, discountPkr: raw.discountPkr };
  }
  return {
    ok: true,
    value: {
      name,
      phone,
      city: city || undefined,
      quoteNumber,
      systemCapacityKw: capacity,
      estimatedTotalPkr: Math.round(total),
      panel,
      inverter,
      battery,
      structure,
      generatedAt: new Date(generatedAt).toISOString(),
      snapshot,
    },
  };
}

export function toPublicLeadInput(input: SmartQuoteLeadInput): PublicLeadInput {
  const notes = [
    "SMART_QUOTE_V1",
    `Quote: ${input.quoteNumber}`,
    `System: ${input.systemCapacityKw} kW`,
    `Estimate: PKR ${input.estimatedTotalPkr}`,
    `Panel: ${input.panel}`,
    `Inverter: ${input.inverter}`,
    `Battery: ${input.battery}`,
    `Structure: ${input.structure}`,
    `Generated: ${input.generatedAt}`,
    ...(input.snapshot ? [`Snapshot: ${JSON.stringify(input.snapshot)}`] : []),
  ].join("\n");

  return {
    name: input.name,
    email: "",
    phone: input.phone,
    city: input.city,
    location: input.city,
    notes,
    leadSource: "Smart Quote",
  };
}

