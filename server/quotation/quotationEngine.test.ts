import assert from "node:assert/strict";
import { QuotationEngineError } from "./QuotationModels.ts";
import { createInMemoryProductCatalog } from "./ProductCatalog.ts";
import type { SystemDesignInput } from "./BoqGenerator.ts";
import { createQuotationEngine, QuotationEngine, type QuotationRequest } from "./QuotationEngine.ts";

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
    specs: {},
    active: true,
  });
  catalog.register({
    id: "inverter-1",
    category: "inverter",
    name: "Hybrid Inverter",
    brand: "Growatt",
    unit: "piece",
    unitCost: 250000,
    unitPrice: 300000,
    specs: {},
    active: true,
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
    cableRuns: [],
    ...overrides,
  };
}

function buildRequest(overrides: Partial<QuotationRequest> = {}): QuotationRequest {
  return {
    customerName: "Ali Traders",
    role: "Sales Executive",
    username: "sales1",
    design: buildDesign(),
    ...overrides,
  };
}

check("createQuotationEngine returns a QuotationEngine", createQuotationEngine(buildCatalog()) instanceof QuotationEngine);

check("generate() produces a BOQ", createQuotationEngine(buildCatalog()).generate(buildRequest()).boq.lines.length > 0);
check("generate() with no siteComplexity input returns null siteComplexity", createQuotationEngine(buildCatalog()).generate(buildRequest()).siteComplexity === null);
check("generate() with siteComplexity input returns a computed result", (() => {
  const result = createQuotationEngine(buildCatalog()).generate(
    buildRequest({
      siteComplexity: {
        roofType: "sloped_tile",
        shadingLevel: "heavy",
        roofAccessDifficulty: "difficult",
        meterToRoofDistanceMeters: 50,
        roofFaceCount: 3,
        heightMeters: 15,
      },
    })
  );
  return result.siteComplexity !== null && result.siteComplexity.score > 0;
})());
check("generate() applies the site complexity multiplier to the structure line", (() => {
  const engine = createQuotationEngine(buildCatalog());
  const flat = engine.generate(buildRequest()).boq.lines.find((l) => l.category === "structure")!;
  const complex = engine
    .generate(
      buildRequest({
        siteComplexity: {
          roofType: "sloped_tile",
          shadingLevel: "heavy",
          roofAccessDifficulty: "difficult",
          meterToRoofDistanceMeters: 200,
          roofFaceCount: 10,
          heightMeters: 30,
        },
      })
    )
    .boq.lines.find((l) => l.category === "structure")!;
  return complex.totalCost > flat.totalCost;
})());

check("generate() with no discount requested returns 0% auto-approved", (() => {
  const result = createQuotationEngine(buildCatalog()).generate(buildRequest());
  return result.discount.requestedPercent === 0 && result.discount.autoApproved;
})());

check("generate() applies an auto-approved discount to the BOQ price", (() => {
  const engine = createQuotationEngine(buildCatalog());
  const base = engine.generate(buildRequest()).boq.totalPrice;
  const discounted = engine.generate(buildRequest({ requestedDiscountPercent: 5 })).boq.totalPrice;
  return Math.abs(discounted - base * 0.95) < 0.01;
})());

check("generate() does NOT apply a discount that requires approval", (() => {
  const engine = createQuotationEngine(buildCatalog());
  const base = engine.generate(buildRequest()).boq.totalPrice;
  const requested = engine.generate(buildRequest({ requestedDiscountPercent: 50 })).boq.totalPrice;
  return requested === base;
})());
check("generate() flags an over-limit discount as requiring approval", createQuotationEngine(buildCatalog()).generate(buildRequest({ requestedDiscountPercent: 50 })).discount.requiresApproval);
check(
  "generate() over-limit discount names the correct approver tier",
  createQuotationEngine(buildCatalog()).generate(buildRequest({ requestedDiscountPercent: 50 })).discount.approverTier === "sales_manager"
);

check("generate() hides margin fields for a non-privileged role", (() => {
  const result = createQuotationEngine(buildCatalog()).generate(buildRequest({ role: "Sales Executive", username: "someone" }));
  return result.marginView.totalCost === undefined;
})());
check("generate() reveals margin fields for the privileged Super Admin account", (() => {
  const result = createQuotationEngine(buildCatalog()).generate(buildRequest({ role: "Super Admin", username: "allauddin" }));
  return result.marginView.totalCost !== undefined;
})());
check("generate() honors a custom canViewMargin predicate injected via options", (() => {
  const engine = createQuotationEngine(buildCatalog(), { canViewMargin: () => true });
  const result = engine.generate(buildRequest({ role: "Sales Executive", username: "anyone" }));
  return result.marginView.totalCost !== undefined;
})());

check("generate() builds a proposal outline with the customer's name", createQuotationEngine(buildCatalog()).generate(buildRequest()).proposal.customerName === "Ali Traders");
check("generate() proposal reflects the BOQ total price", (() => {
  const result = createQuotationEngine(buildCatalog()).generate(buildRequest());
  return result.proposal.totalPrice === result.boq.totalPrice;
})());
check("generate() proposal honors a restricted section list", (() => {
  const result = createQuotationEngine(buildCatalog()).generate(buildRequest({ includedProposalSectionIds: ["cover", "boq", "signoff"] }));
  return result.proposal.sections.map((s) => s.id).join(",") === "cover,structure,boq,signoff";
})());

check(
  "generate() throws for empty customerName",
  (() => {
    try {
      createQuotationEngine(buildCatalog()).generate(buildRequest({ customerName: "" }));
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "generate() propagates errors from downstream stages (unknown product)",
  (() => {
    try {
      createQuotationEngine(buildCatalog()).generate(buildRequest({ design: buildDesign({ panelProductId: "missing" }) }));
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "product_catalog";
    }
  })()
);

console.log(`\nQuotationEngine tests: ${pass} passed`);
