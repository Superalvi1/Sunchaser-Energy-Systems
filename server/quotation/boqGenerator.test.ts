import assert from "node:assert/strict";
import { QuotationEngineError } from "./QuotationModels.ts";
import { createInMemoryProductCatalog } from "./ProductCatalog.ts";
import { applyDiscountToBoq, generateBoq, totalCableCost, type SystemDesignInput } from "./BoqGenerator.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function buildCatalog() {
  const catalog = createInMemoryProductCatalog();
  catalog.register({
    id: "panel-1",
    category: "panel",
    name: "Panel 550W",
    brand: "LONGi",
    unit: "piece",
    unitCost: 28000,
    unitPrice: 34000,
    specs: { wattage: 550 },
    active: true,
  });
  catalog.register({
    id: "inverter-1",
    category: "inverter",
    name: "Hybrid Inverter 10kW",
    brand: "Growatt",
    unit: "piece",
    unitCost: 250000,
    unitPrice: 300000,
    specs: {},
    active: true,
  });
  catalog.register({
    id: "battery-1",
    category: "battery",
    name: "Lithium 5.12kWh",
    brand: "Dyness",
    unit: "piece",
    unitCost: 180000,
    unitPrice: 220000,
    specs: {},
    active: true,
  });
  catalog.register({
    id: "freight-1",
    category: "freight",
    name: "Freight",
    brand: "N/A",
    unit: "lot",
    unitCost: 15000,
    unitPrice: 20000,
    specs: {},
    active: true,
  });
  catalog.register({
    id: "netmeter-1",
    category: "net_metering",
    name: "Net Metering Application",
    brand: "N/A",
    unit: "job",
    unitCost: 10000,
    unitPrice: 15000,
    specs: {},
    active: true,
  });
  catalog.register({
    id: "panel-inactive",
    category: "panel",
    name: "Discontinued Panel",
    brand: "X",
    unit: "piece",
    unitCost: 1,
    unitPrice: 1,
    specs: {},
    active: false,
  });
  return catalog;
}

function buildDesign(overrides: Partial<SystemDesignInput> = {}): SystemDesignInput {
  return {
    systemSizeKw: 10,
    panelProductId: "panel-1",
    panelCount: 18,
    inverterProductId: "inverter-1",
    inverterCount: 1,
    structureType: "elevated",
    roofType: "flat_concrete",
    structureRatePerKwCost: 5000,
    structureRatePerKwPrice: 7000,
    cableRuns: [
      { type: "dc_cable", lengthMeters: 30, pricePerMeterCost: 100, pricePerMeterPrice: 150, wastagePercent: 0 },
      { type: "ac_cable", lengthMeters: 20, pricePerMeterCost: 80, pricePerMeterPrice: 120, wastagePercent: 0 },
    ],
    extraLineProductIds: ["freight-1", "netmeter-1"],
    ...overrides,
  };
}

check("generateBoq includes a panel line", generateBoq(buildCatalog(), buildDesign()).lines.some((l) => l.category === "panel"));
check("generateBoq includes an inverter line", generateBoq(buildCatalog(), buildDesign()).lines.some((l) => l.category === "inverter"));
check("generateBoq omits battery line when no batteryProductId given", !generateBoq(buildCatalog(), buildDesign()).lines.some((l) => l.category === "battery"));
check(
  "generateBoq includes a battery line when batteryProductId is given",
  generateBoq(buildCatalog(), buildDesign({ batteryProductId: "battery-1", batteryCount: 2 })).lines.some((l) => l.category === "battery")
);
check(
  "generateBoq battery line quantity matches batteryCount",
  generateBoq(buildCatalog(), buildDesign({ batteryProductId: "battery-1", batteryCount: 2 })).lines.find((l) => l.category === "battery")
    ?.quantity === 2
);
check("generateBoq includes a structure line", generateBoq(buildCatalog(), buildDesign()).lines.some((l) => l.category === "structure"));
check("generateBoq includes dc_cable and ac_cable lines", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  return boq.lines.some((l) => l.category === "dc_cable") && boq.lines.some((l) => l.category === "ac_cable");
})());
check("generateBoq includes extra flat-fee lines (freight, net_metering)", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  return boq.lines.some((l) => l.category === "freight") && boq.lines.some((l) => l.category === "net_metering");
})());

check("generateBoq panel line total price equals unitPrice * panelCount", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  const panelLine = boq.lines.find((l) => l.category === "panel")!;
  return panelLine.totalPrice === 34000 * 18;
})());

check("generateBoq totalCost equals the sum of all line totalCosts", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  const sum = boq.lines.reduce((s, l) => s + l.totalCost, 0);
  return Math.abs(boq.totalCost - sum) < 0.01;
})());
check("generateBoq totalPrice equals the sum of all line totalPrices", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  const sum = boq.lines.reduce((s, l) => s + l.totalPrice, 0);
  return Math.abs(boq.totalPrice - sum) < 0.01;
})());
check("generateBoq margin.totalCost matches boq.totalCost", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  return boq.margin.totalCost === boq.totalCost;
})());
check("generateBoq margin.totalPrice matches boq.totalPrice", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  return boq.margin.totalPrice === boq.totalPrice;
})());

check(
  "generateBoq throws for zero systemSizeKw",
  (() => {
    try {
      generateBoq(buildCatalog(), buildDesign({ systemSizeKw: 0 }));
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "boq_generation";
    }
  })()
);
check(
  "generateBoq throws for zero panelCount",
  (() => {
    try {
      generateBoq(buildCatalog(), buildDesign({ panelCount: 0 }));
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "generateBoq throws for zero inverterCount",
  (() => {
    try {
      generateBoq(buildCatalog(), buildDesign({ inverterCount: 0 }));
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "generateBoq throws when batteryProductId set but batteryCount omitted as zero",
  (() => {
    try {
      generateBoq(buildCatalog(), buildDesign({ batteryProductId: "battery-1", batteryCount: 0 }));
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "generateBoq throws for unknown panelProductId",
  (() => {
    try {
      generateBoq(buildCatalog(), buildDesign({ panelProductId: "missing" }));
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "product_catalog";
    }
  })()
);
check(
  "generateBoq throws for an inactive panel product",
  (() => {
    try {
      generateBoq(buildCatalog(), buildDesign({ panelProductId: "panel-inactive" }));
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "generateBoq throws for unknown extraLineProductIds entry",
  (() => {
    try {
      generateBoq(buildCatalog(), buildDesign({ extraLineProductIds: ["does-not-exist"] }));
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

check("generateBoq applies installCostMultiplier to the structure line's totals", (() => {
  const base = generateBoq(buildCatalog(), buildDesign());
  const boosted = generateBoq(buildCatalog(), buildDesign({ installCostMultiplier: 1.2 }));
  const baseStructure = base.lines.find((l) => l.category === "structure")!;
  const boostedStructure = boosted.lines.find((l) => l.category === "structure")!;
  return Math.abs(boostedStructure.totalCost - baseStructure.totalCost * 1.2) < 0.01;
})());

check("totalCableCost sums only cable-related lines", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  const dc = boq.lines.find((l) => l.category === "dc_cable")!;
  const ac = boq.lines.find((l) => l.category === "ac_cable")!;
  return Math.abs(totalCableCost(boq) - (dc.totalCost + ac.totalCost)) < 0.01;
})());
check("totalCableCost excludes non-cable lines", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  return totalCableCost(boq) < boq.totalCost;
})());

check("applyDiscountToBoq reduces totalPrice by the given percent", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  const discounted = applyDiscountToBoq(boq, 10);
  return Math.abs(discounted.totalPrice - boq.totalPrice * 0.9) < 0.01;
})());
check("applyDiscountToBoq does not change totalCost", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  const discounted = applyDiscountToBoq(boq, 10);
  return discounted.totalCost === boq.totalCost;
})());
check("applyDiscountToBoq of 0% leaves totalPrice unchanged", (() => {
  const boq = generateBoq(buildCatalog(), buildDesign());
  const discounted = applyDiscountToBoq(boq, 0);
  return discounted.totalPrice === boq.totalPrice;
})());
check(
  "applyDiscountToBoq throws for a negative percent",
  (() => {
    try {
      applyDiscountToBoq(generateBoq(buildCatalog(), buildDesign()), -1);
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "applyDiscountToBoq throws for a percent above 100",
  (() => {
    try {
      applyDiscountToBoq(generateBoq(buildCatalog(), buildDesign()), 101);
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

console.log(`\nBoqGenerator tests: ${pass} passed`);
