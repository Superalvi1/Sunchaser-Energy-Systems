import { catalogPanelUnitPrice } from "./interactiveProposalCatalog.ts";

export type InteractiveProposalStatus =
  | "Sent"
  | "Viewed"
  | "Modified"
  | "Accepted"
  | "Revoked"
  | "Expired";

export type InteractiveProposalChoice = {
  id: string;
  label: string;
  priceAdjustment: number;
  capacityKw?: number;
  description?: string;
};

export type InteractiveProposalConfig = {
  panelCount: number;
  inverterId: string;
  batteryId: string;
  structureId: string;
};

export type InteractiveProposalDefinition = {
  version: 1;
  title: string;
  currency: "PKR";
  customerName: string;
  sourceQuoteId: string;
  basePrice: number;
  panel: {
    label: string;
    wattage: number;
    baseCount: number;
    minCount: number;
    maxCount: number;
    step: number;
    unitPrice: number;
  };
  inverter: {
    selectedId: string;
    options: InteractiveProposalChoice[];
  };
  battery: {
    selectedId: string;
    options: InteractiveProposalChoice[];
  };
  structure: {
    selectedId: string;
    options: InteractiveProposalChoice[];
  };
  notes?: string;
};

export type InteractiveProposalCalculation = {
  configuration: InteractiveProposalConfig;
  panelCapacityKwp: number;
  totalPrice: number;
  priceDifference: number;
  summary: string[];
  warnings: string[];
};

const MAX_PRICE = 1_000_000_000;

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedMoney(value: unknown): number {
  return Math.round(Math.max(-MAX_PRICE, Math.min(MAX_PRICE, finiteNumber(value))));
}

function cleanText(value: unknown, fallback: string, maxLength = 160): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return (text || fallback).slice(0, maxLength);
}

function cleanId(value: unknown, fallback: string): string {
  const id = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return id || fallback;
}

function normalizeChoices(
  input: unknown,
  fallbackLabel: string,
  group: string
): InteractiveProposalChoice[] {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const choices: InteractiveProposalChoice[] = [];

  raw.slice(0, 12).forEach((item: any, index) => {
    const id = cleanId(item?.id, `${group}-${index + 1}`);
    if (seen.has(id)) return;
    seen.add(id);
    const capacity = finiteNumber(item?.capacityKw, NaN);
    choices.push({
      id,
      label: cleanText(item?.label, index === 0 ? fallbackLabel : `Option ${index + 1}`),
      priceAdjustment: boundedMoney(item?.priceAdjustment),
      ...(Number.isFinite(capacity) && capacity > 0 && capacity <= 250
        ? { capacityKw: capacity }
        : {}),
      ...(item?.description
        ? { description: cleanText(item.description, "", 240) }
        : {}),
    });
  });

  return choices.length
    ? choices
    : [{ id: `${group}-current`, label: fallbackLabel, priceAdjustment: 0 }];
}

function normalizeSelectedId(value: unknown, options: InteractiveProposalChoice[]): string {
  const requested = cleanId(value, options[0].id);
  return options.some((option) => option.id === requested) ? requested : options[0].id;
}

export function normalizeInteractiveProposalDefinition(
  input: any
): InteractiveProposalDefinition {
  const baseCount = Math.round(Math.max(1, Math.min(200, finiteNumber(input?.panel?.baseCount, 1))));
  const minCount = Math.round(
    Math.max(1, Math.min(baseCount, finiteNumber(input?.panel?.minCount, baseCount)))
  );
  const maxCount = Math.round(
    Math.max(baseCount, Math.min(200, finiteNumber(input?.panel?.maxCount, baseCount)))
  );
  const step = Math.round(Math.max(1, Math.min(10, finiteNumber(input?.panel?.step, 1))));
  const inverterOptions = normalizeChoices(input?.inverter?.options, "Current inverter", "inverter");
  const batteryOptions = normalizeChoices(input?.battery?.options, "Current battery option", "battery");
  const structureOptions = normalizeChoices(input?.structure?.options, "Current structure", "structure");

  return {
    version: 1,
    title: cleanText(input?.title, "Your Solar Proposal"),
    currency: "PKR",
    customerName: cleanText(input?.customerName, "Customer", 120),
    sourceQuoteId: cleanText(input?.sourceQuoteId, "", 120),
    basePrice: Math.max(0, boundedMoney(input?.basePrice)),
    panel: {
      label: cleanText(input?.panel?.label, "Solar panel", 120),
      wattage: Math.round(Math.max(1, Math.min(1_500, finiteNumber(input?.panel?.wattage, 585)))),
      baseCount,
      minCount,
      maxCount,
      step,
      unitPrice: Math.max(0, boundedMoney(input?.panel?.unitPrice)),
    },
    inverter: {
      selectedId: normalizeSelectedId(input?.inverter?.selectedId, inverterOptions),
      options: inverterOptions,
    },
    battery: {
      selectedId: normalizeSelectedId(input?.battery?.selectedId, batteryOptions),
      options: batteryOptions,
    },
    structure: {
      selectedId: normalizeSelectedId(input?.structure?.selectedId, structureOptions),
      options: structureOptions,
    },
    ...(input?.notes ? { notes: cleanText(input.notes, "", 500) } : {}),
  };
}

export function defaultInteractiveProposalConfig(
  definition: InteractiveProposalDefinition
): InteractiveProposalConfig {
  return {
    panelCount: definition.panel.baseCount,
    inverterId: definition.inverter.selectedId,
    batteryId: definition.battery.selectedId,
    structureId: definition.structure.selectedId,
  };
}

function resolveChoice(
  requestedId: unknown,
  options: InteractiveProposalChoice[],
  fallbackId: string
): InteractiveProposalChoice {
  const id = cleanId(requestedId, fallbackId);
  return (
    options.find((option) => option.id === id) ||
    options.find((option) => option.id === fallbackId) ||
    options[0]
  );
}

export function calculateInteractiveProposal(
  definitionInput: InteractiveProposalDefinition,
  configInput?: Partial<InteractiveProposalConfig> | null
): InteractiveProposalCalculation {
  const definition = normalizeInteractiveProposalDefinition(definitionInput);
  const requestedPanelCount = Math.round(
    finiteNumber(configInput?.panelCount, definition.panel.baseCount)
  );
  const panelCount = Math.max(
    definition.panel.minCount,
    Math.min(definition.panel.maxCount, requestedPanelCount)
  );
  const inverter = resolveChoice(
    configInput?.inverterId,
    definition.inverter.options,
    definition.inverter.selectedId
  );
  const battery = resolveChoice(
    configInput?.batteryId,
    definition.battery.options,
    definition.battery.selectedId
  );
  const structure = resolveChoice(
    configInput?.structureId,
    definition.structure.options,
    definition.structure.selectedId
  );
  const panelAdjustment =
    (panelCount - definition.panel.baseCount) * definition.panel.unitPrice;
  const priceDifference =
    panelAdjustment +
    inverter.priceAdjustment +
    battery.priceAdjustment +
    structure.priceAdjustment;
  const totalPrice = Math.max(0, Math.round(definition.basePrice + priceDifference));
  const panelCapacityKwp = Number(
    ((panelCount * definition.panel.wattage) / 1000).toFixed(2)
  );
  const warnings: string[] = [];

  if (inverter.capacityKw && inverter.capacityKw > 0) {
    const dcAcRatio = panelCapacityKwp / inverter.capacityKw;
    if (dcAcRatio > 1.5) {
      warnings.push(
        "This panel selection is above the configured PV-to-inverter design range and needs Sunchaser technical approval."
      );
    } else if (dcAcRatio < 0.65) {
      warnings.push(
        "This panel selection may under-use the selected inverter and needs Sunchaser technical review."
      );
    }
  }

  return {
    configuration: {
      panelCount,
      inverterId: inverter.id,
      batteryId: battery.id,
      structureId: structure.id,
    },
    panelCapacityKwp,
    totalPrice,
    priceDifference,
    summary: [
      `${panelCount} × ${definition.panel.wattage}W panels (${panelCapacityKwp.toFixed(2)} kWp)`,
      inverter.label,
      battery.label,
      structure.label,
    ],
    warnings,
  };
}

export function findPanelUnitPrice(quote: any): number {
  const rows = Array.isArray(quote?.boqRows)
    ? quote.boqRows
    : Array.isArray(quote?.boqItems)
      ? quote.boqItems
      : [];
  const panelRow = rows.find((row: any) => {
    if (!row || row.type === "heading" || row.type === "subtotal") return false;
    const haystack = `${row.name || ""} ${row.description || ""} ${row.brand || ""}`.toLowerCase();
    return /\b(panel|module|pv)\b/.test(haystack);
  });
  const rate = finiteNumber(panelRow?.rate, 0);
  if (rate > 0) return Math.round(rate);
  const quantity = finiteNumber(panelRow?.qty, 0);
  const total = finiteNumber(panelRow?.total, 0);
  return quantity > 0 && total > 0 ? Math.round(total / quantity) : 0;
}

export function quoteToInteractiveProposalDefinition(quote: any, lead: any) {
  const baseCount = Math.max(1, Math.round(finiteNumber(quote?.panelCount, 1)));
  const inverterLabel = cleanText(
    [quote?.inverterBrand, quote?.inverterCapacity].filter(Boolean).join(" ") ||
      quote?.inverterType,
    "Current inverter"
  );
  const batteryLabel = cleanText(
    quote?.batteryOption || quote?.batteryCapacity,
    "No battery"
  );
  const structureLabel = cleanText(
    quote?.customStructure?.name || quote?.selectedStructure || quote?.structureType,
    "Standard structure"
  );
  const basePrice = finiteNumber(
    quote?.netTotal ?? quote?.netCost ?? quote?.grandTotal ?? quote?.totalCost,
    0
  );
  const inverterCapacity = finiteNumber(
    String(quote?.inverterCapacity || quote?.inverterType || "").match(/\d+(?:\.\d+)?/)?.[0],
    NaN
  );

  return normalizeInteractiveProposalDefinition({
    version: 1,
    title: `${finiteNumber(quote?.systemSizekW, 0) || "Custom"} kW Solar Proposal`,
    customerName: quote?.clientName || lead?.name || "Customer",
    sourceQuoteId: quote?.id || "",
    basePrice,
    panel: {
      label: cleanText(
        [quote?.panelBrand, quote?.panelWattage ? `${quote.panelWattage}W` : ""]
          .filter(Boolean)
          .join(" ") || quote?.panelType,
        "Solar panel"
      ),
      wattage: finiteNumber(quote?.panelWattage, 585),
      baseCount,
      minCount: Math.max(1, baseCount - 2),
      maxCount: Math.min(200, baseCount + 4),
      step: 1,
      unitPrice: findPanelUnitPrice(quote) || catalogPanelUnitPrice(finiteNumber(quote?.panelWattage, 0)),
    },
    inverter: {
      selectedId: "inverter-current",
      options: [
        {
          id: "inverter-current",
          label: inverterLabel,
          priceAdjustment: 0,
          ...(Number.isFinite(inverterCapacity) ? { capacityKw: inverterCapacity } : {}),
        },
      ],
    },
    battery: {
      selectedId: "battery-current",
      options: [{ id: "battery-current", label: batteryLabel, priceAdjustment: 0 }],
    },
    structure: {
      selectedId: "structure-current",
      options: [{ id: "structure-current", label: structureLabel, priceAdjustment: 0 }],
    },
    notes:
      "Prices update only for the options approved by Sunchaser. Final technical review remains required.",
  });
}

export function publicInteractiveProposalDefinition(
  definition: InteractiveProposalDefinition
): Omit<InteractiveProposalDefinition, "sourceQuoteId"> {
  const { sourceQuoteId: _sourceQuoteId, ...safe } = definition as InteractiveProposalDefinition & {
    originalQuoteSnapshot?: unknown;
    internalCost?: unknown;
    margin?: unknown;
    costBreakdown?: unknown;
  };
  delete (safe as any).originalQuoteSnapshot;
  delete (safe as any).internalCost;
  delete (safe as any).margin;
  delete (safe as any).costBreakdown;
  return safe;
}
