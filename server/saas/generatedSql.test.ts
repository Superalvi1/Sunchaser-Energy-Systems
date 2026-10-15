import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const run = (script: string) => execFileSync("node", [script, "--check"], { cwd: root, encoding: "utf8" });

test("the committed foundation SQL is exactly what the classification generates", () => {
  assert.match(run("scripts/saas/generate-phase2-sql.mjs"), /up to date/);
});

test("the committed ownership SQL and its rollback are exactly what the release scripts generate", () => {
  assert.match(run("scripts/saas/generate-phase2b-sql.mjs"), /up to date/);
});

test("the ownership rollback restores the released function bodies byte for byte", () => {
  const rollback = readFileSync(join(root, "scripts/saas/phase2b-ownership-rollback.sql"), "utf8");
  const pay = readFileSync(join(root, "scripts/invoice-payments-integrity.sql"), "utf8");
  const save = readFileSync(join(root, "scripts/invoice-save-atomic.sql"), "utf8");
  const body = (src: string, name: string) => src.match(new RegExp(`create or replace function public\\.${name}\\(.*?\\n(?:end \\$\\$;|\\$\\$;)`, "s"))![0];
  for (const [src, name] of [[pay, "invoice_payments_before_insert"], [pay, "invoice_payments_before_update"], [save, "invoice_save_atomic"]] as const) {
    assert.ok(rollback.includes(body(src, name)), `rollback does not contain the released ${name}`);
  }
});

test("the migration manifest lists real files, unique ids, and dependencies that come first", () => {
  const manifest = JSON.parse(readFileSync(join(root, "scripts/migrations/manifest.json"), "utf8")) as { migrations: Array<{ id: string; file: string; rollback: string; requires: string[]; probe: string }> };
  const seen = new Set<string>();
  for (const m of manifest.migrations) {
    assert.ok(!seen.has(m.id), `duplicate id ${m.id}`);
    for (const r of m.requires) assert.ok(seen.has(r), `${m.id} requires ${r}, which must be listed before it`);
    for (const f of [m.file, m.rollback]) assert.ok(createHash("sha256").update(readFileSync(join(root, f))).digest("hex").length === 64, `${f} unreadable`);
    assert.ok(m.probe.trim().toLowerCase().startsWith("select"), `${m.id} needs a select probe`);
    seen.add(m.id);
  }
  assert.deepEqual(manifest.migrations.map((m) => m.id).slice(0, 4), ["r1-smart-quote-versions", "r2-session-revocation", "r3-invoice-payments-integrity", "r4-invoice-save-atomic"]);
});

test("no tenant migration or test script mentions the recovery schema (they cannot read or restore the cleared accounts records)", () => {
  for (const f of ["scripts/saas/phase2-company-foundation.sql", "scripts/saas/phase2b-ownership.sql", "scripts/saas/phase2c-document-numbering.sql", "scripts/migrations/run.mjs", "scripts/migrations/manifest.json"]) {
    assert.ok(!/crm_recovery/i.test(readFileSync(join(root, f), "utf8")), `${f} mentions crm_recovery`);
  }
});
