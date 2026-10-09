import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const classification = JSON.parse(readFileSync(join(root, "scripts/saas/table-classification.json"), "utf8")) as {
  classes: Record<string, string>;
  tables: Record<string, { class: string; note: string; verify?: string }>;
};

function tablesInTrackedSql(): Set<string> {
  const files = ["supabase-schema.sql", ...readdirSync(join(root, "scripts")).filter((f) => f.endsWith(".sql")).map((f) => `scripts/${f}`)];
  const found = new Set<string>();
  const rx = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  for (const f of files) {
    const sql = readFileSync(join(root, f), "utf8");
    for (const m of sql.matchAll(rx)) found.add(m[1].toLowerCase());
  }
  return found;
}

test("every table in tracked SQL has a tenancy class", () => {
  const missing = [...tablesInTrackedSql()].filter((t) => !classification.tables[t]).sort();
  assert.deepEqual(missing, [], `Classify these tables in scripts/saas/table-classification.json: ${missing.join(", ")}`);
});

test("classification has no stale entries except tables known only from code", () => {
  const sql = tablesInTrackedSql();
  const stale = Object.entries(classification.tables)
    .filter(([name, v]) => !sql.has(name) && !v.verify)
    .map(([name]) => name);
  assert.deepEqual(stale, [], `Remove or mark with "verify": ${stale.join(", ")}`);
});

test("every class used is defined", () => {
  const used = new Set(Object.values(classification.tables).map((t) => t.class));
  for (const c of used) assert.ok(classification.classes[c], `Undefined class ${c}`);
});

test("tables with no tenant access are explicitly Sunchaser-only or dormant", () => {
  const blocked = Object.entries(classification.tables).filter(([, v]) => v.class === "sunchaser_only" || v.class === "dormant");
  assert.ok(blocked.length > 0);
  for (const [name, v] of blocked) assert.ok(v.note.length > 10, `${name} needs a reason`);
});
