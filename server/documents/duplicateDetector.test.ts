import assert from "node:assert/strict";
import {
  createInMemoryDuplicateIndex,
  detectDuplicate,
  InMemoryDuplicateIndex,
} from "./DuplicateDetector.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("createInMemoryDuplicateIndex returns an InMemoryDuplicateIndex", createInMemoryDuplicateIndex() instanceof InMemoryDuplicateIndex);
check("new index starts empty", createInMemoryDuplicateIndex().size() === 0);

check("register increases size", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  return idx.size() === 1;
})());

check("detectDuplicate: no match returns isDuplicate false", (() => {
  const idx = createInMemoryDuplicateIndex();
  const result = detectDuplicate(idx, "co1", "unseen-checksum", "f1");
  return !result.isDuplicate && !result.sameFamilyMatch && result.crossFamilyMatches.length === 0;
})());

check("detectDuplicate: same family + same checksum is a duplicate", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  const result = detectDuplicate(idx, "co1", "c1", "f1");
  return result.isDuplicate && result.sameFamilyMatch?.documentId === "d1";
})());

check("detectDuplicate: different family, same checksum is NOT a same-family duplicate", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  const result = detectDuplicate(idx, "co1", "c1", "f2");
  return !result.isDuplicate && !result.sameFamilyMatch;
})());

check("detectDuplicate: different family, same checksum reported as cross-family match", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  const result = detectDuplicate(idx, "co1", "c1", "f2");
  return result.crossFamilyMatches.length === 1 && result.crossFamilyMatches[0].documentId === "d1";
})());

check("detectDuplicate: different companyId never matches", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  const result = detectDuplicate(idx, "co2", "c1", "f1");
  return !result.isDuplicate && result.crossFamilyMatches.length === 0;
})());

check("detectDuplicate: different checksum never matches", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  const result = detectDuplicate(idx, "co1", "c2", "f1");
  return !result.isDuplicate;
})());

check("detectDuplicate: multiple cross-family matches all reported", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  idx.register({ documentId: "d2", familyId: "f2", checksum: "c1", companyId: "co1" });
  const result = detectDuplicate(idx, "co1", "c1", "f3");
  return result.crossFamilyMatches.length === 2;
})());

check("detectDuplicate is pure — does not mutate the index", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  detectDuplicate(idx, "co1", "c1", "f1");
  return idx.size() === 1;
})());

check("detectDuplicate result carries the queried checksum", detectDuplicate(createInMemoryDuplicateIndex(), "co1", "xyz", "f1").checksum === "xyz");

check("register replaces prior record for same documentId", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c2", companyId: "co1" });
  return idx.size() === 1 && idx.lookup("co1", "c2").length === 1 && idx.lookup("co1", "c1").length === 0;
})());

check("remove deletes the record", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  idx.remove("d1");
  return idx.size() === 0;
})());

check("remove on unknown documentId is a no-op", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.remove("does-not-exist");
  return idx.size() === 0;
})());

check("lookup returns empty array for empty index", createInMemoryDuplicateIndex().lookup("co1", "c1").length === 0);

check("lookup returns only matches for the given company+checksum pair", (() => {
  const idx = createInMemoryDuplicateIndex();
  idx.register({ documentId: "d1", familyId: "f1", checksum: "c1", companyId: "co1" });
  idx.register({ documentId: "d2", familyId: "f2", checksum: "c2", companyId: "co1" });
  idx.register({ documentId: "d3", familyId: "f3", checksum: "c1", companyId: "co2" });
  return idx.lookup("co1", "c1").length === 1 && idx.lookup("co1", "c1")[0].documentId === "d1";
})());

console.log(`\nDuplicateDetector tests: ${pass} passed`);
