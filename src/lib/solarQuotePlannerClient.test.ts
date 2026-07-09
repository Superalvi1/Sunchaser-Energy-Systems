import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  assertSolarQuoteDraftSafe,
  buildDraftApplyPayload,
  mapSolarDraftToBoqRows,
  planSolarQuote,
} from "./solarQuotePlannerClient.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const MALICIOUS_NAME = "Fatima Shah 03001234567";

check(
  "client planner draft excludes customer name from apply payload JSON",
  (() => {
    const draft = planSolarQuote({
      customerName: MALICIOUS_NAME,
      systemSizeKw: 10,
      systemType: "on-grid",
      location: "Lahore",
    });
    const payload = buildDraftApplyPayload(draft);
    const blob = JSON.stringify(payload);
    return (
      payload !== null &&
      assertSolarQuoteDraftSafe(draft, [MALICIOUS_NAME, "Fatima"]) &&
      !blob.includes(MALICIOUS_NAME)
    );
  })()
);

check(
  "mapSolarDraftToBoqRows produces editable rows without saving",
  (() => {
    const draft = planSolarQuote({ systemSizeKw: 5, systemType: "hybrid", location: "Lahore" });
    const rows = mapSolarDraftToBoqRows(draft);
    return rows.length > 0 && rows.some((r) => r.type === "item") && rows.some((r) => r.type === "heading");
  })()
);

check(
  "AI quote builder modal does not call save or messaging APIs",
  (() => {
    const source = readFileSync(join(__dirname, "../components/quoteAuthoring/AIQuoteBuilderModal.tsx"), "utf8");
    const forbidden =
      /on创造Quote|handleSaveQuote|create-quote|sendWhatsApp|authorizedFetch|localStorage\.setItem/i;
    return !forbidden.test(source) && source.includes("Draft only");
  })()
);

check(
  "SalesTeamApp AI apply handler does not auto-save quotation",
  (() => {
    const source = readFileSync(join(__dirname, "../components/SalesTeamApp.tsx"), "utf8");
    const handlerChunk = source.slice(source.indexOf("handleApplyAiQuoteDraft"), source.indexOf("handleApplyAiQuoteDraft") + 600);
    return (
      handlerChunk.includes("setBoqRows") &&
      !handlerChunk.includes("handleSaveQuote") &&
      !handlerChunk.includes("on创造Quote") &&
      !handlerChunk.includes("create-quote")
    );
  })()
);

console.log(`\nsolarQuotePlannerClient tests: ${pass} passed`);
