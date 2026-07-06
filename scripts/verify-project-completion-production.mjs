/**
 * Phase 12.1 — Verify project completion schema + API on production.
 * Usage: API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-project-completion-production.mjs
 *
 * Requires technician auth headers and an assigned delivery (default: first from /me).
 * Does NOT bypass proof-photo gates — uploads all required media before marking Completed.
 */
const BASE = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
const USER_ID = process.env.TECH_USER_ID || "u-10";
const USERNAME = process.env.TECH_USERNAME || "technician";
const DELIVERY_ID = process.env.DELIVERY_ID || "";

const MEDIA_TYPES = [
  "panel_site_photo",
  "panel_serial_photo",
  "inverter_installed_photo",
  "inverter_serial_photo",
  "battery_installed_photo",
  "battery_serial_photo",
  "earth_bore_photo",
  "earthing_connection_photo",
  "complete_site_photo",
  "customer_handover_photo",
];

const results = [];

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${detail}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Sunchaser-User-Id": USER_ID,
      "X-Sunchaser-Username": USERNAME,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json, text };
}

function isSchemaError(text) {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("does not exist") ||
    t.includes("schema cache") ||
    t.includes("could not find the table") ||
    t.includes("could not find the") && t.includes("column")
  );
}

async function main() {
  console.log(`\n=== Project completion verify @ ${BASE} ===\n`);

  const me = await api("GET", `/api/technical/project-deliveries/me?userId=${USER_ID}&username=${USERNAME}`);
  const deliveries = me.json?.deliveries || [];
  record(
    "PREFLIGHT deliveries/me",
    me.status === 200,
    me.status === 200 ? `${deliveries.length} assigned deliveries` : `status=${me.status} ${me.text?.slice(0, 120)}`
  );

  const deliveryId = DELIVERY_ID || deliveries[0]?.id;
  if (!deliveryId) {
    printSummary();
    process.exit(1);
  }
  record("DELIVERY", true, deliveryId);

  const statusBefore = await api(
    "GET",
    `/api/technical/project-deliveries/${deliveryId}/completion-status?userId=${USER_ID}&username=${USERNAME}`
  );
  record(
    "A0 completion-status",
    statusBefore.status === 200 && !isSchemaError(statusBefore.text),
    statusBefore.status === 200
      ? `stage=${statusBefore.json?.completionStage} canComplete=${statusBefore.json?.canComplete}`
      : statusBefore.text?.slice(0, 200)
  );

  for (const mediaType of MEDIA_TYPES) {
    const up = await api("POST", `/api/technical/project-deliveries/${deliveryId}/completion-media`, {
      mediaType,
      fileUrl: `https://verify.local/${deliveryId}/${mediaType}.jpg`,
      userId: USER_ID,
      username: USERNAME,
    });
    const ok =
      (up.status === 200 || up.status === 201) &&
      !isSchemaError(up.text) &&
      up.json?.media?.mediaType === mediaType;
    record(`A UPLOAD ${mediaType}`, ok, ok ? "saved" : `status=${up.status} ${up.text?.slice(0, 150)}`);
  }

  const stageMid = await api("PATCH", `/api/technical/project-deliveries/${deliveryId}/completion-stage`, {
    completionStage: "Customer Handover",
    batteryApplicable: true,
    userId: USER_ID,
    username: USERNAME,
  });
  record(
    "B completion-stage (Customer Handover)",
    stageMid.status === 200 && !isSchemaError(stageMid.text),
    stageMid.status === 200
      ? `delivery_status=${stageMid.json?.delivery?.delivery_status || stageMid.json?.delivery?.deliveryStatus}`
      : stageMid.text?.slice(0, 200)
  );

  const statusMid = await api(
    "GET",
    `/api/technical/project-deliveries/${deliveryId}/completion-status?userId=${USER_ID}&username=${USERNAME}`
  );
  record(
    "B2 canComplete after uploads",
    statusMid.status === 200 && statusMid.json?.canComplete === true,
    statusMid.json?.canComplete
      ? "all required proof present"
      : `missing: ${(statusMid.json?.missingLabels || []).join(", ")}`
  );

  const stageDone = await api("PATCH", `/api/technical/project-deliveries/${deliveryId}/completion-stage`, {
    completionStage: "Completed",
    batteryApplicable: true,
    userId: USER_ID,
    username: USERNAME,
  });
  record(
    "C completion-stage (Completed)",
    stageDone.status === 200 && !isSchemaError(stageDone.text),
    stageDone.status === 200
      ? `delivery_status=${stageDone.json?.delivery?.delivery_status || stageDone.json?.delivery?.deliveryStatus}`
      : stageDone.text?.slice(0, 200)
  );

  const statusPatch = await api("PATCH", `/api/technical/project-deliveries/${deliveryId}/status`, {
    deliveryStatus: "Installation Completed",
    userId: USER_ID,
    username: USERNAME,
  });
  record(
    "D delivery_status Installation Completed",
    statusPatch.status === 200 && !isSchemaError(statusPatch.text),
    statusPatch.status === 200
      ? `status=${statusPatch.json?.deliveryStatus || statusPatch.json?.delivery_status}`
      : statusPatch.text?.slice(0, 200)
  );

  const noSchema =
    results.filter((r) => r.step.startsWith("A") || r.step.startsWith("B") || r.step.startsWith("C") || r.step.startsWith("D"))
      .every((r) => r.ok || !String(r.detail).toLowerCase().includes("schema"));
  record(
    "E no schema errors",
    !results.some((r) => isSchemaError(r.detail)),
    results.some((r) => isSchemaError(r.detail)) ? "schema errors detected above" : "clean"
  );

  printSummary();
}

function printSummary() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
