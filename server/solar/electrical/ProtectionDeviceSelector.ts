/**
 * Protection device selection — DC/AC breakers, fuses, SPDs, battery disconnect.
 */

import {
  round2,
  type ElectricalSystemType,
  type InverterElectricalSpec,
  type ProtectionDevices,
  type ProtectionPreferences,
} from "./ElectricalModels.ts";

export interface ProtectionSelectorInput {
  systemType: ElectricalSystemType;
  inverter: InverterElectricalSpec;
  stringCount: number;
  iscPerStringA: number;
  totalDcCurrentA: number;
  acCurrentA: number;
  preferences?: ProtectionPreferences;
}

function nextStandardBreakerA(currentA: number): number {
  const sizes = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200];
  for (const s of sizes) {
    if (s >= currentA * 1.25) return s;
  }
  return sizes[sizes.length - 1];
}

export function selectProtectionDevices(input: ProtectionSelectorInput): ProtectionDevices {
  const preferFuse = input.preferences?.preferDcFuse === true;
  const preferBreaker = input.preferences?.preferDcBreaker !== false && !preferFuse;

  const dcStringProtectA = nextStandardBreakerA(input.iscPerStringA);
  const dcCombinedA = nextStandardBreakerA(input.totalDcCurrentA);
  const acBreakerA = nextStandardBreakerA(input.acCurrentA);
  const poles = input.inverter.acPhases === 3 ? 3 : 2;

  const needsBattery = input.systemType === "hybrid" || input.systemType === "off-grid";
  const batteryRating = needsBattery ? nextStandardBreakerA(input.inverter.acRatingKw * 1000 / 48) : null;

  return {
    dcIsolator: {
      ratingA: dcCombinedA,
      label: `DC isolator ${dcCombinedA}A`,
    },
    dcBreakerOrFuse: preferBreaker
      ? {
          type: "breaker",
          ratingA: dcStringProtectA,
          label: `DC MCB ${dcStringProtectA}A per string (×${input.stringCount})`,
        }
      : {
          type: "fuse",
          ratingA: dcStringProtectA,
          label: `DC fuse ${dcStringProtectA}A per string (×${input.stringCount})`,
        },
    dcSpd: {
      type: "Type 2 DC SPD",
      label: `DC SPD ${input.inverter.maxDcVoltageV}V`,
    },
    acBreaker: {
      ratingA: acBreakerA,
      poles,
      label: `AC MCB ${acBreakerA}A ${poles}P`,
    },
    acSpd: {
      type: "Type 2 AC SPD",
      label: `AC SPD ${input.inverter.acNominalVoltageV}V`,
    },
    batteryFuseDisconnect: needsBattery
      ? {
          required: true,
          ratingA: batteryRating,
          label: `Battery fuse/disconnect ${batteryRating}A`,
        }
      : {
          required: false,
          ratingA: null,
          label: "Not required for on-grid",
        },
  };
}

export function acCurrentFromInverter(inverter: InverterElectricalSpec): number {
  const v = inverter.acNominalVoltageV;
  const phases = inverter.acPhases;
  const kw = inverter.acRatingKw;
  if (phases === 3) {
    return round2((kw * 1000) / (Math.sqrt(3) * v));
  }
  return round2((kw * 1000) / v);
}
