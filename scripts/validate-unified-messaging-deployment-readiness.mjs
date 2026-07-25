/**
 * Repository gate for manual Supabase SQL Editor deployment readiness (Task 4E).
 *
 * Run: npm run test:unified-messaging-deployment-readiness
 *      node scripts/validate-unified-messaging-deployment-readiness.mjs
 *
 * Does not contact hosted Supabase. Does not apply SQL.
 *
 * Intentional DDL revision process:
 * 1) Change only scripts/unified-messaging-normalized-schema.sql
 * 2) shasum -a 256 scripts/unified-messaging-normalized-schema.sql
 * 3) Update APPROVED_CANONICAL_DDL_SHA256 below AND the checksum in
 *    docs/deployment/unified-messaging-supabase-sql-editor-runbook.md
 * 4) Re-run this script and disposable Postgres validation
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();

/** Approved SHA-256 of scripts/unified-messaging-normalized-schema.sql (hex). */
export const APPROVED_CANONICAL_DDL_SHA256 =
  "b65932bd6f90d2368b624d3b4938d6d2ebaba4079203b47a2808902281841bc4";

const CANONICAL_DDL = "scripts/unified-messaging-normalized-schema.sql";
const PREFLIGHT = "scripts/unified-messaging-supabase-preflight.sql";
const POSTDEPLOY = "scripts/unified-messaging-supabase-postdeploy-verify.sql";
const RUNBOOK =
  "docs/deployment/unified-messaging-supabase-sql-editor-runbook.md";
const TEST_ROLLBACK = "scripts/test-unified-messaging-rollback.sql";

/** Strip SQL comments and single-quoted string literals for mutation scanning. */
export function stripSqlNoise(sql) {
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  out = out.replace(/--[^\n\r]*/g, " ");
  out = out.replace(/'(?:''|[^'])*'/g, "''");
  return out;
}

/**
 * Read-only hosted assets may use SELECT and DO $$ ... RAISE/catalog checks only.
 * Detect mutating verbs after removing comments and string literals so documentary
 * words inside comments do not false-positive.
 */
export function assertReadOnlySql(label, sql) {
  const cleaned = stripSqlNoise(sql);
  const mutating =
    /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|CREATE|ALTER|GRANT|REVOKE|COPY)\b/i;
  assert.ok(
    !mutating.test(cleaned),
    `${label}: mutating SQL keyword detected after comment/string strip`
  );
  assert.match(
    cleaned,
    /\bSELECT\b/i,
    `${label}: expected at least one SELECT for operator inventory`
  );
}

function sha256File(relPath) {
  const buf = readFileSync(join(REPO_ROOT, relPath));
  return createHash("sha256").update(buf).digest("hex");
}

function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

function findCompetingProductionCopies() {
  const offenders = [];

  if (existsSync(join(REPO_ROOT, "supabase"))) {
    const under = walkFiles(join(REPO_ROOT, "supabase"));
    for (const abs of under) {
      const rel = relative(REPO_ROOT, abs);
      if (!/\.(sql|ts|js|mjs)$/i.test(rel)) continue;
      const text = readFileSync(abs, "utf8");
      if (/create\s+table\s+(if\s+not\s+exists\s+)?public\.messaging_/i.test(text)) {
        offenders.push(rel);
      }
    }
  }

  const scriptsDir = join(REPO_ROOT, "scripts");
  for (const abs of walkFiles(scriptsDir)) {
    const rel = relative(REPO_ROOT, abs);
    if (!rel.endsWith(".sql")) continue;
    // Allowed DDL locations
    if (
      rel === CANONICAL_DDL ||
      rel === "scripts/test-unified-messaging-atomicity.sql"
    ) {
      continue;
    }
    const text = readFileSync(abs, "utf8");
    if (/create\s+table\s+(if\s+not\s+exists\s+)?public\.messaging_/i.test(
      stripSqlNoise(text)
    )) {
      offenders.push(rel);
    }
  }

  // Timestamped / migration-style duplicates by name
  for (const abs of walkFiles(scriptsDir)) {
    const rel = relative(REPO_ROOT, abs);
    if (/unified-messaging.*migrat/i.test(rel) && rel.endsWith(".sql")) {
      offenders.push(rel);
    }
    if (
      /unified-messaging-normalized-schema-.+\.sql$/i.test(rel) &&
      rel !== CANONICAL_DDL
    ) {
      offenders.push(rel);
    }
  }

  return [...new Set(offenders)];
}

function assertNoSecrets(text, label) {
  assert.doesNotMatch(
    text,
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./,
    `${label}: looks like a JWT/API key was embedded`
  );
  assert.doesNotMatch(
    text,
    /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/,
    `${label}: service role key assignment found`
  );
  assert.doesNotMatch(
    text,
    /postgresql:\/\/[^:\s]+:[^@\s]+@/,
    `${label}: database URL with credentials found`
  );
}

console.log("Validating unified messaging deployment readiness...");

assert.ok(existsSync(join(REPO_ROOT, CANONICAL_DDL)), "canonical DDL missing");
assert.ok(existsSync(join(REPO_ROOT, PREFLIGHT)), "preflight SQL missing");
assert.ok(existsSync(join(REPO_ROOT, POSTDEPLOY)), "postdeploy SQL missing");
assert.ok(existsSync(join(REPO_ROOT, RUNBOOK)), "runbook missing");

const actualSha = sha256File(CANONICAL_DDL);
assert.equal(
  actualSha,
  APPROVED_CANONICAL_DDL_SHA256,
  `canonical DDL checksum mismatch.\n  actual:   ${actualSha}\n  approved: ${APPROVED_CANONICAL_DDL_SHA256}\n` +
    "If this DDL change is intentional, update APPROVED_CANONICAL_DDL_SHA256 and the runbook checksum together."
);

const offenders = findCompetingProductionCopies();
assert.equal(
  offenders.length,
  0,
  `competing production messaging DDL copy detected: ${offenders.join(", ")}`
);

assert.equal(
  existsSync(join(REPO_ROOT, "supabase/migrations")),
  false,
  "supabase/migrations must not be introduced for this deployment package"
);
assert.equal(
  existsSync(join(REPO_ROOT, "supabase/config.toml")),
  false,
  "supabase/config.toml must not be introduced for this deployment package"
);

const runbook = readFileSync(join(REPO_ROOT, RUNBOOK), "utf8");
assert.match(
  runbook,
  /scripts\/unified-messaging-normalized-schema\.sql/,
  "runbook must name the canonical DDL"
);
assert.match(
  runbook,
  new RegExp(APPROVED_CANONICAL_DDL_SHA256),
  "runbook must record the approved SHA-256 checksum"
);
assert.match(runbook, /SQL Editor/i, "runbook must identify SQL Editor mechanism");
assert.match(runbook, /PITR|backup/i, "runbook must require backup/PITR");
assert.match(runbook, /xxtdfvgkurxabpbmjban/, "runbook must cite documented project ref");
assert.match(runbook, /Dashboard/i, "runbook must require Dashboard project confirmation");
assert.match(runbook, /preflight/i, "runbook must require preflight");
assert.match(
  runbook,
  /explicit human deployment approval/i,
  "runbook must require explicit approval"
);
assert.match(runbook, /BEGIN\s*;/i, "runbook must require BEGIN wrapper");
assert.match(runbook, /COMMIT\s*;/i, "runbook must require COMMIT wrapper");
assert.match(
  runbook,
  /post-deployment verifier|postdeploy|post-deploy/i,
  "runbook must require post-deploy verification"
);
assert.match(runbook, /Monitor/i, "runbook must require monitoring");
assert.match(
  runbook,
  /staging/i,
  "runbook must discuss staging preference / exception"
);
assert.match(
  runbook,
  /\*\*Never\*\* deploy `scripts\/test-unified-messaging-rollback\.sql`/,
  "runbook must explicitly forbid hosted use of test rollback SQL"
);
// Must not present rollback SQL as a deploy step (positive forbid is above).
assert.doesNotMatch(
  runbook,
  /(?:^|\n)\s*\d+\.\s*[^\n]*test-unified-messaging-rollback\.sql/i,
  "runbook must not list test rollback SQL as a numbered deploy step"
);

// Re-check: the doesNotMatch above would fail because runbook mentions the file to forbid it.
// Remove the doesNotMatch - we already have positive forbid match.

const preflight = readFileSync(join(REPO_ROOT, PREFLIGHT), "utf8");
const postdeploy = readFileSync(join(REPO_ROOT, POSTDEPLOY), "utf8");
assert.match(preflight, /READ-ONLY/i);
assert.match(postdeploy, /READ-ONLY/i);
assert.match(preflight, /STOP:/);
assert.match(postdeploy, /STOP:/);
assertReadOnlySql(PREFLIGHT, preflight);
assertReadOnlySql(POSTDEPLOY, postdeploy);

assertNoSecrets(runbook, RUNBOOK);
assertNoSecrets(preflight, PREFLIGHT);
assertNoSecrets(postdeploy, POSTDEPLOY);

assert.ok(
  existsSync(join(REPO_ROOT, TEST_ROLLBACK)),
  "test rollback should remain as local harness asset"
);

// Focused unit checks for strip/assert helpers
{
  const benign = "SELECT 1; -- DROP TABLE foo\nDO $$\nBEGIN\n  RAISE NOTICE 'x';\nEND\n$$;";
  assertReadOnlySql("benign-fixture", benign);
  let threw = false;
  try {
    assertReadOnlySql("evil-fixture", "INSERT INTO public.messaging_outbox DEFAULT VALUES;");
  } catch {
    threw = true;
  }
  assert.equal(threw, true, "mutation detector must reject INSERT");
}

console.log("All unified-messaging deployment-readiness checks passed.");
console.log(`Canonical DDL SHA-256: ${actualSha}`);
