/**
 * Static validation for SYNC-14C-A / R1 name_source migration release pack.
 * Run: node scripts/validate-sync14c-name-source-migration-pack.mjs
 * Does not connect to a database and does not apply SQL.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORWARD_ALLOW_LIST,
  ROLLBACK_ALLOW_LIST,
  constraintMatchesAllowList,
  decideConstraintAction,
  parseNameSourceAllowList,
} from "./sync14c/nameSourceConstraintEquality.mjs";

const root = process.cwd();
const files = {
  preflight: "scripts/sync14c/sync14c-name-source-preflight.sql",
  forward: "scripts/sync14c/sync14c-name-source-forward-migration.sql",
  postVerify: "scripts/sync14c/sync14c-name-source-post-verify.sql",
  rollback: "scripts/sync14c/sync14c-name-source-rollback.sql",
  backfill: "scripts/sync14c/sync14c-name-source-backfill-optional-DISABLED.sql",
  sequencing:
    "docs/deployment/sync14c-contact-identity-name-source-release-sequencing.md",
  equality: "scripts/sync14c/nameSourceConstraintEquality.mjs",
};

for (const [label, rel] of Object.entries(files)) {
  const abs = join(root, rel);
  assert.ok(existsSync(abs), `missing ${label}: ${rel}`);
}

const preflight = readFileSync(join(root, files.preflight), "utf8");
const forward = readFileSync(join(root, files.forward), "utf8");
const postVerify = readFileSync(join(root, files.postVerify), "utf8");
const rollback = readFileSync(join(root, files.rollback), "utf8");
const backfill = readFileSync(join(root, files.backfill), "utf8");
const sequencing = readFileSync(join(root, files.sequencing), "utf8");

function pgInForm(values) {
  const list = values.map((v) => `'${v}'::text`).join(", ");
  return `CHECK ((name_source IS NULL) OR (name_source = ANY (ARRAY[${list}])))`;
}

function pgInFormUnvalidatedShape(values) {
  // Same textual shape PostgreSQL emits for IN(...); validation is separate.
  return pgInForm(values);
}

const exactForwardDef = pgInForm(FORWARD_ALLOW_LIST);
const exactRollbackDef = pgInForm(ROLLBACK_ALLOW_LIST);
const missingOldValueDef = pgInForm(
  FORWARD_ALLOW_LIST.filter((v) => v !== "whatsapp_short")
);
const extraValueDef = pgInForm([...FORWARD_ALLOW_LIST, "whatsapp_unexpected"]);
const malformedTempDef = pgInForm(["manual", "whatsapp_verified", "evil"]);
const narrowMalformedRollbackDef = pgInForm(["manual", "whatsapp_saved"]);

// ---------------------------------------------------------------------------
// Semantic equality unit scenarios (R1)
// ---------------------------------------------------------------------------

{
  const parsed = parseNameSourceAllowList(exactForwardDef);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.values, [...FORWARD_ALLOW_LIST].sort());
}

{
  const m = constraintMatchesAllowList(exactForwardDef, FORWARD_ALLOW_LIST, {
    requireValidated: true,
    validated: true,
  });
  assert.equal(m.equal, true, "exact forward+validated must match");
}

{
  const m = constraintMatchesAllowList(exactForwardDef, FORWARD_ALLOW_LIST, {
    requireValidated: true,
    validated: false,
  });
  assert.equal(m.equal, false, "unvalidated canonical must not count as equal for no-op");
  assert.match(m.reason, /not validated/i);
}

{
  const m = constraintMatchesAllowList(missingOldValueDef, FORWARD_ALLOW_LIST);
  assert.equal(m.equal, false, "missing old allowed value must fail");
}

{
  const m = constraintMatchesAllowList(extraValueDef, FORWARD_ALLOW_LIST);
  assert.equal(m.equal, false, "unintended extra value must fail");
}

// Interrupted correct temporary constraint → promote
{
  const d = decideConstraintAction("forward", {
    canonicalDef: exactRollbackDef,
    canonicalValidated: true,
    tempDef: exactForwardDef,
    tempValidated: false,
    tempName: "v14c",
  });
  assert.equal(d.action, "PROMOTE_TEMP", "interrupted correct temp must promote");
}

// Interrupted malformed temporary constraint → STOP
{
  const d = decideConstraintAction("forward", {
    canonicalDef: exactRollbackDef,
    canonicalValidated: true,
    tempDef: malformedTempDef,
    tempValidated: false,
    tempName: "v14c",
  });
  assert.equal(d.action, "STOP", "malformed temp must STOP fail-closed");
  assert.match(d.reason, /mismatched temporary/i);
}

// Canonical missing an old allowed value → rebuild
{
  const d = decideConstraintAction("forward", {
    canonicalDef: missingOldValueDef,
    canonicalValidated: true,
  });
  assert.equal(d.action, "REBUILD", "canonical missing old value must rebuild");
}

// Canonical containing unintended extra value → rebuild
{
  const d = decideConstraintAction("forward", {
    canonicalDef: extraValueDef,
    canonicalValidated: true,
  });
  assert.equal(d.action, "REBUILD", "canonical with extra value must rebuild");
}

// Unvalidated canonical with exact definition → validate in place
{
  const d = decideConstraintAction("forward", {
    canonicalDef: pgInFormUnvalidatedShape(FORWARD_ALLOW_LIST),
    canonicalValidated: false,
  });
  assert.equal(
    d.action,
    "VALIDATE_CANONICAL",
    "unvalidated exact canonical must validate, not no-op"
  );
}

// Repeat forward (already exact+validated) → NOOP
{
  const d = decideConstraintAction("forward", {
    canonicalDef: exactForwardDef,
    canonicalValidated: true,
  });
  assert.equal(d.action, "NOOP", "repeat forward must no-op");
}

// Repeat rollback (already exact+validated pre-expansion) → NOOP
{
  const d = decideConstraintAction("rollback", {
    canonicalDef: exactRollbackDef,
    canonicalValidated: true,
  });
  assert.equal(d.action, "NOOP", "repeat rollback must no-op");
}

// Rollback must not no-op on narrow/malformed pre-expansion-looking constraint
{
  const m = constraintMatchesAllowList(
    narrowMalformedRollbackDef,
    ROLLBACK_ALLOW_LIST,
    { requireValidated: true, validated: true }
  );
  assert.equal(m.equal, false, "narrow rollback allow-list must not match");
  const d = decideConstraintAction("rollback", {
    canonicalDef: narrowMalformedRollbackDef,
    canonicalValidated: true,
  });
  assert.equal(d.action, "REBUILD", "malformed narrow rollback canonical must rebuild");
}

// Partial ILIKE-style trap: contains verified+legacy but missing phone
{
  const trap = pgInForm(
    FORWARD_ALLOW_LIST.filter((v) => v !== "phone")
  );
  assert.match(trap, /whatsapp_verified/i);
  assert.match(trap, /whatsapp_legacy/i);
  const m = constraintMatchesAllowList(trap, FORWARD_ALLOW_LIST);
  assert.equal(m.equal, false, "partial substring-style trap must fail exact equality");
}

// ---------------------------------------------------------------------------
// SQL pack posture checks
// ---------------------------------------------------------------------------

// Preflight: read-only posture + schema guard
assert.match(preflight, /READ-ONLY/i, "preflight must declare read-only");
assert.match(preflight, /NO DDL/i, "preflight must forbid DDL");
assert.match(preflight, /schema guard/i, "preflight must include schema guard");
assert.match(preflight, /name_source/i, "preflight must inspect name_source");
assert.match(preflight, /phone-like|phone_like|profile_name/i, "preflight must cover phone-like names");
assert.match(preflight, /duplicate/i, "preflight must cover duplicate risks");
assert.match(preflight, /PASS: SYNC-14C-A preflight/i, "preflight missing PASS notice");
assert.match(preflight, /is not distinct from expected/i, "preflight must use exact allow-list equality");
assert.doesNotMatch(
  preflight,
  /^\s*(alter|create|drop|update|insert|delete)\b/im,
  "preflight must not contain DDL/DML statements"
);
assert.doesNotMatch(
  preflight,
  /constraint_def ilike '%whatsapp_verified%'/i,
  "preflight must not decide expansion via partial ILIKE"
);

// Forward: exact equality + fail-closed temp + rebuild path
assert.match(forward, /whatsapp_verified/, "forward must allow whatsapp_verified");
assert.match(forward, /whatsapp_legacy/, "forward must allow whatsapp_legacy");
assert.match(forward, /whatsapp_saved/, "forward must preserve whatsapp_saved");
assert.match(forward, /\bmanual\b/, "forward must preserve manual");
assert.match(forward, /not valid/i, "forward should add constraint NOT VALID first");
assert.match(forward, /validate constraint/i, "forward must VALIDATE constraint");
assert.match(forward, /convalidated/i, "forward must inspect convalidated");
assert.match(forward, /is not distinct from expected/i, "forward must use exact set equality");
assert.match(
  forward,
  /temporary constraint % exists but definition is not exactly/i,
  "forward must STOP on mismatched temporary"
);
assert.match(forward, /action := 'REBUILD'/i, "forward must support rebuild path");
assert.match(forward, /action := 'NOOP'/i, "forward must support idempotent no-op");
assert.match(forward, /action := 'PROMOTE_TEMP'/i, "forward must promote proven temp");
assert.match(forward, /Schema guard/i, "forward must include schema guard");
assert.doesNotMatch(
  forward,
  /already_ok := true/i,
  "forward must not use legacy already_ok ILIKE gate"
);
assert.doesNotMatch(
  forward,
  /old_def ilike '%whatsapp_verified%'/i,
  "forward must not decide expansion via partial ILIKE"
);
assert.doesNotMatch(forward, /\benable row level security\b/i, "forward must not touch RLS enable");
assert.doesNotMatch(forward, /\bcreate policy\b/i, "forward must not create policies");
assert.doesNotMatch(forward, /\bgrant\b/i, "forward must not grant privileges");
assert.doesNotMatch(forward, /\brevoke\b/i, "forward must not revoke privileges");
assert.doesNotMatch(
  forward,
  /^\s*update\s+public\.whatsapp_contacts\b/im,
  "forward must not rewrite contact rows"
);

// Post-verify
assert.match(postVerify, /PASS: SYNC-14C-A post-verify/i, "post-verify missing PASS notice");
assert.match(postVerify, /schema guard/i, "post-verify must include schema guard");
assert.match(postVerify, /relrowsecurity|rls/i, "post-verify must check RLS");
assert.match(postVerify, /is not distinct from expected/i, "post-verify must use exact equality");
assert.match(postVerify, /not validated/i, "post-verify must require convalidated");
assert.doesNotMatch(
  postVerify,
  /def not ilike '%whatsapp_verified%'/i,
  "post-verify must not rely on partial ILIKE for PASS"
);
assert.doesNotMatch(
  postVerify,
  /^\s*(alter|create|drop|update|insert|delete)\b/im,
  "post-verify must not contain DDL/DML statements"
);

// Rollback limitations + exactness + corrected app comment
assert.match(rollback, /LIMITATIONS/i, "rollback must document limitations");
assert.match(rollback, /whatsapp_verified|whatsapp_legacy/, "rollback must mention expanded values");
assert.match(rollback, /STOP:/i, "rollback must fail closed when expanded values exist");
assert.match(rollback, /is not distinct from expected/i, "rollback must use exact set equality");
assert.match(
  rollback,
  /temporary constraint % exists but definition is not exactly/i,
  "rollback must STOP on mismatched temporary"
);
assert.match(rollback, /action := 'NOOP'/i, "rollback must support idempotent no-op");
assert.match(rollback, /action := 'REBUILD'/i, "rollback must support rebuild");
assert.match(rollback, /Schema guard/i, "rollback must include schema guard");
assert.match(
  rollback,
  /treated as whatsapp_legacy/i,
  "rollback column comment must match app policy (whatsapp_legacy, not manual)"
);
assert.doesNotMatch(
  rollback,
  /treated as manual by the app/i,
  "rollback must not claim null-source legacy rows are treated as manual"
);
assert.doesNotMatch(
  rollback,
  /def ilike '%manual%'[\s\S]*def not ilike '%whatsapp_verified%'/i,
  "rollback must not use partial ILIKE already_old gate"
);

// Backfill disabled
assert.match(backfill, /DISABLED/i, "backfill must be marked DISABLED");
assert.match(backfill, /Do NOT/i, "backfill must warn not to apply");
assert.doesNotMatch(
  backfill,
  /^\s*update\s+public\.whatsapp_contacts\b/im,
  "disabled backfill must not contain live UPDATE"
);

// Sequencing document
assert.match(sequencing, /preflight/i);
assert.match(sequencing, /backup|checkpoint/i);
assert.match(sequencing, /forward migration/i);
assert.match(sequencing, /post-verify|verification/i);
assert.match(sequencing, /code merge/i);
assert.match(sequencing, /deployment/i);
assert.match(sequencing, /smoke test/i);
assert.match(sequencing, /rollback/i);
assert.match(sequencing, /Do not run/i);
assert.match(
  sequencing,
  /fail-closed|exact allow-list|R1/i,
  "sequencing should document R1 fail-closed idempotency"
);

console.log("SYNC-14C-A-R1 name_source migration pack static validation passed.");
