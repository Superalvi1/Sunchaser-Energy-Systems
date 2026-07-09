import assert from "node:assert/strict";
import { DocumentPipelineError } from "./DocumentModels.ts";
import {
  assertStored,
  buildStorageKey,
  createInMemoryStorageProvider,
  InMemoryStorageProvider,
} from "./StorageProvider.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("createInMemoryStorageProvider returns an InMemoryStorageProvider", createInMemoryStorageProvider() instanceof InMemoryStorageProvider);
check("providerId is in-memory", createInMemoryStorageProvider().providerId === "in-memory");
check("new provider is empty", createInMemoryStorageProvider().size() === 0);

check("buildStorageKey format", buildStorageKey("co1", "f1", 3) === "co1/f1/v3");
check("buildStorageKey differs by company", buildStorageKey("co1", "f1", 1) !== buildStorageKey("co2", "f1", 1));
check("buildStorageKey differs by family", buildStorageKey("co1", "f1", 1) !== buildStorageKey("co1", "f2", 1));
check("buildStorageKey differs by version", buildStorageKey("co1", "f1", 1) !== buildStorageKey("co1", "f1", 2));

check("store then exists returns true", (() => {
  const p = createInMemoryStorageProvider();
  p.store("k1", Buffer.from("data"));
  return p.exists("k1");
})());

check("exists false for never-stored key", !createInMemoryStorageProvider().exists("missing"));

check("store then retrieve returns the same bytes", (() => {
  const p = createInMemoryStorageProvider();
  p.store("k1", Buffer.from("hello"));
  return p.retrieve("k1")?.toString() === "hello";
})());

check("retrieve returns null for missing key", createInMemoryStorageProvider().retrieve("missing") === null);

check("store returns a StorageRef with matching key", (() => {
  const p = createInMemoryStorageProvider();
  const ref = p.store("k1", Buffer.from("hello"));
  return ref.key === "k1";
})());

check("store returns a StorageRef with correct sizeBytes", (() => {
  const p = createInMemoryStorageProvider();
  const content = Buffer.from("hello world");
  const ref = p.store("k1", content);
  return ref.sizeBytes === content.byteLength;
})());

check("store returns a StorageRef with provider label", (() => {
  const p = createInMemoryStorageProvider();
  return p.store("k1", Buffer.from("x")).provider === "in-memory";
})());

check("store uses default timestamp when now omitted", (() => {
  const p = createInMemoryStorageProvider();
  return p.store("k1", Buffer.from("x")).storedAt === "1970-01-01T00:00:00.000Z";
})());

check("store accepts explicit now", (() => {
  const p = createInMemoryStorageProvider();
  return p.store("k1", Buffer.from("x"), "2026-02-02T00:00:00.000Z").storedAt === "2026-02-02T00:00:00.000Z";
})());

check("store overwrites content for the same key", (() => {
  const p = createInMemoryStorageProvider();
  p.store("k1", Buffer.from("first"));
  p.store("k1", Buffer.from("second"));
  return p.retrieve("k1")?.toString() === "second";
})());

check("store overwriting the same key does not change size()", (() => {
  const p = createInMemoryStorageProvider();
  p.store("k1", Buffer.from("first"));
  p.store("k1", Buffer.from("second"));
  return p.size() === 1;
})());

check("store returns a copy — mutating the input buffer after store() does not corrupt storage", (() => {
  const p = createInMemoryStorageProvider();
  const content = Buffer.from("original");
  p.store("k1", content);
  content.fill(0);
  return p.retrieve("k1")?.toString() === "original";
})());

check("retrieve returns a copy — mutating the returned buffer does not corrupt storage", (() => {
  const p = createInMemoryStorageProvider();
  p.store("k1", Buffer.from("original"));
  const retrieved = p.retrieve("k1")!;
  retrieved.fill(0);
  return p.retrieve("k1")?.toString() === "original";
})());

check("delete removes the object and returns true", (() => {
  const p = createInMemoryStorageProvider();
  p.store("k1", Buffer.from("x"));
  const deleted = p.delete("k1");
  return deleted && !p.exists("k1");
})());

check("delete on missing key returns false", !createInMemoryStorageProvider().delete("missing"));

check("size reflects number of distinct keys stored", (() => {
  const p = createInMemoryStorageProvider();
  p.store("k1", Buffer.from("a"));
  p.store("k2", Buffer.from("b"));
  return p.size() === 2;
})());

check(
  "assertStored does not throw when key exists",
  (() => {
    const p = createInMemoryStorageProvider();
    p.store("k1", Buffer.from("x"));
    assertStored(p, "k1");
    return true;
  })()
);
check(
  "assertStored throws DocumentPipelineError when key is missing",
  (() => {
    try {
      assertStored(createInMemoryStorageProvider(), "missing");
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError && e.stage === "storage";
    }
  })()
);

console.log(`\nStorageProvider tests: ${pass} passed`);
