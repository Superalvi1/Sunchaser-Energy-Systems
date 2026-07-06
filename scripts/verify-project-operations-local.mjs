#!/usr/bin/env node
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(resolve(__dir, "../.env.local"))) {
  config({ path: resolve(__dir, "../.env.local") });
}

const require = createRequire(import.meta.url);

async function main() {
  const { register } = await import("tsx/esm/api");
  register();

  const { fetchProjectOperationsDashboard } = await import("../projectOperationsDb.ts");
  const { getSupabase, isSupabaseActive } = await import("../dbManager.ts");

  console.log("Supabase active:", isSupabaseActive());
  const sb = getSupabase();
  if (!sb) throw new Error("No Supabase client");

  const { data: deliveries, error: dErr } = await sb.from("project_deliveries").select("id").limit(1);
  console.log("project_deliveries probe:", dErr?.message || `ok (${deliveries?.length ?? 0} row sample)`);

  const { data: users } = await sb.from("users").select("id,username,role").eq("username", "allauddin").limit(1);
  const u = users?.[0];
  if (!u) throw new Error("Staff user not found");

  const data = await fetchProjectOperationsDashboard(u.id, u.username, u.role);
  console.log("\nKPI:", JSON.stringify(data.summary, null, 2));
  console.log("CEO:", JSON.stringify(data.ceoSummary, null, 2));
  console.log(
    "Pipeline:",
    Object.entries(data.pipelineCounts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ")
  );
  console.log(
    "Kanban:",
    Object.entries(data.kanban)
      .map(([k, v]) => `${k}:${v.length}`)
      .join(", ")
  );
  console.log(
    "Delays top5:",
    data.delays
      .slice(0, 5)
      .map((d) => `${d.customerName} ${d.daysInStage}d ${d.delayTone}`)
      .join(" | ")
  );
  console.log(
    "Teams:",
    data.teamPerformance.map((t) => `${t.team}:${t.assigned}/${t.completed}`).join(", ")
  );
  console.log("Total:", data.projects.length);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
