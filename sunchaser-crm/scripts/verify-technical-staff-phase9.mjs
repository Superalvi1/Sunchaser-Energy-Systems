import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(root, "..");
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const API = (
  process.env.VITE_API_BASE_URL ||
  process.env.API_BASE_URL ||
  "https://sunchaser-energy-systems.onrender.com"
).replace(/\/$/, "");

const headers = (userId, username, extra = {}) => ({
  "Content-Type": "application/json",
  "X-Sunchaser-User-Id": userId,
  "X-Sunchaser-Username": username,
  ...extra,
});

async function login(username) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123" }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body, status: res.status };
}

let pass = 0;
let total = 0;
let technicianId = "";
let technicianUsername = "technician";
let technicianName = "";
let portalUserId = "";
let portalUsername = "portalclient";
let assignedJobId = "";

/** Create a service request and assign it to the technician (deterministic). */
async function ensureTechnicianAssignedJob(portalUser, salesUser, techUser) {
  const createRes = await fetch(`${API}/api/customer-portal/service-requests`, {
    method: "POST",
    headers: headers(portalUser.id, portalUser.username),
    body: JSON.stringify({
      serviceType: "Inspection",
      preferredDate: new Date().toISOString().slice(0, 10),
      preferredTime: "Morning (8am–12pm)",
      notes: `Phase 9 verify job ${Date.now()}`,
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  if (createRes.status !== 201 || !created.id) {
    return { ok: false, error: created.error || `create failed ${createRes.status}` };
  }

  const assignee = techUser.name || techUser.username || "technician";
  const patchRes = await fetch(
    `${API}/api/admin/service-requests/${encodeURIComponent(created.id)}`,
    {
      method: "PATCH",
      headers: headers(salesUser.id, salesUser.username),
      body: JSON.stringify({
        assignedTechnician: assignee,
        status: "Assigned",
        scheduledVisitDate: new Date().toISOString().slice(0, 10),
      }),
    }
  );
  const patched = await patchRes.json().catch(() => ({}));
  if (!patchRes.ok) {
    return { ok: false, error: patched.error || `assign failed ${patchRes.status}` };
  }

  return { ok: true, requestId: created.id, jobId: `svc-${created.id}`, assignee };
}

total++;
const probeRes = await fetch(`${API}/api/diagnostics/phase9-tables`);
const probeBody = await probeRes.json().catch(() => ({}));
const phase9Ok =
  probeBody.probes?.phase9_schema_ready === true ||
  (probeBody.probes?.technical_job_updates?.ok === true &&
    probeBody.probes?.users_onboarding_completed?.ok === true &&
    probeBody.probes?.users_onboarding_completed_at?.ok === true);
console.log(`${phase9Ok ? "PASS" : "FAIL"}: phase9 schema probes (${probeRes.status})`);
if (!phase9Ok) {
  console.log(
    "  hint: run scripts/client-portal-phase9-schema.sql in Supabase —",
    probeBody.schemaScript || "client-portal-phase9-schema.sql"
  );
  if (probeBody.probes?.technical_job_updates && !probeBody.probes.technical_job_updates.ok) {
    console.log("  missing:", probeBody.probes.technical_job_updates.message);
  }
  if (probeBody.probes?.users_onboarding_columns && !probeBody.probes.users_onboarding_columns.ok) {
    console.log("  missing columns:", probeBody.probes.users_onboarding_columns.hint);
  }
}
if (phase9Ok) pass++;

total++;
const survLogin = await login("surveyor");
const survOk = survLogin.ok && survLogin.body.user?.role === "Survey Engineer";
console.log(`${survOk ? "PASS" : "FAIL"}: surveyor login (${survLogin.status})`);
if (survOk) pass++;

total++;
let survJobsOk = false;
if (survLogin.body.user?.id) {
  const survJobs = await fetch(`${API}/api/technical/jobs/me`, {
    headers: headers(survLogin.body.user.id, survLogin.body.user.username),
  });
  survJobsOk = survJobs.ok;
}
console.log(`${survJobsOk ? "PASS" : "FAIL"}: surveyor technical jobs API`);
if (survJobsOk) pass++;

total++;
const instLogin = await login("installer");
const instOk = instLogin.ok && instLogin.body.user?.role === "Installation Team";
console.log(`${instOk ? "PASS" : "FAIL"}: installer login (${instLogin.status})`);
if (instOk) pass++;

total++;
let instJobsOk = false;
if (instLogin.body.user?.id) {
  const instJobs = await fetch(`${API}/api/technical/jobs/me`, {
    headers: headers(instLogin.body.user.id, instLogin.body.user.username),
  });
  instJobsOk = instJobs.ok;
}
console.log(`${instJobsOk ? "PASS" : "FAIL"}: installer technical jobs API`);
if (instJobsOk) pass++;

total++;
const techLogin = await login("technician");
const techOk =
  techLogin.ok &&
  ["Technician", "Service Technician"].includes(techLogin.body.user?.role);
technicianId = techLogin.body.user?.id || "";
technicianUsername = techLogin.body.user?.username || "technician";
technicianName = techLogin.body.user?.name || technicianUsername;
console.log(`${techOk ? "PASS" : "FAIL"}: technician login (${techLogin.status})`);
if (techOk) pass++;

const portalLogin = await login("portalclient");
portalUserId = portalLogin.body.user?.id || "";
portalUsername = portalLogin.body.user?.username || "portalclient";
const salesLogin = await login("sales");

if (techOk && portalLogin.ok && salesLogin.ok && portalLogin.body.user && salesLogin.body.user) {
  const seeded = await ensureTechnicianAssignedJob(
    portalLogin.body.user,
    salesLogin.body.user,
    techLogin.body.user
  );
  if (seeded.ok) {
    assignedJobId = seeded.jobId;
  } else {
    console.log(`  hint: could not seed technician job: ${seeded.error}`);
  }
}

total++;
const techJobsRes = await fetch(`${API}/api/technical/jobs/me`, {
  headers: headers(technicianId, technicianUsername),
});
const techJobsBody = await techJobsRes.json().catch(() => ({}));
const techJobs = techJobsBody.jobs || [];
const hasJob =
  techJobsRes.ok &&
  !!assignedJobId &&
  techJobs.some((j) => j.id === assignedJobId);
console.log(
  `${hasJob ? "PASS" : "FAIL"}: technician sees assigned jobs (${techJobsRes.status}, count=${techJobs.length}, job=${assignedJobId || "none"})`
);
if (!hasJob && assignedJobId) {
  console.log(`  hint: assignee used "${technicianName}" — check service_requests.assigned_technician`);
}
if (hasJob) pass++;

total++;
let statusOk = false;
if (assignedJobId && technicianId) {
  const stRes = await fetch(
    `${API}/api/technical/jobs/${encodeURIComponent(assignedJobId)}/status`,
    {
      method: "PATCH",
      headers: headers(technicianId, technicianUsername),
      body: JSON.stringify({ status: "En Route", userId: technicianId, username: technicianUsername }),
    }
  );
  statusOk = stRes.ok;
  if (!statusOk) {
    const err = await stRes.json().catch(() => ({}));
    console.log(`  hint: status ${stRes.status}`, err.error || "");
  }
}
console.log(`${statusOk ? "PASS" : "FAIL"}: technician updates job status`);
if (statusOk) pass++;

total++;
let updateOk = false;
if (assignedJobId && technicianId) {
  const upRes = await fetch(
    `${API}/api/technical/jobs/${encodeURIComponent(assignedJobId)}/update`,
    {
      method: "POST",
      headers: headers(technicianId, technicianUsername),
      body: JSON.stringify({
        status: "Completed",
        technicianNotes: "Phase 9 verify visit completed.",
        beforePhotoUrl: "https://example.com/before.jpg",
        afterPhotoUrl: "https://example.com/after.jpg",
        safetyChecklist: {
          acBreakerChecked: true,
          dcBreakerChecked: true,
          earthingChecked: true,
          inverterWorking: true,
          batteryChecked: true,
          dbPhotosUploaded: true,
          customerBriefed: true,
          siteCleaned: true,
        },
        userId: technicianId,
        username: technicianUsername,
      }),
    }
  );
  updateOk = upRes.ok;
  if (!updateOk) {
    const err = await upRes.json().catch(() => ({}));
    console.log(`  hint: update ${upRes.status}`, err.error || "");
  }
}
console.log(`${updateOk ? "PASS" : "FAIL"}: technician job update`);
if (updateOk) pass++;

total++;
const histRes = await fetch(`${API}/api/customer-portal/service-history/me`, {
  headers: headers(portalUserId, portalUsername),
});
const histBody = await histRes.json().catch(() => ({}));
const logs = histBody.logs || histBody.records || histBody.timeline || [];
const hasHistory =
  histRes.ok &&
  (Array.isArray(logs)
    ? logs.length > 0
    : (histBody.summary?.totalVisits ?? 0) > 0 ||
      JSON.stringify(histBody).includes("Phase 9"));
console.log(`${hasHistory ? "PASS" : "FAIL"}: customer service history after completion (${histRes.status})`);
if (hasHistory) pass++;

const onboardingRoutesOk = await fetch(`${API}/api/onboarding/me`, {
  method: "GET",
  headers: headers(portalUserId, portalUsername),
}).then((r) => r.status !== 404);

total++;
let reset1Ok = false;
if (onboardingRoutesOk && portalUserId) {
  const resetRes = await fetch(`${API}/api/onboarding/reset`, {
    method: "POST",
    headers: headers(portalUserId, portalUsername),
    body: JSON.stringify({ userId: portalUserId, username: portalUsername }),
  });
  const ob1 = await fetch(`${API}/api/onboarding/me?userId=${encodeURIComponent(portalUserId)}&username=${encodeURIComponent(portalUsername)}`, {
    headers: headers(portalUserId, portalUsername),
  });
  const ob1Body = await ob1.json().catch(() => ({}));
  reset1Ok = resetRes.ok && ob1.ok && ob1Body.onboardingCompleted === false;
  if (!reset1Ok) {
    console.log(`  hint: reset ${resetRes.status}, me onboardingCompleted=${ob1Body.onboardingCompleted}`);
  }
} else {
  console.log("  hint: GET /api/onboarding/me returns 404 — deploy latest Render build");
}
console.log(`${reset1Ok ? "PASS" : "FAIL"}: onboarding appears when reset`);
if (reset1Ok) pass++;

total++;
let completeOk = false;
if (onboardingRoutesOk && portalUserId) {
  const completeRes = await fetch(`${API}/api/onboarding/complete`, {
    method: "POST",
    headers: headers(portalUserId, portalUsername),
    body: JSON.stringify({ userId: portalUserId, username: portalUsername }),
  });
  const ob2 = await fetch(`${API}/api/onboarding/me?userId=${encodeURIComponent(portalUserId)}&username=${encodeURIComponent(portalUsername)}`, {
    headers: headers(portalUserId, portalUsername),
  });
  const ob2Body = await ob2.json().catch(() => ({}));
  completeOk = completeRes.ok && ob2.ok && ob2Body.onboardingCompleted === true;
}
console.log(`${completeOk ? "PASS" : "FAIL"}: onboarding hidden after complete`);
if (completeOk) pass++;

total++;
let reset2Ok = false;
if (onboardingRoutesOk && portalUserId) {
  const resetRes = await fetch(`${API}/api/onboarding/reset`, {
    method: "POST",
    headers: headers(portalUserId, portalUsername),
    body: JSON.stringify({ userId: portalUserId, username: portalUsername }),
  });
  const ob3 = await fetch(`${API}/api/onboarding/me?userId=${encodeURIComponent(portalUserId)}&username=${encodeURIComponent(portalUsername)}`, {
    headers: headers(portalUserId, portalUsername),
  });
  const ob3Body = await ob3.json().catch(() => ({}));
  reset2Ok = resetRes.ok && ob3.ok && ob3Body.onboardingCompleted === false;
}
console.log(`${reset2Ok ? "PASS" : "FAIL"}: reset onboarding (${reset2Ok ? "ok" : "see hints above"})`);
if (reset2Ok) pass++;

total++;
let regPass = true;
for (const route of ["documents/me", "service/me", "savings/me", "care/me", "energy/me"]) {
  const r = await fetch(`${API}/api/customer-portal/${route}`, {
    headers: headers(portalUserId, portalUsername),
  });
  if (!r.ok) regPass = false;
}
const stateRes = await fetch(`${API}/api/state`);
console.log(`${regPass && stateRes.ok ? "PASS" : "FAIL"}: existing portal + CRM regressions`);
if (regPass && stateRes.ok) pass++;

console.log(`\nPhase 9 verification: ${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
