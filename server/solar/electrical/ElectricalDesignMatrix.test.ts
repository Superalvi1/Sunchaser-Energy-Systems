/**
 * Phase 3C — 1000+ deterministic electrical design matrix.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { designElectricalSystem } from "./ElectricalDesignEngine.ts";
import { PANEL_ELEC_400W, PANEL_ELEC_550W, PANEL_ELEC_580W } from "./PanelElectricalCatalog.ts";
import { getInverterElectricalSpec } from "./InverterElectricalCatalog.ts";
import {
  ElectricalDesignError,
  type ElectricalDesignInput,
  type ElectricalSystemSizeKw,
  type ElectricalSystemType,
  type PanelElectricalSpec,
  type PlacedPanelRef,
} from "./ElectricalModels.ts";
import { assertFiniteElectricalResult } from "./ElectricalValidation.ts";
import { computeElectricalStringing } from "./StringSizingEngine.ts";

let pass = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  try {
    assert.ok(condition, `FAILED: ${name}`);
    pass += 1;
  } catch (e) {
    failed += 1;
    throw e;
  }
}

function fingerprint(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

function panelsForKw(sizeKw: number, wattageW: number): PlacedPanelRef[] {
  const n = Math.max(1, Math.ceil((sizeKw * 1000) / wattageW));
  return Array.from({ length: n }, (_, i) => ({ panelId: `p-${sizeKw}-${i}`, wattage: wattageW }));
}

const SIZES: ElectricalSystemSizeKw[] = [3, 5, 6, 8, 10, 15];
const TYPES: ElectricalSystemType[] = ["on-grid", "hybrid", "off-grid"];
const MODULES: PanelElectricalSpec[] = [PANEL_ELEC_580W, PANEL_ELEC_550W, PANEL_ELEC_400W];
const TMIN = [0, -5, 5];
const TMAX = [40, 45, 50];
const DC_LEN = [10, 25, 40];
const AC_LEN = [8, 20];

let combos = 0;

for (const sizeKw of SIZES) {
  for (const systemType of TYPES) {
    for (const module of MODULES) {
      for (const tMin of TMIN) {
        for (const tMax of TMAX) {
          if (tMin >= tMax) continue;
          for (const dcLengthM of DC_LEN) {
            for (const acLengthM of AC_LEN) {
              combos += 1;
              const label = `${sizeKw}kW/${systemType}/${module.moduleId}/t${tMin}-${tMax}/dc${dcLengthM}/ac${acLengthM}`;
              const input: ElectricalDesignInput = {
                placedPanels: panelsForKw(sizeKw, module.wattageW),
                panelSpec: module,
                inverterSpec: getInverterElectricalSpec(sizeKw, systemType),
                systemType,
                temperatures: { designTempMinC: tMin, designTempMaxC: tMax },
                cableRoute: { dcLengthM, acLengthM },
              };

              const result = designElectricalSystem(input);
              assertFiniteElectricalResult(result);

              check(`${label} finite dcCapacity`, Number.isFinite(result.dcCapacityKw) && result.dcCapacityKw > 0);
              check(`${label} panelCount matches`, result.panelCount === input.placedPanels.length);
              check(`${label} cable sizes > 0`, result.cable.dcCableMm2 > 0 && result.cable.acCableMm2 > 0);
              check(
                `${label} vd >= 0`,
                result.voltageDrop.dcVoltageDropPct >= 0 && result.voltageDrop.acVoltageDropPct >= 0
              );
              check(`${label} protection ratings > 0`, result.protection.acBreaker.ratingA > 0);
              check(`${label} boq non-empty`, result.boq.length > 0);
              check(`${label} assumptions present`, result.assumptions.length > 0);

              if (systemType === "on-grid") {
                check(`${label} on-grid no battery req`, result.protection.batteryFuseDisconnect?.required === false);
              } else {
                check(`${label} hybrid/off-grid battery req`, result.protection.batteryFuseDisconnect?.required === true);
              }

              const again = designElectricalSystem(input);
              check(`${label} deterministic`, fingerprint(result.stringing) === fingerprint(again.stringing));

              // If overall design valid, MPPT must assign ids
              if (result.valid) {
                check(
                  `${label} mppt assigned`,
                  result.stringing.strings.every((s) => typeof s.mpptId === "string" && s.mpptId.length > 0)
                );
              } else {
                check(
                  `${label} invalid design has issues`,
                  result.warnings.length > 0 || result.stringing.issues.length > 0
                );
              }
            }
          }
        }
      }
    }
  }
}

// Impossible stringing matrix (structured invalid, not throw)
const impossibleCases = [
  { maxDc: 100, mpptMin: 90, mpptMax: 95, tMin: -15, tMax: 60 },
  { maxDc: 150, mpptMin: 120, mpptMax: 140, tMin: -20, tMax: 70 },
  { maxDc: 200, mpptMin: 180, mpptMax: 190, tMin: -10, tMax: 55 },
];

for (const c of impossibleCases) {
  for (const sizeKw of SIZES) {
    combos += 1;
    const inv = getInverterElectricalSpec(sizeKw, "on-grid");
    const stringing = computeElectricalStringing({
      panels: panelsForKw(sizeKw, PANEL_ELEC_580W.wattageW),
      panelSpec: PANEL_ELEC_580W,
      inverter: {
        ...inv,
        maxDcVoltageV: c.maxDc,
        mppts: inv.mppts.map((m) => ({ ...m, minV: c.mpptMin, maxV: Math.min(c.mpptMax, c.maxDc - 1) })),
      },
      designTempMinC: c.tMin,
      designTempMaxC: c.tMax,
    });
    check(
      `impossible ${sizeKw}kW maxDc${c.maxDc}`,
      stringing.valid === false && stringing.issues.length > 0
    );
  }
}

// Fail-closed invalid inputs (must throw, not false-pass)
const invalidInputs: Array<{ name: string; patch: Partial<ElectricalDesignInput> }> = [
  { name: "empty panels", patch: { placedPanels: [] } },
  { name: "NaN wattage", patch: { placedPanels: [{ panelId: "a", wattage: Number.NaN }] } },
  { name: "Infinity isc", patch: { panelSpec: { ...PANEL_ELEC_580W, iscStcA: Number.POSITIVE_INFINITY } } },
  { name: "neg dc length", patch: { cableRoute: { dcLengthM: -5, acLengthM: 10 } } },
  { name: "zero ac cable force", patch: { cableRoute: { dcLengthM: 10, acLengthM: 10, acCableMm2: 0 } } },
  {
    name: "duplicate panelId",
    patch: {
      placedPanels: [
        { panelId: "x", wattage: 580 },
        { panelId: "x", wattage: 580 },
      ],
    },
  },
  { name: "empty panelId", patch: { placedPanels: [{ panelId: "", wattage: 580 }] } },
  { name: "earthing NaN", patch: { protection: { earthingConductorMm2: Number.NaN } } },
  { name: "earthing Infinity", patch: { protection: { earthingConductorMm2: Number.POSITIVE_INFINITY } } },
  { name: "earthing zero", patch: { protection: { earthingConductorMm2: 0 } } },
];

for (const inv of invalidInputs) {
  combos += 1;
  let threw = false;
  try {
    designElectricalSystem({
      placedPanels: panelsForKw(5, 580),
      panelSpec: PANEL_ELEC_580W,
      inverterSpec: getInverterElectricalSpec(5, "on-grid"),
      systemType: "on-grid",
      temperatures: { designTempMinC: 0, designTempMaxC: 45 },
      cableRoute: { dcLengthM: 20, acLengthM: 15 },
      ...inv.patch,
    });
  } catch (e) {
    threw = e instanceof ElectricalDesignError;
  }
  check(`fail-closed ${inv.name}`, threw);
}

console.log(`\nElectricalDesignMatrix: ${combos} cases, ${pass} checks passed, ${failed} failed.`);
assert.ok(combos >= 1000, `Expected >= 1000 cases, got ${combos}`);
assert.ok(failed === 0, "Matrix had failures");
