#!/usr/bin/env node
// Typechecks server.ts (which `npm run typecheck` does NOT include: tsconfig.json lists src/ and server/ only) and compares the result with the
// recorded baseline of errors that already existed when the check was added (scripts/ci/server-typecheck-baseline.txt).
//   - a NEW error (one the baseline does not list, counted per message) fails the check;
//   - an error that was fixed is reported, and does not fail (refresh the baseline with --update so it cannot come back unnoticed);
//   - the baseline is not an approval: every line in it is a real type error in the server. The count is printed on every run.
// Line and column numbers are dropped from the comparison so unrelated edits to server.ts do not move errors in and out of the baseline.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baselinePath = path.join(root, "scripts/ci/server-typecheck-baseline.txt");
const update = process.argv.includes("--update");

const run = spawnSync("npx", ["tsc", "-p", "tsconfig.server.json", "--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const out = `${run.stdout || ""}${run.stderr || ""}`;
if (run.error) { console.error(run.error.message); process.exit(2); }
const errors = out.split("\n").filter((l) => /error TS\d+:/.test(l)).map((l) => l.replace(/\(\d+,\d+\)/, "").trim()).sort();
const count = (list) => list.reduce((m, e) => m.set(e, (m.get(e) || 0) + 1), new Map());

if (update) {
  fs.writeFileSync(baselinePath, errors.join("\n") + "\n");
  console.log(`Baseline written: ${errors.length} existing server type error(s).`);
  process.exit(0);
}
const baseline = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, "utf8").split("\n").filter(Boolean) : [];
const now = count(errors), was = count(baseline);
const added = [], fixed = [];
for (const [e, n] of now) { const d = n - (was.get(e) || 0); if (d > 0) added.push([e, d]); }
for (const [e, n] of was) { const d = n - (now.get(e) || 0); if (d > 0) fixed.push([e, d]); }
console.log(`server.ts typecheck: ${errors.length} error(s) now, ${baseline.length} in the recorded baseline.`);
if (fixed.length) { console.log(`Fixed since the baseline (${fixed.reduce((s, [, d]) => s + d, 0)}); run with --update to record it:`); for (const [e, d] of fixed) console.log(`  - ${d}x ${e}`); }
if (added.length) { console.error(`NEW type error(s) not in the baseline (${added.reduce((s, [, d]) => s + d, 0)}):`); for (const [e, d] of added) console.error(`  + ${d}x ${e}`); console.error(out.split("\n").filter((l) => /error TS\d+:/.test(l)).join("\n")); process.exit(1); }
console.log("No new server type errors.");
