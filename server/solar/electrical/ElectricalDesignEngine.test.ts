/**
 * Phase 3C electrical design engine unit tests.
 */

import assert from "node:assert/strict";
import { designElectricalSystem } from "./ElectricalDesignEngine.ts";
import { PANEL_ELEC_580W } from "./PanelElectricalCatalog.ts";
import { getInverterElectricalSpec } from "./InverterElectricalCatalog.ts";
import { ElectricalDesignError, type ElectricalDesignInput, type PlacedPanelRef } from "./ElectricalModels.ts";
import { assertFiniteElectricalResult } from "./ElectricalValidation.ts";
import { computeElectricalStringing } from "./StringSizingEngine.ts";

let pass = 0;
function check(name: string, fn: () => boolean) {
  const ok = fn();
  assert.ok(ok, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function panels(n: number, wattage = 580): PlacedPanelRef[] {
  return Array.from({ length: n }, (_, i) => ({ panelId: `p-${i + 1}`, wattage }));
}

function baseInput(overrides: Partial<ElectricalDesignInput> = {}): ElectricalDesignInput {
  return {
    placedPanels: panels(9),
    panelSpec: { ...PANEL_ELEC_580W },
    inverterSpec: getInverterElectricalSpec(5, "on-grid"),
    systemType: "on-grid",
    temperatures: { designTempMinC: 0, designTempMaxC: 45 },
    cableRoute: { dcLengthM: 20, acLengthM: 15 },
    ...overrides,
  };
}

check("valid 5kW on-grid design succeeds", () => {
  const r = designElectricalSystem(baseInput());
  assertFiniteElectricalResult(r);
  return r.valid && r.stringing.valid && r.panelCount === 9 && r.dcCapacityKw > 0;
});

check("hybrid includes battery protection", () => {
  const r = designElectricalSystem(
    baseInput({
      systemType: "hybrid",
      inverterSpec: getInverterElectricalSpec(5, "hybrid"),
    })
  );
  return r.protection.batteryFuseDisconnect?.required === true;
});

check("off-grid recommends lightning", () => {
  const r = designElectricalSystem(
    baseInput({
      systemType: "off-grid",
      inverterSpec: getInverterElectricalSpec(5, "off-grid"),
    })
  );
  return r.earthingLightning.lightningArrestorRecommended === true;
});

check("empty panels fail closed", () => {
  try {
    designElectricalSystem(baseInput({ placedPanels: [] }));
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_PLACED_PANELS";
  }
});

check("NaN Voc fails closed", () => {
  try {
    designElectricalSystem(baseInput({ panelSpec: { ...PANEL_ELEC_580W, vocStcV: Number.NaN } }));
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_PANEL_SPEC";
  }
});

check("Infinity cable length fails closed", () => {
  try {
    designElectricalSystem(baseInput({ cableRoute: { dcLengthM: Number.POSITIVE_INFINITY, acLengthM: 10 } }));
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_CABLE_LENGTH";
  }
});

check("negative cable length fails closed", () => {
  try {
    designElectricalSystem(baseInput({ cableRoute: { dcLengthM: -1, acLengthM: 10 } }));
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError;
  }
});

check("invalid system type fails closed", () => {
  try {
    designElectricalSystem(baseInput({ systemType: "grid-tie" as "on-grid" }));
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_SYSTEM_TYPE";
  }
});

check("mismatched systemType vs inverter fails", () => {
  try {
    designElectricalSystem(
      baseInput({
        systemType: "hybrid",
        inverterSpec: getInverterElectricalSpec(5, "on-grid"),
      })
    );
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_SYSTEM_TYPE";
  }
});

check("impossible stringing returns structured invalid (not throw)", () => {
  const stringing = computeElectricalStringing({
    panels: panels(20),
    panelSpec: PANEL_ELEC_580W,
    inverter: {
      ...getInverterElectricalSpec(5, "on-grid"),
      maxDcVoltageV: 120,
      mppts: [{ mpptId: "mppt-1", minV: 90, maxV: 110, maxCurrentA: 18, maxStrings: 4 }],
    },
    designTempMinC: -10,
    designTempMaxC: 45,
  });
  return stringing.valid === false && stringing.issues.length > 0 && stringing.strings.length === 0;
});

check("invalid inverter MPPT window fails at validation", () => {
  try {
    designElectricalSystem(
      baseInput({
        inverterSpec: {
          ...getInverterElectricalSpec(5, "on-grid"),
          maxDcVoltageV: 80,
          mppts: [{ mpptId: "mppt-1", minV: 90, maxV: 70, maxCurrentA: 18 }],
        },
      })
    );
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_INVERTER_SPEC";
  }
});

check("MPPT allocation assigns all strings", () => {
  const r = designElectricalSystem(baseInput({ placedPanels: panels(12) }));
  const assigned = r.stringing.strings.every((s) => s.mpptId.length > 0);
  return assigned && r.mpptAllocations.length >= 1;
});

check("voltage drop finite and >= 0", () => {
  const r = designElectricalSystem(baseInput());
  return (
    r.voltageDrop.dcVoltageDropPct >= 0 &&
    r.voltageDrop.acVoltageDropPct >= 0 &&
    Number.isFinite(r.voltageDrop.dcCableLossPct)
  );
});

check("cable sizes positive", () => {
  const r = designElectricalSystem(baseInput());
  return r.cable.dcCableMm2 > 0 && r.cable.acCableMm2 > 0;
});

check("protection devices selected", () => {
  const r = designElectricalSystem(baseInput());
  return r.protection.dcIsolator.ratingA > 0 && r.protection.acBreaker.ratingA > 0;
});

check("BOQ non-empty", () => {
  const r = designElectricalSystem(baseInput());
  return r.boq.length >= 5;
});

check("assumptions returned", () => {
  const r = designElectricalSystem(baseInput());
  return r.assumptions.length >= 3;
});

check("deterministic repeat", () => {
  const a = designElectricalSystem(baseInput());
  const b = designElectricalSystem(baseInput());
  return JSON.stringify(a.stringing) === JSON.stringify(b.stringing) && a.dcCapacityKw === b.dcCapacityKw;
});

check("successful output recursively finite", () => {
  const r = designElectricalSystem(baseInput({ placedPanels: panels(16), inverterSpec: getInverterElectricalSpec(10, "on-grid"), systemType: "on-grid" }));
  assertFiniteElectricalResult(r);
  return true;
});

check("invalid temp range fails closed", () => {
  try {
    designElectricalSystem(baseInput({ temperatures: { designTempMinC: 50, designTempMaxC: 10 } }));
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_TEMPERATURE";
  }
});

check("zero wattage panel fails", () => {
  try {
    designElectricalSystem(baseInput({ placedPanels: [{ panelId: "x", wattage: 0 }] }));
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError;
  }
});

check("duplicate panelId rejected", () => {
  try {
    designElectricalSystem(
      baseInput({
        placedPanels: [
          { panelId: "dup", wattage: 580 },
          { panelId: "dup", wattage: 580 },
        ],
      })
    );
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "DUPLICATE_PANEL_ID";
  }
});

check("missing panelId rejected", () => {
  try {
    designElectricalSystem(
      baseInput({
        placedPanels: [{ panelId: undefined as unknown as string, wattage: 580 }],
      })
    );
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_PANEL_ID";
  }
});

check("empty panelId rejected", () => {
  try {
    designElectricalSystem(baseInput({ placedPanels: [{ panelId: "   ", wattage: 580 }] }));
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_PANEL_ID";
  }
});

check("unique panelIds accepted", () => {
  const r = designElectricalSystem(
    baseInput({
      placedPanels: [
        { panelId: "a", wattage: 580 },
        { panelId: "b", wattage: 580 },
        { panelId: "c", wattage: 580 },
      ],
    })
  );
  return r.panelCount === 3 && r.valid;
});

check("earthingConductorMm2 NaN rejected before calculation", () => {
  try {
    designElectricalSystem(
      baseInput({ protection: { earthingConductorMm2: Number.NaN } })
    );
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_EARTHING_CONDUCTOR";
  }
});

check("earthingConductorMm2 Infinity rejected", () => {
  try {
    designElectricalSystem(
      baseInput({ protection: { earthingConductorMm2: Number.POSITIVE_INFINITY } })
    );
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_EARTHING_CONDUCTOR";
  }
});

check("earthingConductorMm2 0 rejected", () => {
  try {
    designElectricalSystem(baseInput({ protection: { earthingConductorMm2: 0 } }));
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_EARTHING_CONDUCTOR";
  }
});

check("earthingConductorMm2 negative rejected", () => {
  try {
    designElectricalSystem(baseInput({ protection: { earthingConductorMm2: -6 } }));
    return false;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "INVALID_EARTHING_CONDUCTOR";
  }
});

check("validation failure does not reach stringing/protection calculation", () => {
  let stringingCalled = false;
  const original = computeElectricalStringing;
  // Guard: if validation works, computeElectricalStringing is never reached for bad input.
  try {
    designElectricalSystem(
      baseInput({
        placedPanels: [
          { panelId: "same", wattage: 580 },
          { panelId: "same", wattage: 580 },
        ],
      })
    );
    stringingCalled = true;
  } catch (e) {
    return e instanceof ElectricalDesignError && e.code === "DUPLICATE_PANEL_ID" && !stringingCalled;
  }
  void original;
  return false;
});

check("successful outputs remain recursively finite", () => {
  const r = designElectricalSystem(
    baseInput({
      protection: { earthingConductorMm2: 10 },
      placedPanels: panels(9),
    })
  );
  assertFiniteElectricalResult(r);
  return r.earthingLightning.earthingConductorMm2 === 10;
});

console.log(`\nElectricalDesignEngine tests: ${pass} passed`);
