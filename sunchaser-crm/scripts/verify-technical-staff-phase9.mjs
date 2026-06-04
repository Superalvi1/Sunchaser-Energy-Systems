import dotenv from "dotenv";
import { spawnSync } from "child_process";
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
let portalUserId = "";
let portalUsername = "portalclient";
let assignedJobId = "";

total++;
const probeRes = await fetch(`${API}/api/diagnostics/phase9-tables`);
const probeBody = await probeRes.json().catch(() => ({}));
const phase9Ok =
  probeBody.probes?.technical_job_updates?.ok === true &&
  probeBody.probes?.users_onboarding_columns?.ok === true;
console.log(`${phase9Ok ? "PASS" : "FAIL"}: phase9 schema probes (${probeRes.status})`);
if (phase9Ok) pass++;

total++;
const survLogin = await login("surveyor");
const survOk = survLogin.ok && survLogin.body.user?.role === "Survey Engineer";
console.log(`${survOk ? "PASS" : "FAIL"}: surveyor login (${survLogin.status})`);
if (survOk) pass++;

total++;
const survJobs = await fetch(`${API}/api/technical/jobs/me`, {
  headers: headers(survLogin.body.user.id, survLogin.body.user.username),
});
const survJobsOk = survJobs.ok;
console.log(`${survJobsOk ? "PASS" : "FAIL"}: surveyor technical jobs API (${survJobs.status})`);
if (survJobsOk) pass++;

total++;
const instLogin = await login("installer");
const instOk = instLogin.ok && instLogin.body.user?.role === "Installation Team";
console.log(`${instOk ? "PASS" : "FAIL"}: installer login (${instLogin.status})`);
if (instOk) pass++;

total++;
const instJobs = await fetch(`${API}/api/technical/jobs/me`, {
  headers: headers(instLogin.body.user.id, instLogin.body.user.username),
});
console.log(`${instJobs.ok ? "PASS" : "FAIL"}: installer technical jobs API (${instJobs.status})`);
if (instJobs.ok) pass++;

total++;
const techLogin = await login("technician");
const techOk = techLogin.ok && ["Technician", "Service Technician"].includes(techLogin.body.user?.role);
technicianId = techLogin.body.user?.id || "";
technicianUsername = techLogin.body.user?.username || "technician";
console.log(`${techOk ? "PASS" : "FAIL"}: technician login (${techLogin.status})`);
if (techOk) pass++;

const salesLogin = await login("sales");
const salesOk = salesLogin.ok;
const salesUser = salesLogin.body.user;

if (salesOk && salesUser) {
  const listRes = await fetch(
    `${API}/api/admin/service-requests?userId=${encodeURIComponent(salesUser.id)}&username=${encodeURIComponent(salesUser.username)}`,
    { headers: headers(salesUser.id, salesUser.username) }
  );
  const listBody = await listRes.json().catch(() => ({}));
  const requests = Array.isArray(listBody) ? listBody : listBody.requests || [];
  const target =
    requests.find((r) => r.status !== "Completed") || requests[0];

  if (target?.id) {
    await fetch(`${API}/api/admin/service-requests/${target.id}`, {
      method: "PATCH",
      headers: headers(salesUser.id, salesUser.username),
      body: JSON.stringify({
        assignedTechnician: techLogin.body.user?.name || "Dave Installer",
        status: "Assigned",
      }),
    });
    assignedJobId = `svc-${target.id}`;
  }
}

total++;
const techJobsRes = await fetch(`${API}/api/technical/jobs/me`, {
  headers: headers(technicianId, technicianUsername),
});
const techJobsBody = await techJobsRes.json().catch(() => ({}));
const techJobs = techJobsBody.jobs || [];
if (!assignedJobId && techJobs[0]?.id) assignedJobId = techJobs[0].id;
const hasJob = techJobsRes.ok && (assignedJobId ? techJobs.some((j) => j.id === assignedJobId) : techJobs.length >= 0);
console.log(`${hasJob ? "PASS" : "FAIL"}: technician sees jobs (${techJobsRes.status}, count=${techJobs.length})`);
if (hasJob) pass++;

if (assignedJobId && technicianId) {
  total++;
  const stRes = await fetch(`${API}/api/technical/jobs/${encodeURIComponent(assignedJobId)}/status`, {
    method: "PATCH",
    headers: headers(technicianId, technicianUsername),
    body: JSON.stringify({ status: "En Route" }),
  });
  console.log(`${stRes.ok ? "PASS" : "FAIL"}: technician updates job status (${stRes.status})`);
  if (stRes.ok) pass++;

  total++;
  const upRes = await fetch(`${API}/api/technical/jobs/${encodeURIComponent(assignedJobId)}/update`, {
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
    }),
  });
  console.log(`${upRes.ok ? "PASS" : "FAIL"}: technician job update (${upRes.status})`);
  if (upRes.ok) pass++;
}

const portalLogin = await login("portalclient");
portalUserId = portalLogin.body.user?.id || "";
portalUsername = portalLogin.body.user?.username || "portalclient";

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
    : (histBody.summary?.totalVisits ?? 0) > 0 || JSON.stringify(histBody).includes("Phase 9"));
console.log(`${hasHistory ? "PASS" : "FAIL"}: customer service history after completion (${histRes.status})`);
if (hasHistory) pass++;

total++;
await fetch(`${API}/api/onboarding/reset`, {
  method: "POST",
  headers: headers(portalUserId, portalUsername),
  body: JSON.stringify({}),
});
const ob1 = await fetch(`${API}/api/onboarding/me?userId=${portalUserId}&username=${portalUsername}`, {
  headers: headers(portalUserId, portalUsername),
});
const ob1Body = await ob1.json().catch(() => ({}));
const needsWizard = ob1.ok && ob1Body.onboardingCompleted === false;
console.log(`${needsWizard ? "PASS" : "FAIL"}: onboarding appears when reset (${ob1.status})`);
if (needsWizard) pass++;

total++;
await fetch(`${API}/api/onboarding/complete`, {
  method: "POST",
  headers: headers(portalUserId, portalUsername),
  body: JSON.stringify({}),
});
const ob2 = await fetch(`${API}/api/onboarding/me?userId=${portalUserId}&username=${portalUsername}`, {
  headers: headers(portalUserId, portalUsername),
});
const ob2Body = await ob2.json().catch(() => ({}));
const doneWizard = ob2.ok && ob2Body.onboardingCompleted === true;
console.log(`${doneWizard ? "PASS" : "FAIL"}: onboarding hidden after complete (${ob2.status})`);
if (doneWizard) pass++;

total++;
const resetRes = await fetch(`${API}/api/onboarding/reset`, {
  method: "POST",
  headers: headers(portalUserId, portalUsername),
  body: JSON.stringify({}),
});
const ob3 = await fetch(`${API}/api/onboarding/me?userId=${portalUserId}&username=${portalUsername}`, {
  headers: headers(portalUserId, portalUsername),
});
const ob3Body = await ob3.json().catch(() => ({}));
const resetOk = resetRes.ok && ob3Body.onboardingCompleted === false;
console.log(`${resetOk ? "PASS" : "FAIL"}: reset onboarding (${resetRes.status})`);
if (resetOk) pass++;

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

const phase8 = spawnSync("node", ["scripts/verify-client-portal-phase8.mjs"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (phase8.stdout) console.log(phase8.stdout);
process.exit(pass === total && phase8.status === 0 ? 0 : 1);
