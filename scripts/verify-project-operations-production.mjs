#!/usr/bin/env node
/**
 * Compute Project Operations KPIs from production project-deliveries API
 * (works before /api/admin/operations/dashboard is deployed).
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

const API = (
  process.env.API_BASE ||
  process.env.VITE_API_BASE ||
  "https://sunchaser-energy-systems.onrender.com"
).replace(/\/$/, "");

const PIPELINE = [
  "lead_won",
  "quotation_approved",
  "advance_received",
  "site_survey",
  "material_ordered",
  "installation_scheduled",
  "installation_completed",
  "inspection",
  "net_metering_submitted",
  "net_metering_approved",
  "completed",
];

function daysSince(iso) {
  if (!iso) return 0;
  const then = new Date(String(iso).slice(0, 10));
  const now = new Date();
  return Math.max(0, Math.floor((now - then) / 86400000));
}

function delayTone(days) {
  if (days <= 7) return "green";
  if (days <= 14) return "amber";
  return "red";
}

function kanbanColumn(d) {
  if (d.deliveryStatus === "Handover Completed" || d.completionStage === "Completed") return "completed";
  if (d.deliveryStatus === "Installation Completed") return "net_metering";
  if (
    ["Installation Scheduled", "Installation In Progress", "Installation Completed"].includes(d.deliveryStatus)
  )
    return "installation";
  if (["Material Ordered", "Material Delivered"].includes(d.deliveryStatus)) return "procurement";
  return "survey";
}

function pipelineStage(d) {
  if (d.deliveryStatus === "Handover Completed" || d.completionStage === "Completed") return "completed";
  if (d.deliveryStatus === "Installation Completed") return "installation_completed";
  if (["Installation Scheduled", "Installation In Progress"].includes(d.deliveryStatus)) return "installation_scheduled";
  if (d.deliveryStatus === "Material Ordered") return "material_ordered";
  if (d.deliveryStatus === "Material Delivered" || d.completionStage === "Survey") return "site_survey";
  if (d.deliveryStatus === "Order Confirmed") return d.quotationId ? "advance_received" : "quotation_approved";
  return "lead_won";
}

async function loginStaff() {
  const res = await fetch(`${API}/api/auth/login`, {
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
    "x-sunchaser-user-id": staff.id,
    "x-sunchaser-username": staff.username,
    "x-sunchaser-role": staff.role || "",
  };
}

async function main() {
  const staff = await loginStaff();
  const res = await fetch(`${API}/api/admin/project-deliveries`, { headers: hdr(staff) });
  const deliveries = await res.json();
  if (!res.ok) throw new Error(deliveries.error || `HTTP ${res.status}`);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const cards = deliveries.map((d) => {
    const col = kanbanColumn(d);
    const days = daysSince(d.updatedAt);
    const completed = col === "completed";
    const overdue =
      !completed &&
      ((d.expectedInstallationDate &&
        String(d.expectedInstallationDate).slice(0, 10) < now.toISOString().slice(0, 10)) ||
        days >= 15);
    return {
      ...d,
      kanbanColumn: col,
      pipelineStage: pipelineStage(d),
      daysInStage: days,
      delayTone: delayTone(days),
      isOverdue: overdue,
      completedThisMonth: completed && String(d.updatedAt || "").slice(0, 10) >= monthStart,
    };
  });

  const inProgress = cards.filter((c) => c.kanbanColumn !== "completed");
  const summary = {
    projectsInProgress: inProgress.length,
    waitingSurvey: cards.filter((c) => c.kanbanColumn === "survey").length,
    waitingMaterial: cards.filter((c) => c.kanbanColumn === "procurement").length,
    waitingInstallation: cards.filter((c) => c.kanbanColumn === "installation").length,
    waitingNetMetering: cards.filter((c) => c.kanbanColumn === "net_metering").length,
    completedThisMonth: cards.filter((c) => c.completedThisMonth).length,
    overdueProjects: cards.filter((c) => c.isOverdue).length,
  };

  const pipelineCounts = Object.fromEntries(PIPELINE.map((k) => [k, 0]));
  for (const c of cards) pipelineCounts[c.pipelineStage]++;

  const kanban = { survey: 0, procurement: 0, installation: 0, net_metering: 0, completed: 0 };
  for (const c of cards) kanban[c.kanbanColumn]++;

  const delays = [...inProgress].sort((a, b) => b.daysInStage - a.daysInStage);

  console.log(`Production deliveries: ${cards.length}`);
  console.log("\n=== KPI Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\n=== Pipeline Stage Counts ===");
  for (const k of PIPELINE) {
    if (pipelineCounts[k] > 0) console.log(`  ${k}: ${pipelineCounts[k]}`);
  }
  console.log("\n=== Kanban ===");
  for (const [k, v] of Object.entries(kanban)) console.log(`  ${k}: ${v}`);
  console.log("\n=== Delays (longest first) ===");
  for (const d of delays.slice(0, 10)) {
    console.log(
      `  ${d.projectTitle} | ${d.pipelineStage} | ${d.daysInStage}d | ${d.delayTone} | ${d.deliveryStatus}`
    );
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
