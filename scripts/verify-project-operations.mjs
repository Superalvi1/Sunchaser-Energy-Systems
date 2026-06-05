#!/usr/bin/env node
/**
 * Verify Project Operations Dashboard data against live Supabase.
 * Usage: node scripts/verify-project-operations.mjs
 */
import "dotenv/config";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(resolve(__dir, "../.env.local"))) {
  config({ path: resolve(__dir, "../.env.local") });
}

const API = (process.env.API_BASE || process.env.VITE_API_BASE || "http://localhost:3000").replace(/\/$/, "");
const STAFF_USER = process.env.VERIFY_STAFF_USER || "allauddin";
const STAFF_PASS = process.env.VERIFY_STAFF_PASS || "123";

async function loginStaff() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: STAFF_USER, password: STAFF_PASS }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Staff login failed");
  return data.user;
}

function hdr(staff) {
  return {
    "x-sunchaser-user-id": staff.id,
    "x-sunchaser-username": staff.username,
    "x-sunchaser-role": staff.role || "",
  };
}

async function main() {
  console.log(`API: ${API}`);
  const staff = await loginStaff();
  console.log(`Logged in as ${staff.username} (${staff.role})`);

  const res = await fetch(`${API}/api/admin/operations/dashboard`, { headers: hdr(staff) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

  console.log("\n=== KPI Summary ===");
  console.log(JSON.stringify(data.summary, null, 2));

  console.log("\n=== CEO Summary ===");
  console.log(JSON.stringify(data.ceoSummary, null, 2));

  console.log("\n=== Pipeline Stage Counts ===");
  for (const [k, v] of Object.entries(data.pipelineCounts || {})) {
    if (v > 0) console.log(`  ${k}: ${v}`);
  }

  console.log("\n=== Kanban Columns ===");
  for (const [col, items] of Object.entries(data.kanban || {})) {
    console.log(`  ${col}: ${items.length}`);
  }

  console.log("\n=== Top Delays (longest first) ===");
  const delays = (data.delays || []).slice(0, 10);
  for (const d of delays) {
    console.log(
      `  ${d.customerName} | ${d.pipelineStage} | ${d.daysInStage}d | ${d.assignedTeam} | ${d.delayTone}`
    );
  }

  console.log("\n=== Team Performance ===");
  for (const t of data.teamPerformance || []) {
    console.log(
      `  ${t.team}: assigned=${t.assigned} completed=${t.completed} avgDays=${t.avgCompletionDays ?? "—"}`
    );
  }

  console.log(`\nTotal projects: ${(data.projects || []).length}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
