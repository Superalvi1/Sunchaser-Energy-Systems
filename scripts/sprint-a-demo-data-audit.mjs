/**
 * Sprint A — PART 1 read-only demo data audit (no writes).
 * Usage: node scripts/sprint-a-demo-data-audit.mjs
 * Output: scripts/sprint-a-demo-data-audit-report.json
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const BASE = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

const PATTERNS = [
  { key: "Springfield", re: /springfield/i },
  { key: "Sarah Connor", re: /sarah connor/i },
  { key: "Bob Surveyor", re: /bob surveyor/i },
  { key: "Dave Installer", re: /dave installer/i },
  { key: "Field Technician", re: /field technician/i },
  { key: "asdsa", re: /asdsa/i },
  { key: "Phase13 Verify", re: /phase13 verify/i },
  { key: "verify.local", re: /verify\.local/i },
  { key: "invite-*@verify.local", re: /invite-[a-z0-9_-]+@verify\.local/i },
];

function matches(value) {
  const s = String(value ?? "");
  if (!s) return [];
  return PATTERNS.filter((p) => p.re.test(s)).map((p) => p.key);
}

function scanObject(table, id, obj, prefix = "") {
  const hits = [];
  if (!obj || typeof obj !== "object") return hits;
  for (const [field, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${field}` : field;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      hits.push(...scanObject(table, id, value, path));
      continue;
    }
    const vals = Array.isArray(value) ? value : [value];
    for (const v of vals) {
      const pats = matches(v);
      for (const p of pats) {
        hits.push({
          table,
          recordId: id,
          field: path,
          value: String(v).slice(0, 200),
          pattern: p,
          recommendedAction: recommend(table, field, p, v),
        });
      }
    }
  }
  return hits;
}

function recommend(table, field, pattern, value) {
  if (pattern === "verify.local" || pattern === "invite-*@verify.local") {
    if (table === "users") return "Delete test portal user via User Management (after deploy)";
    if (table === "leads" || table === "customers") return "Soft-delete or archive test lead/customer";
    return "Review — likely verification artifact; safe to remove if no production value";
  }
  if (pattern === "Springfield" && table === "leads") {
    return "Update lead location to real city or empty (UI shows Location not specified)";
  }
  if (pattern === "Sarah Connor" && table === "users") {
    return "Delete via Admin → User Management → Cleanup (demo seed user)";
  }
  if (pattern === "Sarah Connor" && (field.includes("assigned") || field.includes("bdm"))) {
    return "Reassign to real advisor or leave empty (UI shows Unassigned)";
  }
  if (["Bob Surveyor", "Dave Installer", "Field Technician"].includes(pattern) && table === "users") {
    return "Delete via Admin → User Management → Cleanup";
  }
  if (pattern === "Sarah Connor" || pattern === "Bob Surveyor") {
    if (table === "activityLogs" || table === "whatsAppLogs") return "Preserve — historical audit text";
    if (table === "websiteContent" || table === "code/seed") return "Replace seed content when editing marketing copy";
  }
  if (table === "code/seed" || table === "database.json") {
    return "Update seed/fallback in code — do not auto-delete from repo without review";
  }
  return "Review manually";
}

async function loginStaff() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: process.env.VERIFY_STAFF_USER || "allauddin",
      password: process.env.VERIFY_STAFF_PASS || "123",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Staff login failed");
  return data.user;
}

function hdr(staff) {
  return {
    "Content-Type": "application/json",
    "X-Sunchaser-User-Id": staff.id,
    "X-Sunchaser-Username": staff.username,
    "X-Sunchaser-Role": staff.role || "Super Admin",
  };
}

async function fetchJson(path, staff) {
  const res = await fetch(`${BASE}${path}`, { headers: hdr(staff) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function scanLocalJsonFile(relPath, tableName) {
  const hits = [];
  try {
    const raw = readFileSync(resolve(ROOT, relPath), "utf8");
    const data = JSON.parse(raw);
    const walk = (arr, idField = "id") => {
      if (!Array.isArray(arr)) return;
      for (const row of arr) {
        hits.push(...scanObject(tableName, row[idField] || row.id || "?", row));
      }
    };
    walk(data.users);
    walk(data.leads);
    walk(data.customers);
    walk(data.quotations);
    walk(data.invoices);
    walk(data.activityLogs);
    walk(data.whatsAppLogs);
    if (data.settings) hits.push(...scanObject("settings", "settings", data.settings));
    if (data.websiteContent) hits.push(...scanObject("websiteContent", "website", data.websiteContent));
    if (data.quotePdfSettings) walk(data.quotePdfSettings);
    if (data.quoteTemplates) walk(data.quoteTemplates);
  } catch {
    /* skip */
  }
  return hits.map((h) => ({ ...h, table: `database.json/${h.table}`, source: relPath }));
}

function scanCodeFallbacks() {
  const files = [
    "server.ts",
    "dbManager.ts",
    "src/components/ManualAdminControl.tsx",
    "src/components/CustomerPortal.tsx",
    "src/components/AIAssistant.tsx",
    "database.json",
  ];
  const hits = [];
  for (const rel of files) {
    try {
      const content = readFileSync(resolve(ROOT, rel), "utf8");
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        for (const p of PATTERNS) {
          if (p.re.test(line) && !line.trim().startsWith("//")) {
            hits.push({
              table: "code/seed",
              recordId: rel,
              field: `line ${i + 1}`,
              value: line.trim().slice(0, 200),
              pattern: p.key,
              recommendedAction: recommend("code/seed", rel, p.key, line),
            });
          }
        }
      });
    } catch {
      /* skip */
    }
  }
  return hits;
}

(async () => {
  console.log(`\n=== Sprint A demo data audit (read-only) @ ${BASE} ===\n`);
  const staff = await loginStaff();
  const findings = [];

  const state = await fetchJson("/api/state", staff);
  if (state.ok) {
    const s = state.json;
    for (const u of s.users || []) findings.push(...scanObject("users", u.id, u));
    for (const l of s.leads || []) findings.push(...scanObject("leads", l.id, l));
    for (const q of s.quotations || []) findings.push(...scanObject("quotations", q.id, q));
    if (s.settings) findings.push(...scanObject("settings", "app", s.settings));
    if (s.websiteContent) findings.push(...scanObject("websiteContent", "site", s.websiteContent));
    for (const log of s.activityLogs || [])
      findings.push(...scanObject("activityLogs", log.id, log));
    for (const w of s.whatsAppLogs || [])
      findings.push(...scanObject("whatsAppLogs", w.id, w));
  } else {
    findings.push({
      table: "api/state",
      recordId: "-",
      field: "error",
      value: state.json.error || `HTTP ${state.status}`,
      pattern: "N/A",
      recommendedAction: "Fix API access for full production audit",
    });
  }

  const users = await fetchJson("/api/admin/users", staff);
  if (users.ok) {
    for (const u of users.json.users || []) {
      findings.push(...scanObject("users", u.id, u));
    }
  }

  const demos = await fetchJson("/api/admin/users/demo-seeds", staff);
  if (demos.status === 404) {
    findings.push({
      table: "api",
      recordId: "demo-seeds",
      field: "endpoint",
      value: "Not deployed",
      pattern: "N/A",
      recommendedAction: "Deploy Sprint A user cleanup endpoints",
    });
  } else if (demos.ok) {
    for (const u of demos.json.users || []) {
      findings.push({
        table: "users",
        recordId: u.id,
        field: "demo-seed",
        value: `${u.name} (@${u.username})`,
        pattern: "demo user",
        recommendedAction: "Delete via Admin → User Management → Cleanup",
      });
    }
  }

  const parties = await fetchJson("/api/admin/parties?visibility=all", staff);
  if (parties.ok) {
    for (const p of parties.json.parties || parties.json || []) {
      if (typeof p === "object" && p.partyKey) {
        findings.push(...scanObject("party_ledger", p.partyKey, p));
      }
    }
  }

  findings.push(...scanLocalJsonFile("database.json", "local"));
  findings.push(...scanCodeFallbacks());

  const deduped = [];
  const seen = new Set();
  for (const f of findings) {
    const k = `${f.table}|${f.recordId}|${f.field}|${f.pattern}|${f.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(f);
  }

  const summary = {};
  for (const f of deduped) {
    summary[f.pattern] = (summary[f.pattern] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    readOnly: true,
    totalFindings: deduped.length,
    byPattern: summary,
    findings: deduped.sort((a, b) =>
      `${a.table}${a.pattern}`.localeCompare(`${b.table}${b.pattern}`)
    ),
  };

  const outPath = resolve(__dir, "sprint-a-demo-data-audit-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Findings: ${deduped.length}`);
  console.log("By pattern:", summary);
  console.log(`Report: ${outPath}`);
  console.log("\nSample (first 15):");
  deduped.slice(0, 15).forEach((f) => {
    console.log(`  [${f.pattern}] ${f.table} ${f.recordId} ${f.field} → ${f.recommendedAction}`);
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
