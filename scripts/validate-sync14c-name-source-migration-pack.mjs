/**
 * Static validation for SYNC-14C-A / R4 name_source migration release pack.
 * Run: node scripts/validate-sync14c-name-source-migration-pack.mjs
 * Does not connect to a database and does not apply SQL.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORWARD_ALLOW_LIST,
  FORWARD_REF_NAME,
  ROLLBACK_ALLOW_LIST,
  ROLLBACK_REF_NAME,
  constraintCompleteMatch,
  decideConstraintAction,
  decideNameCollision,
  isCompletePredicateProven,
  pgNormalizedConstraintdef,
  pgNormalizedExpr,
  setOnlyAllowListMatch,
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
  assert.ok(existsSync(join(root, rel)), `missing ${label}: ${rel}`);
}

const preflight = readFileSync(join(root, files.preflight), "utf8");
const forward = readFileSync(join(root, files.forward), "utf8");
const postVerify = readFileSync(join(root, files.postVerify), "utf8");
const rollback = readFileSync(join(root, files.rollback), "utf8");
const backfill = readFileSync(join(root, files.backfill), "utf8");
const sequencing = readFileSync(join(root, files.sequencing), "utf8");

const exactForward = pgNormalizedConstraintdef(FORWARD_ALLOW_LIST);
const exactRollback = pgNormalizedConstraintdef(ROLLBACK_ALLOW_LIST);
const exactForwardExpr = pgNormalizedExpr(FORWARD_ALLOW_LIST);
const exactRollbackExpr = pgNormalizedExpr(ROLLBACK_ALLOW_LIST);

// ---------------------------------------------------------------------------
// Bypass tests — set-only would accept; complete predicate proof must reject
// ---------------------------------------------------------------------------

function bypass(label, def, mode = "forward") {
  const expected = mode === "forward" ? FORWARD_ALLOW_LIST : ROLLBACK_ALLOW_LIST;
  assert.equal(
    setOnlyAllowListMatch(def, expected),
    true,
    `${label}: fixture should pass weak set-only matcher`
  );
  const proof = isCompletePredicateProven(def, mode);
  assert.equal(proof.proven, false, `${label}: complete proof must reject bypass`);
  const decision = decideConstraintAction(mode, {
    canonicalProven: false,
    canonicalValidated: true,
    tempPresent: false,
  });
  // Unproven canonical must rebuild, never no-op
  assert.equal(decision.action, "REBUILD", `${label}: unproven ⇒ rebuild`);
}

{
  // expected allow-list AND false
  bypass(
    "AND false",
    `CHECK ((${exactForwardExpr}) AND false)`
  );
}

{
  // expected allow-list AND name_source <> 'manual'
  bypass(
    "AND name_source <> manual",
    `CHECK ((${exactForwardExpr}) AND name_source <> 'manual')`
  );
}

{
  // expected allow-list OR name_source IS NOT NULL
  bypass(
    "OR IS NOT NULL",
    `CHECK ((${exactForwardExpr}) OR name_source IS NOT NULL)`
  );
}

{
  // expected values applied to another column
  const otherCol = exactForward.replaceAll("name_source", "profile_name");
  bypass("other column profile_name", otherCol);
}

{
  // correct set plus additional expression/function
  bypass(
    "lower() wrapper",
    `CHECK ((name_source IS NULL) OR (lower(name_source) = ANY (ARRAY[${FORWARD_ALLOW_LIST.map(
      (v) => `'${v}'::text`
    ).join(", ")}])))`
  );
}

// Correct exact forward/rollback predicates must prove
{
  const f = isCompletePredicateProven(exactForward, "forward");
  assert.equal(f.proven, true, "exact forward constraintdef must prove");
  const fe = isCompletePredicateProven(exactForwardExpr, "forward");
  assert.equal(fe.proven, true, "exact forward expr must prove");
  const r = isCompletePredicateProven(exactRollback, "rollback");
  assert.equal(r.proven, true, "exact rollback constraintdef must prove");
  const re = isCompletePredicateProven(exactRollbackExpr, "rollback");
  assert.equal(re.proven, true, "exact rollback expr must prove");
}

// Repeat forward / rollback decisions
{
  const d = decideConstraintAction("forward", {
    canonicalProven: true,
    canonicalValidated: true,
    tempPresent: false,
  });
  assert.equal(d.action, "NOOP", "repeat forward must no-op when proven+validated");
}
{
  const d = decideConstraintAction("rollback", {
    canonicalProven: true,
    canonicalValidated: true,
    tempPresent: false,
  });
  assert.equal(d.action, "NOOP", "repeat rollback must no-op when proven+validated");
}

// Interrupted correct temporary → promote; malformed → STOP
{
  const d = decideConstraintAction("forward", {
    canonicalProven: false,
    canonicalValidated: true,
    tempPresent: true,
    tempProven: true,
    tempName: "v14c",
  });
  assert.equal(d.action, "PROMOTE_TEMP");
}
{
  const d = decideConstraintAction("forward", {
    canonicalProven: false,
    canonicalValidated: true,
    tempPresent: true,
    tempProven: false,
    tempName: "v14c",
  });
  assert.equal(d.action, "STOP");
}

// Unvalidated but proven canonical → validate
{
  const d = decideConstraintAction("forward", {
    canonicalProven: true,
    canonicalValidated: false,
    tempPresent: false,
  });
  assert.equal(d.action, "VALIDATE_CANONICAL");
}

// Validated required for complete match helper
{
  const m = constraintCompleteMatch(exactForward, "forward", {
    requireValidated: true,
    validated: false,
  });
  assert.equal(m.equal, false);
}

// ---------------------------------------------------------------------------
// R4 — cross-mode reference-name / non-CHECK collision scenarios
// ---------------------------------------------------------------------------

{
  const d = decideNameCollision({ forwardRefExists: true });
  assert.equal(d.action, "STOP", "pre-existing forward reference name must STOP");
  assert.match(d.reason, /ref_fwd|already exists/i);
}
{
  const d = decideNameCollision({ rollbackRefExists: true });
  assert.equal(d.action, "STOP", "pre-existing rollback reference name must STOP");
  assert.match(d.reason, /ref_rb|already exists/i);
}
{
  // Cross-mode: ref_rb exists before forward
  const d = decideNameCollision({
    rollbackRefExists: true,
    forwardRefExists: false,
    mode: "forward",
  });
  assert.equal(d.action, "STOP", "ref_rb before forward must STOP");
  assert.match(d.reason, new RegExp(ROLLBACK_REF_NAME.replace(/_/g, "_")));
}
{
  // Cross-mode: ref_fwd exists before rollback
  const d = decideNameCollision({
    forwardRefExists: true,
    rollbackRefExists: false,
    mode: "rollback",
  });
  assert.equal(d.action, "STOP", "ref_fwd before rollback must STOP");
  assert.match(d.reason, new RegExp(FORWARD_REF_NAME.replace(/_/g, "_")));
}
{
  // Either reference exists before post-verify
  assert.equal(
    decideNameCollision({
      forwardRefExists: true,
      mode: "post-verify",
    }).action,
    "STOP",
    "ref_fwd before post-verify must STOP"
  );
  assert.equal(
    decideNameCollision({
      rollbackRefExists: true,
      mode: "post-verify",
    }).action,
    "STOP",
    "ref_rb before post-verify must STOP"
  );
}
{
  const d = decideNameCollision({ canonicalContype: "u" });
  assert.equal(d.action, "STOP", "canonical non-CHECK occupant must STOP");
  assert.match(d.reason, /non-CHECK/i);
}
{
  const d = decideNameCollision({ tempContype: "u", mode: "forward" });
  assert.equal(d.action, "STOP", "temporary non-CHECK occupant must STOP");
  assert.match(d.reason, /non-CHECK/i);
}
{
  const d = decideNameCollision({
    forwardRefExists: false,
    rollbackRefExists: false,
    canonicalContype: "c",
    tempContype: null,
  });
  assert.equal(d.action, "CONTINUE", "normal exact proof path must continue");
}
{
  // Normal exact forward/rollback/repeat behavior remains successful
  assert.equal(
    isCompletePredicateProven(exactForward, "forward").proven,
    true,
    "exact forward predicate still proves"
  );
  assert.equal(
    isCompletePredicateProven(exactRollback, "rollback").proven,
    true,
    "exact rollback predicate still proves"
  );
  assert.equal(
    decideConstraintAction("forward", {
      canonicalProven: true,
      canonicalValidated: true,
      tempPresent: false,
    }).action,
    "NOOP",
    "repeat forward remains NOOP"
  );
  assert.equal(
    decideConstraintAction("rollback", {
      canonicalProven: true,
      canonicalValidated: true,
      tempPresent: false,
    }).action,
    "NOOP",
    "repeat rollback remains NOOP"
  );
}

// ---------------------------------------------------------------------------
// SQL pack posture — conbin proof, fail-closed, exception on post-verify
// ---------------------------------------------------------------------------

assert.match(preflight, /READ-ONLY/i);
assert.match(preflight, /schema guard/i);
assert.match(preflight, /pg_get_expr\s*\(\s*con\.conbin/i, "preflight must read conbin expr");
assert.match(
  preflight,
  /actual_expr is not distinct from expected_expr/i,
  "preflight must require exact predicate expr"
);
assert.doesNotMatch(preflight, /constraint_def ilike '%whatsapp_verified%'/i);
assert.doesNotMatch(
  preflight,
  /^\s*(alter|create|drop|update|insert|delete)\b/im,
  "preflight must not contain DDL/DML statements"
);

assert.match(forward, /conbin/i, "forward must use conbin proof");
assert.match(forward, /ref_fwd|check_ref_fwd/i, "forward must install reference constraint");
assert.match(
  forward,
  /c\.conbin = r\.conbin|c\.conbin is not null and c\.conbin = r\.conbin/i,
  "forward must compare conbin to reference"
);
assert.match(
  forward,
  /reference constraint name % already exists/i,
  "forward must STOP on pre-existing reference name"
);
assert.match(
  forward,
  /whatsapp_contacts_name_source_check_ref_rb/,
  "forward must declare/check rollback reference name (cross-mode)"
);
assert.match(
  forward,
  /rollback_ref_name/,
  "forward must guard rollback_ref_name collision"
);
assert.match(
  forward,
  /canonical name % is occupied by a non-CHECK constraint/i,
  "forward must STOP on canonical non-CHECK collision"
);
assert.match(
  forward,
  /temporary name % is occupied by a non-CHECK constraint/i,
  "forward must STOP on temporary non-CHECK collision"
);
assert.match(forward, /session_ref_oid/i, "forward must track session-created reference oid");
assert.match(
  forward,
  /conbin does not equal the exact SYNC-14C-A forward reference/i,
  "forward must STOP on mismatched temporary"
);
assert.match(forward, /action := 'REBUILD'/i);
assert.match(forward, /action := 'NOOP'/i);
assert.match(forward, /action := 'PROMOTE_TEMP'/i);
assert.match(forward, /Schema guard/i);
assert.doesNotMatch(
  forward,
  /Drop any leftover pack-owned reference artifact/i,
  "forward must not document silent drop of pre-existing refs"
);
assert.doesNotMatch(
  forward,
  /if exists \(\s*select 1 from pg_constraint\s+where conrelid = table_oid and conname = ref_name\s*\) then\s*execute format/i,
  "forward must not DROP pre-existing reference via execute format"
);
assert.doesNotMatch(forward, /is not distinct from expected/i, "forward must not use set-only equality");
assert.doesNotMatch(forward, /old_def ilike /i);
assert.doesNotMatch(forward, /\benable row level security\b/i);
assert.doesNotMatch(forward, /\bcreate policy\b/i);
assert.doesNotMatch(forward, /^\s*update\s+public\.whatsapp_contacts\b/im);

assert.match(rollback, /conbin/i, "rollback must use conbin proof");
assert.match(rollback, /ref_rb|check_ref_rb/i, "rollback must install reference constraint");
assert.match(
  rollback,
  /reference constraint name % already exists/i,
  "rollback must STOP on pre-existing reference name"
);
assert.match(
  rollback,
  /forward_ref_name/,
  "rollback must guard forward_ref_name collision (cross-mode)"
);
assert.match(
  rollback,
  /whatsapp_contacts_name_source_check_ref_fwd/,
  "rollback must check forward reference name"
);
assert.match(
  rollback,
  /canonical name % is occupied by a non-CHECK constraint/i,
  "rollback must STOP on canonical non-CHECK collision"
);
assert.match(
  rollback,
  /temporary name % is occupied by a non-CHECK constraint/i,
  "rollback must STOP on temporary non-CHECK collision"
);
assert.match(rollback, /session_ref_oid/i, "rollback must track session-created reference oid");
assert.match(
  rollback,
  /conbin does not equal the exact pre-expansion reference/i,
  "rollback must STOP on mismatched temporary"
);
assert.match(rollback, /action := 'REBUILD'/i);
assert.match(rollback, /action := 'NOOP'/i);
assert.match(rollback, /treated as whatsapp_legacy/i);
assert.doesNotMatch(rollback, /treated as manual by the app/i);
assert.doesNotMatch(rollback, /is not distinct from expected/i);
assert.doesNotMatch(
  rollback,
  /if exists \(\s*select 1 from pg_constraint\s+where conrelid = table_oid and conname = (ref_name|forward_ref_name)\s*\) then\s*execute format/i,
  "rollback must not DROP pre-existing reference via execute format"
);

assert.match(postVerify, /conbin/i, "post-verify must use conbin proof");
assert.match(
  postVerify,
  /raise exception 'STOP: SYNC-14C-A post-verify failed/i,
  "post-verify must RAISE EXCEPTION on failure"
);
assert.match(
  postVerify,
  /reference constraint name % already exists/i,
  "post-verify must STOP on pre-existing reference name"
);
assert.match(
  postVerify,
  /rollback_ref_name/,
  "post-verify must guard rollback_ref_name (either reference)"
);
assert.match(
  postVerify,
  /whatsapp_contacts_name_source_check_ref_rb/,
  "post-verify must check rollback reference name"
);
assert.match(
  postVerify,
  /whatsapp_contacts_name_source_check_ref_fwd/,
  "post-verify must check forward reference name"
);
assert.match(
  postVerify,
  /canonical name % is occupied by a non-CHECK constraint/i,
  "post-verify must STOP on canonical non-CHECK"
);
assert.match(postVerify, /session_ref_oid/i, "post-verify must track session-created reference oid");
assert.match(postVerify, /PASS: SYNC-14C-A post-verify/i);
assert.match(postVerify, /relrowsecurity|rls/i);
assert.doesNotMatch(
  postVerify,
  /raise notice 'STOP: SYNC-14C-A post-verify failed/i,
  "post-verify must not NOTICE-only on failure"
);
assert.doesNotMatch(
  postVerify,
  /if exists \(\s*select 1 from pg_constraint\s+where conrelid = table_oid and conname = ref_name\s*\) then\s*execute format/i,
  "post-verify must not DROP pre-existing reference via execute format"
);

assert.match(backfill, /DISABLED/i);
assert.doesNotMatch(backfill, /^\s*update\s+public\.whatsapp_contacts\b/im);

assert.match(sequencing, /preflight/i);
assert.match(sequencing, /backup|checkpoint/i);
assert.match(sequencing, /forward migration/i);
assert.match(sequencing, /post-verify|verification/i);
assert.match(sequencing, /code merge/i);
assert.match(sequencing, /deployment/i);
assert.match(sequencing, /smoke test/i);
assert.match(sequencing, /rollback/i);
assert.match(sequencing, /conbin/i);
assert.match(sequencing, /RAISE EXCEPTION|R4/i);
assert.match(sequencing, /Cross-mode|either/i);
assert.match(sequencing, /already exists/i);
assert.match(sequencing, /non-CHECK/i);

console.log("SYNC-14C-A-R4 name_source migration pack static validation passed.");
