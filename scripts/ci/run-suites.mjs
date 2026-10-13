// Runs every suite in scripts/ci/suites.json independently: one failure never stops the others.
// Usage: node scripts/ci/run-suites.mjs [--only=test:a,test:b] [--timeout=600]
// Exit code 1 if any required suite fails, times out, or is silently skipped/blocked.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const cfgPath = (process.argv.find((a) => a.startsWith("--config=")) || "").split("=")[1] || path.join(root, "scripts/ci/suites.json");
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] ?? d;
const only = arg("only", "") ? arg("only", "").split(",") : null;
const group = arg("group", "default"); // default = required + tracked; docker = the Docker/Postgres suites
const timeoutMs = Number(arg("timeout", "600")) * 1000;
const outDir = path.resolve(root, process.env.CI_REPORT_DIR || (group === "docker" ? "ci-report-docker" : "ci-report"));
fs.mkdirSync(outDir, { recursive: true });

function run(script) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn("npm", ["run", "-s", script], { cwd: root, env: { ...process.env, CI: "true" }, detached: true });
    let out = "";
    const take = (d) => { out += d; if (out.length > 4_000_000) out = out.slice(-2_000_000); };
    child.stdout.on("data", take); child.stderr.on("data", take);
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} out += "\n[runner] TIMEOUT"; }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - t0, timedOut: out.endsWith("[runner] TIMEOUT") }); });
  });
}

// A suite that exits 0 but says it did not run its real checks must not be counted as a pass.
const SKIP_MARKERS = [/\bSKIP\b[^\n]*(Docker|credential|database|unavailable)/i, /\bBLOCKED\b/, /# SKIP\b/, /^# skipped [1-9]/m, /\bPostgres not ready\b/i];
function classify(r) {
  if (r.timedOut) return "timeout";
  if (r.code !== 0) return "fail";
  if (SKIP_MARKERS.some((re) => re.test(r.out))) return "skipped";
  return "pass";
}

const jobs = (group === "docker"
  ? (cfg.docker || []).map((s) => ({ ...s, kind: s.tracked ? "tracked" : "required" })) // in the Docker job nothing may be skipped
  : [
      ...cfg.required.map((s) => ({ ...s, kind: "required" })),
      ...cfg.tracked.map((s) => ({ ...s, kind: "tracked" })),
    ]
).filter((j) => !only || only.includes(j.script));

// Docker on a shared runner sometimes fails to publish a container's host port ("failed to set up container networking ... driver failed
// programming external connectivity") before a suite has run a single check; two CI runs of PR 113 (17 and 19) failed that way,
// in different suites each time, on the PostgreSQL 16 job only. That is infrastructure, not a defect, so such a failure is retried (at most twice),
// loudly: the first attempt's log is kept next to the final one and the summary names the retry. Any other failure, and a failure that repeats
// beyond the retries, fails the suite exactly as before.
const DOCKER_INFRA = /failed to set up container networking|driver failed programming external connectivity/i;
const MAX_INFRA_RETRIES = 2;

const results = [];
for (const j of jobs) {
  process.stdout.write(`▶ ${j.script} (${j.kind}) … `);
  let r = await run(j.script);
  let retries = 0;
  const base = j.script.replace(/[^\w.-]/g, "_");
  while (r.code !== 0 && !r.timedOut && DOCKER_INFRA.test(r.out) && retries < MAX_INFRA_RETRIES) {
    retries++;
    fs.writeFileSync(path.join(outDir, `${base}.attempt${retries}.log`), r.out);
    console.log(`FAIL (Docker networking error, infrastructure) - retrying (${retries}/${MAX_INFRA_RETRIES})`);
    process.stdout.write(`▶ ${j.script} (${j.kind}) retry ${retries} … `);
    r = await run(j.script);
  }
  const status = classify(r);
  fs.writeFileSync(path.join(outDir, `${base}.log`), r.out);
  results.push({ script: j.script, kind: j.kind, status, seconds: Math.round(r.ms / 1000), area: j.area, reason: j.reason, retries });
  console.log(`${status.toUpperCase()} (${Math.round(r.ms / 1000)}s)`);
  if (status !== "pass") console.log(r.out.split("\n").filter(Boolean).slice(-40).map((l) => "    " + l.slice(0, 200)).join("\n"));
}

const bad = results.filter((r) => r.kind === "required" && r.status !== "pass");
const promoted = results.filter((r) => r.kind === "tracked" && r.status === "pass");
const lines = [
  "## Test suites",
  "",
  "| Suite | Kind | Result | Seconds | Note |",
  "|---|---|---|---|---|",
  ...results.map((r) => `| \`${r.script}\` | ${r.kind} | ${r.status === "pass" ? "✅ pass" : r.status === "skipped" ? "⚠️ SKIPPED (not verified)" : `❌ ${r.status}`} | ${r.seconds} | ${r.kind === "tracked" ? r.reason || "" : r.area || ""}${r.retries ? ` **(re-run ${r.retries}× after a Docker networking error on the runner; first attempt log kept)**` : ""} |`),
  "",
  `Required: ${results.filter((r) => r.kind === "required" && r.status === "pass").length}/${results.filter((r) => r.kind === "required").length} passed. ` +
    `Tracked (not blocking, still reported): ${results.filter((r) => r.kind === "tracked").length}, of which ${results.filter((r) => r.kind === "tracked" && r.status !== "pass").length} not passing.`,
  ...(promoted.length ? ["", `Tracked suites now passing, consider promoting to required: ${promoted.map((r) => r.script).join(", ")}`] : []),
  ...(bad.length ? ["", `**Failing required suites:** ${bad.map((r) => r.script).join(", ")}`] : []),
];
fs.writeFileSync(path.join(outDir, "summary.md"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(results, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
console.log("\n" + lines.join("\n"));
process.exit(bad.length ? 1 : 0);
