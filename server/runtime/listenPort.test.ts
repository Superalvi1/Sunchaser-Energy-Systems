import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveListenPort } from "./listenPort.ts";

test("preserves Render/local 3000 default", () => {
  assert.equal(resolveListenPort({}), 3000);
  assert.equal(resolveListenPort({ PORT: "" }), 3000);
});
test("honors Railway's injected PORT", () => {
  assert.equal(resolveListenPort({ PORT: "8080" }), 8080);
  assert.equal(resolveListenPort({ PORT: " 3000 " }), 3000);
});
test("rejects invalid or unsafe PORT values", () => {
  for (const PORT of ["0", "-1", "65536", "3000.1", "abc", "Infinity"]) {
    assert.throws(() => resolveListenPort({ PORT }), /PORT must be an integer/);
  }
});
