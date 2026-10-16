import assert from "node:assert/strict";
import { moosTestRecipientAllowed } from "./moosTestScope.ts";
const limited = { MOOS_TEST_ONLY_RECIPIENT_E164: "+923218486752" };
assert.equal(moosTestRecipientAllowed("923218486752", limited), true);
assert.equal(moosTestRecipientAllowed("+92 321 8486752", limited), true);
assert.equal(moosTestRecipientAllowed("03218486752", limited), true);
assert.equal(moosTestRecipientAllowed("+923001234567", limited), false);
assert.equal(moosTestRecipientAllowed(null, limited), false);
assert.equal(moosTestRecipientAllowed("923218486752", { MOOS_TEST_ONLY_RECIPIENT_E164: "invalid" }), false);
assert.equal(moosTestRecipientAllowed("+923001234567", {}), true);
console.log("Moos staging recipient allowlist tests passed.");

// Fail closed: missing/invalid allowlist in deployed production CRM cannot
// silently permit messages to all contacts.
assert.equal(moosTestRecipientAllowed("923001234567", { NODE_ENV: "production" }), false, "production without allowlist");
assert.equal(moosTestRecipientAllowed("923001234567", { MOOS_PILOT_SCOPE_REQUIRED: "true" }), false, "explicit pilot with no allowlist");
assert.equal(moosTestRecipientAllowed("923218486752", { ...limited, NODE_ENV: "production" }), true);
assert.equal(moosTestRecipientAllowed("923001234567", { ...limited, NODE_ENV: "production" }), false);
