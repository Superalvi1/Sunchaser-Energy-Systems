#!/usr/bin/env node
/**
 * Verify party ledger archive/restore (local or production).
 * Usage: API_BASE=http://localhost:3000 STAFF_USER=allauddin STAFF_ID=u-allauddin STAFF_ROLE="Super Admin" node scripts/verify-party-ledger-archive.mjs
 */
const BASE = (process.env.API_BASE || "http://localhost:3000").replace(/\/$/, "");
const STAFF = {
  "x-sunchaser-user-id": process.env.STAFF_ID || "u-allauddin",
  "x-sunchaser-username": process.env.STAFF_USER || "allauddin",
  "x-sunchaser-role": process.env.STAFF_ROLE || "Super Admin",
  "Content-Type": "application/json",
};

const TARGET_NAME = process.env.PARTY_NAME || "asdsa";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: STAFF,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function findParty(parties, name) {
  const q = name.toLowerCase();
  return parties.find((p) => String(p.name || "").toLowerCase() === q);
}

(async () => {
  console.log(`\n=== Party ledger archive verify @ ${BASE} ===\n`);
  const results = [];

  const active1 = await api("GET", "/api/admin/parties?visibility=active");
  const party = findParty(active1.data.parties || [], TARGET_NAME);
  results.push({
    step: "find active party",
    ok: !!party,
    msg: party ? `found ${party.partyKey}` : `party "${TARGET_NAME}" not in active list`,
  });
  if (!party) {
    console.log(results.map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.step}: ${r.msg}`).join("\n"));
    process.exit(1);
  }

  const invBefore = await api("GET", "/api/admin/invoices");
  const invoiceCountBefore = (invBefore.data.invoices || []).filter(
    (i) => String(i.customerName || "").toLowerCase() === TARGET_NAME.toLowerCase()
  ).length;

  const archive = await api("POST", `/api/admin/parties/${encodeURIComponent(party.partyKey)}/archive`);
  results.push({
    step: "archive",
    ok: archive.status === 200,
    msg: archive.status === 200 ? "archived" : archive.data.error || archive.status,
  });

  const active2 = await api("GET", "/api/admin/parties?visibility=active");
  const stillActive = findParty(active2.data.parties || [], TARGET_NAME);
  results.push({
    step: "hidden from active",
    ok: !stillActive,
    msg: stillActive ? "still visible in active" : "removed from active",
  });

  const archived = await api("GET", "/api/admin/parties?visibility=archived");
  const inArchived = findParty(archived.data.parties || [], TARGET_NAME);
  results.push({
    step: "visible in archived",
    ok: !!inArchived,
    msg: inArchived ? "found in archived filter" : "missing from archived",
  });

  const invAfter = await api("GET", "/api/admin/invoices");
  const invoiceCountAfter = (invAfter.data.invoices || []).filter(
    (i) => String(i.customerName || "").toLowerCase() === TARGET_NAME.toLowerCase()
  ).length;
  results.push({
    step: "invoices unchanged",
    ok: invoiceCountAfter === invoiceCountBefore,
    msg: `${invoiceCountBefore} → ${invoiceCountAfter}`,
  });

  const detail = await api("GET", `/api/admin/parties/${encodeURIComponent(party.partyKey)}`);
  results.push({
    step: "detail still loads",
    ok: detail.status === 200 && detail.data.party?.isArchived,
    msg: detail.status === 200 ? `${detail.data.transactions?.length || 0} invoices` : detail.data.error,
  });

  const restore = await api("POST", `/api/admin/parties/${encodeURIComponent(party.partyKey)}/restore`);
  results.push({
    step: "restore",
    ok: restore.status === 200,
    msg: restore.status === 200 ? "restored" : restore.data.error || restore.status,
  });

  const active3 = await api("GET", "/api/admin/parties?visibility=active");
  const backActive = findParty(active3.data.parties || [], TARGET_NAME);
  results.push({
    step: "back in active",
    ok: !!backActive,
    msg: backActive ? "visible in active again" : "not in active after restore",
  });

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.step}: ${r.msg}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===\n`);
  process.exit(failed.length ? 1 : 0);
})();
