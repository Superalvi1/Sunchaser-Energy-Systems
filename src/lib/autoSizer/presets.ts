/**
 * Central AutoSizer presets for everyday Sunchaser quotations.
 *
 * Reuses production package-library equipment specs (6 / 8 / 10 kW already
 * exist there) plus the live CRM cable formula. Company settings may overlay
 * typed defaults. Do not scatter `if (kw === 6)` across React components.
 */

import {
  resolvePackageEquipmentSpec,
  type BoqPackageEquipmentSpec,
  type BoqPackageStructureType,
} from "../boqPackageLibrary";
import type { CompanyAutoSizerSizePreset } from "./companyPresets";

export type AutoSizerSystemType = "On-grid" | "Hybrid" | "Off-grid";

export interface AutoSizerCablePreset {
  kind: "dc" | "ac" | "earth";
  size: string;
  name: string;
  brand: string;
  unit: "Meter";
  quantity: number;
  rate: number;
}

export interface AutoSizerPreset {
  systemKw: number;
  systemType: AutoSizerSystemType;
  panel: {
    brand: string;
    wattage: number;
  };
  inverter: {
    brand: string;
    capacity: string;
    quantity: number;
  };
  battery: {
    option: string;
  };
  cables: AutoSizerCablePreset[];
  structureType: "standard" | "elevated" | "girder";
  netMeteringRequired: "Yes" | "No";
  installationCharges: number;
  netMeteringCharges: number;
}

export const AUTOSIZER_PRESET_SIZES_KW = [6, 8, 10] as const;
export type AutoSizerPresetSizeKw = (typeof AUTOSIZER_PRESET_SIZES_KW)[number];

/** Existing CRM AC cable job length (meters) — kept as the commercial default. */
export const DEFAULT_AC_CABLE_METERS = 40;
export const DEFAULT_EARTH_WIRE_METERS = 50;
export const DEFAULT_DC_CABLE_SIZE = "6mm";
export const DEFAULT_AC_CABLE_SIZE = "4-Core";
export const DEFAULT_DC_CABLE_RATE = 280;
export const DEFAULT_AC_CABLE_RATE = 250;
export const DEFAULT_EARTH_WIRE_RATE = 380;

/** Same formula as SalesTeamApp Auto Sizer and SolarDesignRules.dcCableDistanceMeters. */
export function dcCableQuantityMeters(systemKw: number): number {
  return Math.round(Number(systemKw) * 15 + 40);
}

/**
 * On-grid never auto-adds a hybrid battery. Hybrid / Off-grid use the preset.
 * An explicit user/admin override always wins.
 */
export function recommendedBatteryOption(
  systemType: AutoSizerSystemType | string | undefined,
  presetBattery: string | undefined,
  override?: string | null
): string {
  if (override !== undefined && override !== null && String(override).trim() !== "") {
    return String(override);
  }
  if (String(systemType || "").toLowerCase() === "on-grid") return "None";
  return presetBattery && String(presetBattery).trim() ? String(presetBattery) : "None";
}

function cablesForKw(systemKw: number): AutoSizerCablePreset[] {
  return [
    {
      kind: "dc",
      size: DEFAULT_DC_CABLE_SIZE,
      name: `DC Solar Cable ${DEFAULT_DC_CABLE_SIZE}`,
      brand: "GM/FAST",
      unit: "Meter",
      quantity: dcCableQuantityMeters(systemKw),
      rate: DEFAULT_DC_CABLE_RATE,
    },
    {
      kind: "ac",
      size: DEFAULT_AC_CABLE_SIZE,
      name: `AC Connecting Cable ${DEFAULT_AC_CABLE_SIZE}`,
      brand: "GM/FAST",
      unit: "Meter",
      quantity: DEFAULT_AC_CABLE_METERS,
      rate: DEFAULT_AC_CABLE_RATE,
    },
    {
      kind: "earth",
      size: "bare copper",
      name: "Earthing Bare Copper Wire",
      brand: "GM/FAST",
      unit: "Meter",
      quantity: DEFAULT_EARTH_WIRE_METERS,
      rate: DEFAULT_EARTH_WIRE_RATE,
    },
  ];
}

function fromPackageSpec(spec: BoqPackageEquipmentSpec): AutoSizerPreset {
  const structureType: AutoSizerPreset["structureType"] =
    spec.structureType === "elevated" ? "elevated" : "standard";
  return {
    systemKw: spec.systemSizeKw,
    systemType: spec.systemType,
    panel: {
      brand: spec.panelBrand,
      wattage: spec.panelWattage,
    },
    inverter: {
      brand: spec.inverterBrand,
      capacity: spec.inverterCapacity,
      quantity: 1,
    },
    battery: {
      option: spec.batteryOption,
    },
    cables: cablesForKw(spec.systemSizeKw),
    structureType,
    netMeteringRequired: spec.netMeteringRequired,
    installationCharges: spec.installationCharges,
    netMeteringCharges: spec.netMeteringCharges,
  };
}

function builtInPreset(systemKw: AutoSizerPresetSizeKw): AutoSizerPreset {
  const spec = resolvePackageEquipmentSpec(systemKw, "standard", "budgeted");
  return fromPackageSpec(spec);
}

/**
 * Built-in company recommendations. Adding 12 / 15 / 20 kW is: add the size
 * to AUTOSIZER_PRESET_SIZES_KW (package library already knows those sizes).
 */
export const AUTOSIZER_PRESETS: Record<AutoSizerPresetSizeKw, AutoSizerPreset> = {
  6: builtInPreset(6),
  8: builtInPreset(8),
  10: builtInPreset(10),
};

export function isAutoSizerPresetSize(kw: number): kw is AutoSizerPresetSizeKw {
  return (AUTOSIZER_PRESET_SIZES_KW as readonly number[]).includes(kw);
}

function applyCompanyPreset(base: AutoSizerPreset, company?: CompanyAutoSizerSizePreset | null): AutoSizerPreset {
  if (!company) return base;
  const next = mergePreset(base, {
    panel: {
      brand: company.panelBrand || base.panel.brand,
      wattage: company.panelWattage || base.panel.wattage,
    },
    inverter: {
      brand: company.inverterBrand || base.inverter.brand,
      capacity: company.inverterCapacity || base.inverter.capacity,
      quantity: base.inverter.quantity,
    },
    battery: {
      option: company.batteryOption || base.battery.option,
    },
  });
  if (company.dcCableSize) {
    next.cables = next.cables.map((c) =>
      c.kind === "dc"
        ? { ...c, size: company.dcCableSize as string, name: `DC Solar Cable ${company.dcCableSize}` }
        : c
    );
  }
  if (company.acCableSize) {
    next.cables = next.cables.map((c) =>
      c.kind === "ac"
        ? { ...c, size: company.acCableSize as string, name: `AC Connecting Cable ${company.acCableSize}` }
        : c
    );
  }
  return next;
}

/** Exact match first; otherwise build from the package-library spec for that kW. */
export function resolveAutoSizerPreset(
  systemKw: number,
  options?: {
    structureType?: BoqPackageStructureType;
    equipmentTier?: "budgeted" | "premium";
    overrides?: Partial<AutoSizerPreset>;
    companyPreset?: CompanyAutoSizerSizePreset | null;
    systemType?: AutoSizerSystemType;
  }
): AutoSizerPreset {
  const kw = Number(systemKw);
  const structureType = options?.structureType === "elevated" ? "elevated" : "standard";
  const tier = options?.equipmentTier === "premium" ? "premium" : "budgeted";

  let base: AutoSizerPreset;
  if (Number.isFinite(kw) && isAutoSizerPresetSize(kw) && structureType === "standard" && tier === "budgeted") {
    base = AUTOSIZER_PRESETS[kw];
  } else if (Number.isFinite(kw) && kw > 0) {
    const spec = resolvePackageEquipmentSpec(kw, structureType, tier);
    base = fromPackageSpec(spec);
    base.cables = cablesForKw(kw);
    base.systemKw = kw;
  } else {
    base = AUTOSIZER_PRESETS[10];
  }

  base = { ...base, cables: base.cables.map((c) => ({ ...c })) };
  base = applyCompanyPreset(base, options?.companyPreset);

  if (options?.systemType) {
    base.systemType = options.systemType;
    base.battery = {
      option: recommendedBatteryOption(options.systemType, base.battery.option),
    };
  }

  if (!options?.overrides) return base;
  return mergePreset(base, options.overrides);
}

export function nearestAutoSizerPresetSize(systemKw: number): AutoSizerPresetSizeKw {
  const kw = Number(systemKw);
  if (!Number.isFinite(kw) || kw <= 0) return 10;
  let best: AutoSizerPresetSizeKw = AUTOSIZER_PRESET_SIZES_KW[0];
  let bestDist = Math.abs(kw - best);
  for (const size of AUTOSIZER_PRESET_SIZES_KW) {
    const dist = Math.abs(kw - size);
    if (dist < bestDist) {
      best = size;
      bestDist = dist;
    }
  }
  return best;
}

function mergePreset(base: AutoSizerPreset, overrides: Partial<AutoSizerPreset>): AutoSizerPreset {
  return {
    ...base,
    ...overrides,
    panel: { ...base.panel, ...overrides.panel },
    inverter: { ...base.inverter, ...overrides.inverter },
    battery: { ...base.battery, ...overrides.battery },
    cables: overrides.cables ? overrides.cables.map((c) => ({ ...c })) : base.cables.map((c) => ({ ...c })),
  };
}
