/**
 * Design session validation + schema-missing fail-closed tests (RC-1.1 audit).
 */

import assert from "node:assert/strict";
import {
  isDesignSessionDevFallbackAllowed,
  isSafeRoofImageDataUrl,
  parseDesignSessionStatus,
  parseSafeExpectedVersion,
  scrubSecretsDeep,
  validateDesignSessionPutBody,
  DESIGN_SESSION_MAX_PAYLOAD_BYTES,
} from "../../server/designSessions/designSessionValidation.ts";
import { emptyDesignSessionPayload } from "../../src/lib/designSessionClient.ts";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("expectedVersion rejects unsafe numbers", () => {
  assert.equal(parseSafeExpectedVersion(1.5).ok, false);
  assert.equal(parseSafeExpectedVersion(-1).ok, false);
  assert.equal(parseSafeExpectedVersion(Number.MAX_SAFE_INTEGER + 1).ok, false);
  assert.equal(parseSafeExpectedVersion(2).ok, true);
  assert.equal(parseSafeExpectedVersion(null).ok, true);
});

check("status rejects unknown values", () => {
  assert.equal(parseDesignSessionStatus("published").ok, false);
  assert.equal(parseDesignSessionStatus("draft").ok, true);
  assert.equal(parseDesignSessionStatus("archived").ok, true);
});

check("validateDesignSessionPutBody enforces schema and size", () => {
  const bad = validateDesignSessionPutBody({ payload: { foo: 1 } });
  assert.equal(bad.ok, false);

  const payload = emptyDesignSessionPayload("lead-x") as unknown as Record<string, unknown>;
  const ok = validateDesignSessionPutBody({
    payload,
    expectedVersion: 0,
    status: "draft",
  });
  assert.equal(ok.ok, true);

  const huge = "x".repeat(DESIGN_SESSION_MAX_PAYLOAD_BYTES + 1000);
  const tooBig = validateDesignSessionPutBody({
    payload: { ...payload, address: huge },
    expectedVersion: null,
  });
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) assert.equal(tooBig.status, 413);
});

check("rejects client last_modified_by", () => {
  const payload = emptyDesignSessionPayload("lead-y") as unknown as Record<string, unknown>;
  const banned = validateDesignSessionPutBody({
    payload,
    last_modified_by: "attacker",
  });
  assert.equal(banned.ok, false);
});

check("scrubSecretsDeep removes api keys", () => {
  const scrubbed = scrubSecretsDeep({
    a: 1,
    apiKey: "secret",
    nested: { token: "t", keep: true },
  }) as any;
  assert.equal(scrubbed.apiKey, undefined);
  assert.equal(scrubbed.nested.token, undefined);
  assert.equal(scrubbed.nested.keep, true);
});

check("roof image data URL allowlist", () => {
  assert.equal(isSafeRoofImageDataUrl(null), true);
  assert.equal(isSafeRoofImageDataUrl("data:image/png;base64,aaa"), true);
  assert.equal(isSafeRoofImageDataUrl("https://evil.example/x.png"), false);
  assert.equal(isSafeRoofImageDataUrl("javascript:alert(1)"), false);
});

check("dev fallback gate", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assert.equal(isDesignSessionDevFallbackAllowed(), false);
  process.env.NODE_ENV = "development";
  assert.equal(isDesignSessionDevFallbackAllowed(), true);
  process.env.NODE_ENV = prev;
});

console.log(`\ndesignSessionValidation tests: ${pass} passed`);
