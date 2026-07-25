/**
 * Static validation for SYNC-14C-A name_source migration release pack.
 * Run: node scripts/validate-sync14c-name-source-migration-pack.mjs
 * Does not connect to a database and does not apply SQL.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files = {
  preflight: "scripts/sync14c/sync14c-name-source-preflight.sql",
  forward: "scripts/sync14c/sync14c-name-source-forward-migration.sql",
  postVerify: "scripts/sync14c/sync14c-name-source-post-verify.sql",
  rollback: "scripts/sync14c/sync14c-name-source-rollback.sql",
  backfill: "scripts/sync14c/sync14c-name-source-backfill-optional-DISABLED.sql",
  sequencing:
    "docs/deployment/sync14c-contact-identity-name-source-release-sequencing.md",
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

// Preflight: read-only posture
assert.match(preflight, /READ-ONLY/i, "preflight must declare read-only");
assert.match(preflight, /NO DDL/i, "preflight must forbid DDL");
assert.match(preflight, /name_source/i, "preflight must inspect name_source");
assert.match(preflight, /phone-like|phone_like|profile_name/i, "preflight must cover phone-like names");
assert.match(preflight, /duplicate/i, "preflight must cover duplicate risks");
assert.match(preflight, /PASS: SYNC-14C-A preflight/i, "preflight missing PASS notice");
assert.doesNotMatch(
  preflight,
  /^\s*(alter|create|drop|update|insert|delete)\b/im,
  "preflight must not contain DDL/DML statements"
);

// Forward: additive allow-list + safe replace sequence
assert.match(forward, /whatsapp_verified/, "forward must allow whatsapp_verified");
assert.match(forward, /whatsapp_legacy/, "forward must allow whatsapp_legacy");
assert.match(forward, /whatsapp_saved/, "forward must preserve whatsapp_saved");
assert.match(forward, /\bmanual\b/, "forward must preserve manual");
assert.match(forward, /not valid/i, "forward should add constraint NOT VALID first");
assert.match(forward, /validate constraint/i, "forward must VALIDATE constraint");
assert.match(
  forward,
  /whatsapp_contacts_name_source_check/,
  "forward must target canonical constraint name"
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
assert.match(postVerify, /relrowsecurity|rls/i, "post-verify must check RLS");
assert.doesNotMatch(
  postVerify,
  /^\s*(alter|create|drop|update|insert|delete)\b/im,
  "post-verify must not contain DDL/DML statements"
);

// Rollback limitations
assert.match(rollback, /LIMITATIONS/i, "rollback must document limitations");
assert.match(
  rollback,
  /whatsapp_verified|whatsapp_legacy/,
  "rollback must mention expanded values"
);
assert.match(rollback, /STOP:/i, "rollback must fail closed when expanded values exist");

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

console.log("SYNC-14C-A name_source migration pack static validation passed.");
