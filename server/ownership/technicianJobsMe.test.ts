/**
 * Phase 1B.2B /api/technical/jobs/me ownership filter tests — run: npm run test:phase-1b2b
 */
import assert from "node:assert/strict";
import { listTechnicalJobsForUser } from "../../dbManager.ts";

const savedSupabaseUrl = process.env.SUPABASE_URL;
delete process.env.SUPABASE_URL;

const techADb = {
  users: [
    { id: "u-tech-1", username: "techa", name: "Tech A", role: "Technician" },
    { id: "u-tech-2", username: "techb", name: "Tech B", role: "Technician" },
  ],
  leads: [],
  serviceRequests: [
    {
      id: "sr-a",
      assigned_user_id: "u-tech-1",
      assigned_technician: "Tech A",
      service_type: "Cleaning",
      status: "Assigned",
    },
    {
      id: "sr-b",
      assigned_user_id: "u-tech-2",
      assigned_technician: "Tech B",
      service_type: "Inspection",
      status: "Assigned",
    },
    {
      id: "sr-stale",
      assigned_user_id: "u-tech-2",
      assigned_technician: "Tech A",
      service_type: "Inspection",
      status: "Assigned",
    },
  ],
  tickets: [
    {
      id: "ticket-a",
      assigned_user_id: "u-tech-1",
      assigned_technician: "Tech A",
      status: "Open",
    },
    {
      id: "ticket-b",
      assigned_user_id: "u-tech-2",
      assigned_technician: "Tech B",
      status: "Open",
    },
  ],
  technicalJobUpdates: [
    {
      job_id: "svc-sr-b",
      status: "Started",
      updated_at: "2026-07-07T12:00:00.000Z",
      technician_notes: "secret from tech B job",
    },
    {
      job_id: "svc-sr-a",
      status: "Completed",
      updated_at: "2026-07-07T12:00:00.000Z",
    },
  ],
} as any;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    failed += 1;
  }
}

await test("jobs/me excludes another technician service request", async () => {
  const dashboard = await listTechnicalJobsForUser("u-tech-1", "techa", techADb);
  const jobIds = dashboard.jobs.map((job) => job.id);
  assert.ok(jobIds.includes("svc-sr-a"));
  assert.equal(jobIds.includes("svc-sr-b"), false);
});

await test("jobs/me excludes another technician support ticket", async () => {
  const dashboard = await listTechnicalJobsForUser("u-tech-1", "techa", techADb);
  const jobIds = dashboard.jobs.map((job) => job.id);
  assert.ok(jobIds.includes("sup-ticket-a"));
  assert.equal(jobIds.includes("sup-ticket-b"), false);
});

await test("jobs/me rejects stale legacy assignee when durable user id points elsewhere", async () => {
  const dashboard = await listTechnicalJobsForUser("u-tech-1", "techa", techADb);
  const jobIds = dashboard.jobs.map((job) => job.id);
  assert.equal(jobIds.includes("svc-sr-stale"), false);
});

await test("jobs/me does not overlay technical_job_updates for filtered-out jobs", async () => {
  const dashboard = await listTechnicalJobsForUser("u-tech-1", "techa", techADb);
  const srA = dashboard.jobs.find((job) => job.id === "svc-sr-a");
  assert.ok(srA);
  assert.equal(srA.status, "Completed");
  const leaked = dashboard.jobs.find((job) => job.id === "svc-sr-b");
  assert.equal(leaked, undefined);
});

if (savedSupabaseUrl) process.env.SUPABASE_URL = savedSupabaseUrl;
else delete process.env.SUPABASE_URL;

console.log(`\nPhase 1B.2B jobs/me tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
