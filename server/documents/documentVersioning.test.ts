import assert from "node:assert/strict";
import {
  createInMemoryVersionRegistry,
  InMemoryVersionRegistry,
  isFirstVersion,
  isUnchangedFromPreviousVersion,
  resolveNextVersion,
} from "./DocumentVersioning.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("createInMemoryVersionRegistry returns an InMemoryVersionRegistry", createInMemoryVersionRegistry() instanceof InMemoryVersionRegistry);
check("new registry has zero families", createInMemoryVersionRegistry().familyCount() === 0);
check("getLatest returns null for unknown family", createInMemoryVersionRegistry().getLatest("f1") === null);
check("listVersions returns empty array for unknown family", createInMemoryVersionRegistry().listVersions("f1").length === 0);

check("resolveNextVersion: first version has versionNumber 1", (() => {
  const registry = createInMemoryVersionRegistry();
  const entry = resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" });
  return entry.versionNumber === 1;
})());

check("resolveNextVersion: first version has no previousVersionId", (() => {
  const registry = createInMemoryVersionRegistry();
  const entry = resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" });
  return entry.previousVersionId === undefined;
})());

check("resolveNextVersion: uses default timestamp when now omitted", (() => {
  const registry = createInMemoryVersionRegistry();
  const entry = resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" });
  return entry.createdAt === "1970-01-01T00:00:00.000Z";
})());

check("resolveNextVersion: accepts explicit now", (() => {
  const registry = createInMemoryVersionRegistry();
  const entry = resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1", now: "2026-01-01T00:00:00.000Z" });
  return entry.createdAt === "2026-01-01T00:00:00.000Z";
})());

check("resolveNextVersion: second version increments to 2", (() => {
  const registry = createInMemoryVersionRegistry();
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" }));
  const second = resolveNextVersion({ registry, familyId: "f1", versionId: "v2", checksum: "c2" });
  return second.versionNumber === 2;
})());

check("resolveNextVersion: second version points to first as previous", (() => {
  const registry = createInMemoryVersionRegistry();
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" }));
  const second = resolveNextVersion({ registry, familyId: "f1", versionId: "v2", checksum: "c2" });
  return second.previousVersionId === "v1";
})());

check("resolveNextVersion: third version increments to 3 and chains to second", (() => {
  const registry = createInMemoryVersionRegistry();
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" }));
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v2", checksum: "c2" }));
  const third = resolveNextVersion({ registry, familyId: "f1", versionId: "v3", checksum: "c3" });
  return third.versionNumber === 3 && third.previousVersionId === "v2";
})());

check("resolveNextVersion: independent families start at 1 each", (() => {
  const registry = createInMemoryVersionRegistry();
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" }));
  const otherFamily = resolveNextVersion({ registry, familyId: "f2", versionId: "v1", checksum: "c1" });
  return otherFamily.versionNumber === 1;
})());

check("resolveNextVersion is pure — does not write to the registry", (() => {
  const registry = createInMemoryVersionRegistry();
  resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" });
  return registry.getLatest("f1") === null;
})());

check("record + getLatest round-trips", (() => {
  const registry = createInMemoryVersionRegistry();
  const entry = resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" });
  registry.record(entry);
  return registry.getLatest("f1")?.versionId === "v1";
})());

check("getLatest returns the most recently recorded version", (() => {
  const registry = createInMemoryVersionRegistry();
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" }));
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v2", checksum: "c2" }));
  return registry.getLatest("f1")?.versionId === "v2";
})());

check("listVersions returns entries sorted by versionNumber", (() => {
  const registry = createInMemoryVersionRegistry();
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" }));
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v2", checksum: "c2" }));
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v3", checksum: "c3" }));
  const versions = registry.listVersions("f1");
  return versions.map((v) => v.versionNumber).join(",") === "1,2,3";
})());

check("listVersions for one family excludes another family's versions", (() => {
  const registry = createInMemoryVersionRegistry();
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" }));
  registry.record(resolveNextVersion({ registry, familyId: "f2", versionId: "v1", checksum: "c1" }));
  return registry.listVersions("f1").length === 1;
})());

check("familyCount reflects distinct families recorded", (() => {
  const registry = createInMemoryVersionRegistry();
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" }));
  registry.record(resolveNextVersion({ registry, familyId: "f2", versionId: "v1", checksum: "c1" }));
  return registry.familyCount() === 2;
})());

check("isFirstVersion true for versionNumber 1 with no previous", isFirstVersion({ versionId: "v1", familyId: "f1", versionNumber: 1, checksum: "c1", createdAt: "t" }));
check("isFirstVersion false for versionNumber 2", !isFirstVersion({ versionId: "v2", familyId: "f1", versionNumber: 2, previousVersionId: "v1", checksum: "c1", createdAt: "t" }));

check("isUnchangedFromPreviousVersion false when there is no previous version", (() => {
  const registry = createInMemoryVersionRegistry();
  const entry = resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "c1" });
  return !isUnchangedFromPreviousVersion(entry, registry);
})());

check("isUnchangedFromPreviousVersion true when checksum matches the prior version", (() => {
  const registry = createInMemoryVersionRegistry();
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "same-checksum" }));
  const second = resolveNextVersion({ registry, familyId: "f1", versionId: "v2", checksum: "same-checksum" });
  return isUnchangedFromPreviousVersion(second, registry);
})());

check("isUnchangedFromPreviousVersion false when checksum differs from the prior version", (() => {
  const registry = createInMemoryVersionRegistry();
  registry.record(resolveNextVersion({ registry, familyId: "f1", versionId: "v1", checksum: "checksum-a" }));
  const second = resolveNextVersion({ registry, familyId: "f1", versionId: "v2", checksum: "checksum-b" });
  return !isUnchangedFromPreviousVersion(second, registry);
})());

console.log(`\nDocumentVersioning tests: ${pass} passed`);
