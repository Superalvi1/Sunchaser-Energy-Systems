import assert from "node:assert/strict";
import {
  assertValidKnowledgeCollection,
  getKnowledgeCollectionDefinition,
  listKnowledgeCollections,
  resolveCollectionPermissionDomain,
} from "./KnowledgeCollections.ts";
import { KNOWLEDGE_COLLECTIONS } from "./KnowledgeModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("listKnowledgeCollections returns 14 definitions", listKnowledgeCollections().length === 14);
check("every collection has a definition with matching id", KNOWLEDGE_COLLECTIONS.every((c) => getKnowledgeCollectionDefinition(c).id === c));
check("Finance collection maps to finance permission domain", resolveCollectionPermissionDomain("Finance") === "finance");
check("Sales collection maps to sales permission domain", resolveCollectionPermissionDomain("Sales") === "sales");
check("Customers collection maps to customer permission domain", resolveCollectionPermissionDomain("Customers") === "customer");
check("Engineering collection maps to technician permission domain", resolveCollectionPermissionDomain("Engineering") === "technician");
check("Support collection maps to technician permission domain", resolveCollectionPermissionDomain("Support") === "technician");
check("HR collection maps to hr permission domain", resolveCollectionPermissionDomain("HR") === "hr");
check("Legal collection maps to legal permission domain", resolveCollectionPermissionDomain("Legal") === "legal");
check("General collection maps to general permission domain", resolveCollectionPermissionDomain("General") === "general");
check("Policies collection maps to hr permission domain", resolveCollectionPermissionDomain("Policies") === "hr");
check("Inventory collection maps to finance permission domain", resolveCollectionPermissionDomain("Inventory") === "finance");
check("Procurement collection maps to finance permission domain", resolveCollectionPermissionDomain("Procurement") === "finance");
check("Projects collection maps to sales permission domain", resolveCollectionPermissionDomain("Projects") === "sales");
check("SOPs collection maps to general permission domain", resolveCollectionPermissionDomain("SOPs") === "general");
check("Products collection maps to general permission domain", resolveCollectionPermissionDomain("Products") === "general");

check("assertValidKnowledgeCollection returns valid collection", assertValidKnowledgeCollection("Finance") === "Finance");
check(
  "assertValidKnowledgeCollection throws on invalid",
  (() => {
    try {
      assertValidKnowledgeCollection("NotACollection");
      return false;
    } catch (e) {
      return e instanceof Error && e.message.includes("Invalid knowledge collection");
    }
  })()
);

check("Finance definition includes pdf mime type", getKnowledgeCollectionDefinition("Finance").typicalMimeTypes.includes("application/pdf"));
check("Engineering definition includes image/png", getKnowledgeCollectionDefinition("Engineering").typicalMimeTypes.includes("image/png"));

console.log(`\nKnowledgeCollections tests: ${pass} passed`);
