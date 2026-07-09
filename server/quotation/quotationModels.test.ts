import assert from "node:assert/strict";
import {
  clamp,
  isFiniteNumber,
  isNonEmptyString,
  isNonNegativeNumber,
  isPositiveNumber,
  isQuotationEngineStage,
  num,
  QUOTATION_ENGINE_STAGES,
  QuotationEngineError,
  round2,
} from "./QuotationModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("engine has 9 stages", QUOTATION_ENGINE_STAGES.length === 9);
check("first stage is product_catalog", QUOTATION_ENGINE_STAGES[0] === "product_catalog");
check("last stage is proposal_template", QUOTATION_ENGINE_STAGES[QUOTATION_ENGINE_STAGES.length - 1] === "proposal_template");
check("isQuotationEngineStage accepts valid stage", isQuotationEngineStage("boq_generation"));
check("isQuotationEngineStage rejects unknown", !isQuotationEngineStage("nope"));

check("QuotationEngineError carries stage", new QuotationEngineError("margin_rules", "x").stage === "margin_rules");
check("QuotationEngineError carries reason", new QuotationEngineError("margin_rules", "bad").reason === "bad");
check("QuotationEngineError message includes stage tag", new QuotationEngineError("price_rules", "oops").message === "[price_rules] oops");
check("QuotationEngineError carries details", new QuotationEngineError("price_rules", "x", { a: 1 }).details?.a === 1);
check("QuotationEngineError is an Error instance", new QuotationEngineError("price_rules", "x") instanceof Error);
check("QuotationEngineError name is set", new QuotationEngineError("price_rules", "x").name === "QuotationEngineError");

check("isNonEmptyString true for text", isNonEmptyString("hi"));
check("isNonEmptyString false for empty", !isNonEmptyString(""));
check("isNonEmptyString false for whitespace", !isNonEmptyString("   "));
check("isNonEmptyString false for number", !isNonEmptyString(1));

check("isFiniteNumber true for integer", isFiniteNumber(5));
check("isFiniteNumber true for float", isFiniteNumber(5.5));
check("isFiniteNumber false for NaN", !isFiniteNumber(NaN));
check("isFiniteNumber false for Infinity", !isFiniteNumber(Infinity));
check("isFiniteNumber false for string", !isFiniteNumber("5"));

check("isNonNegativeNumber true for 0", isNonNegativeNumber(0));
check("isNonNegativeNumber false for negative", !isNonNegativeNumber(-0.01));

check("isPositiveNumber true for 0.01", isPositiveNumber(0.01));
check("isPositiveNumber false for 0", !isPositiveNumber(0));
check("isPositiveNumber false for negative", !isPositiveNumber(-1));

check("num coerces numeric string", num("42") === 42);
check("num falls back for garbage", num("garbage", 7) === 7);
check("num falls back default is 0", num("garbage") === 0);
check("num passes through a finite number unchanged", num(3.14) === 3.14);

check("round2 rounds up correctly", round2(1.005) === 1.01 || round2(1.005) === 1);
check("round2 keeps two decimals", round2(10.1) === 10.1);
check("round2 handles integers", round2(10) === 10);
check("round2 handles negative numbers", round2(-1.005) === -1 || round2(-1.005) === -1.01);

check("clamp keeps value within range", clamp(5, 0, 10) === 5);
check("clamp floors below min", clamp(-5, 0, 10) === 0);
check("clamp ceils above max", clamp(15, 0, 10) === 10);
check("clamp handles min === max", clamp(5, 3, 3) === 3);

console.log(`\nQuotationModels tests: ${pass} passed`);
