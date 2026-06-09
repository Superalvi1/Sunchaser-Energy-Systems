#!/usr/bin/env node
/**
 * Phase 19 — contract-to-invoice automation E2E verify.
 * Usage: API_BASE=http://127.0.0.1:3000 node scripts/verify-contract-to-invoice.mjs
 */
const BASE = (process.env.API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const TS = Date.now();

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

async function api(method, path, staff, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: staff ? hdr(staff) : { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function pass(id, ok, msg) {
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${msg}`);
  return ok;
}

(async () => {
  console.log(`\n=== Phase 19 contract-to-invoice @ ${BASE} ===\n`);
  let ok = true;
  const staff = await loginStaff();

  const leadRes = await api("POST", "/api/leads", null, {
    name: `Phase19 Verify ${TS}`,
    email: `phase19-${TS}@verify.local`,
    phone: `0300-${String(TS).slice(-7)}`,
    address: "DHA Phase 6, Lahore",
    location: "Lahore",
    assignedSalesperson: "Verify Sales Advisor",
    monthlyBill: 85000,
    roofSpace: 900,
  });
  const leadId = leadRes.json?.id;
  ok &= pass("1 create lead", leadRes.status === 201 && !!leadId, leadId || leadRes.json?.error);

  if (!leadId) {
    console.log("\nAborting — no lead id\n");
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 4500));

  const quoteRes = await api("POST", `/api/leads/${leadId}/create-quote`, null, {
    quote_type: "manual_boq",
    clientName: leadRes.json.name,
    clientPhone: leadRes.json.phone,
    clientAddress: leadRes.json.address,
    systemSizekW: 12,
    systemType: "Hybrid",
    panelBrand: "Longi 550W",
    inverterBrand: "Growatt 12kW",
    batteryBrand: "Pylontech 10kWh",
    bdmName: "Verify Sales Advisor",
    totalCost: 1850000,
    grandTotal: 1850000,
    boqRows: [
      {
        id: `item-${TS}`,
        type: "item",
        name: "Solar Package",
        qty: 1,
        unit: "Lot",
        rate: 1850000,
        total: 1850000,
      },
    ],
  });
  const quoteId = (quoteRes.json?.quotes || []).slice(-1)[0]?.id;
  ok &= pass("2 create quotation", quoteRes.status === 200 && !!quoteId, quoteId || quoteRes.json?.error);

  const contractRes = await api("PUT", `/api/leads/${leadId}`, staff, { status: "Contracted" });
  const provision = contractRes.json?.contractProvision;
  ok &= pass(
    "3 mark contracted",
    contractRes.status === 200 && contractRes.json?.status === "Contracted",
    contractRes.json?.status || contractRes.json?.error
  );
  ok &= pass(
    "4 invoice auto-created",
    !!provision?.invoiceId,
    provision?.invoiceId || provision?.skipped || "missing"
  );
  ok &= pass(
    "5 customer auto-created",
    !!provision?.customerId,
    provision?.customerId || "missing"
  );
  ok &= pass(
    "6 payment ledger ensured",
    provision?.paymentTrackEnsured === true || !!provision?.projectId,
    `paymentTrack=${provision?.paymentTrackEnsured} project=${provision?.projectId}`
  );

  const dupRes = await api("PUT", `/api/leads/${leadId}`, staff, { status: "Contracted" });
  const dupProvision = dupRes.json?.contractProvision;
  ok &= pass(
    "7 no duplicate invoice",
    dupProvision?.invoiceExisting === true || dupProvision?.invoiceId === provision?.invoiceId,
    dupProvision?.invoiceExisting ? "existing=true" : String(dupProvision?.invoiceId)
  );

  const invList = await api("GET", "/api/admin/invoices", staff);
  const inv = (invList.json?.invoices || []).find((i) => i.id === provision?.invoiceId);
  ok &= pass(
    "8 invoice linked to quote",
    inv?.quotationId === quoteId && inv?.leadId === leadId,
    inv ? `${inv.quotationId} / ${inv.leadId}` : "invoice not in list"
  );

  const metaMatch = inv?.notes && inv.notes.includes("Longi");
  ok &= pass(
    "9 invoice populated from quote",
    inv?.customerName && inv?.customerPhone && (metaMatch || inv?.grandTotal > 0),
    inv ? `${inv.customerName} · PKR ${inv.grandTotal}` : "n/a"
  );

  const parties = await api("GET", "/api/admin/parties", staff);
  const partyHit = (parties.json?.parties || []).some(
    (p) => p.customerId === provision?.customerId || String(p.name || "").includes("Phase19")
  );
  ok &= pass("10 party ledger entry", partyHit, partyHit ? "found" : `${parties.json?.parties?.length || 0} parties`);

  const state = await api("GET", "/api/state", staff);
  const cust = (state.json?.customers || []).find((c) => c.id === provision?.customerId);
  ok &= pass("11 customer in state", !!cust, cust?.name || "missing");

  const project = (state.json?.projects || []).find((p) => p.leadId === leadId);
  ok &= pass("12 project for portal", !!project, project?.id || "missing");

  console.log(`\n${ok ? "ALL PASS" : "SOME FAILURES"}\n`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
