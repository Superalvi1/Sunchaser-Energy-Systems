/**
 * Phase 18A — contracted lead invoice + archive/delete verification.
 * Usage: node scripts/verify-invoice-contracted-lead.mjs
 */
const BASE = (process.env.API_BASE || "http://127.0.0.1:3456").replace(/\/$/, "");
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
    headers: hdr(staff),
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
  console.log(`\n=== Phase 18A invoice contracted lead @ ${BASE} ===\n`);
  let ok = true;
  const staff = await loginStaff();

  const ready = await api("GET", "/api/admin/invoices/contracted-ready", staff);
  ok &= pass("1 contracted-ready endpoint", ready.status === 200, `${ready.json.leads?.length ?? 0} row(s)`);

  const target = (ready.json.leads || []).find((r) => !r.hasInvoice) || ready.json.leads?.[0];
  if (!target) {
    console.log("SKIP 2-5: no contracted lead with quote in environment");
  } else {
    const created = await api("POST", "/api/admin/invoices/from-lead", staff, {
      leadId: target.leadId,
      quotationId: target.quotationId,
    });
    const invId = created.json.invoice?.id;
    ok &= pass(
      "2 create from lead",
      (created.status === 201 || created.status === 200) && !!invId,
      invId || created.json.error
    );

    const dup = await api("POST", "/api/admin/invoices/from-lead", staff, {
      leadId: target.leadId,
      quotationId: target.quotationId,
    });
    ok &= pass(
      "3 duplicate blocked (returns existing)",
      dup.status === 200 && dup.json.existing === true,
      dup.json.existing ? "existing=true" : dup.json.error || "no existing flag"
    );

    if (invId) {
      const payBlock = await api("POST", `/api/admin/invoices/${invId}/payments`, staff, {
        amount: 1000,
        paymentMethod: "Cash",
      });
      ok &= pass("4 record payment", payBlock.status === 201, payBlock.json.payment?.id || payBlock.json.error);

      const delBlock = await api("DELETE", `/api/admin/invoices/${invId}`, staff, { confirmText: "DELETE" });
      ok &= pass(
        "5 delete blocked with payments",
        delBlock.status === 409,
        delBlock.json.error || `status ${delBlock.status}`
      );

      const archive = await api("POST", `/api/admin/invoices/${invId}/archive`, staff);
      ok &= pass("6 archive invoice", archive.status === 200, archive.json.message || archive.json.error);

      const listActive = await api("GET", "/api/admin/invoices", staff);
      const hidden = !(listActive.json.invoices || []).some((i) => i.id === invId);
      ok &= pass("7 archived hidden from active list", hidden, hidden ? "hidden" : "still visible");

      const listArch = await api("GET", "/api/admin/invoices?includeArchived=true", staff);
      const visible = (listArch.json.invoices || []).some((i) => i.id === invId);
      ok &= pass("8 archived visible with includeArchived", visible, visible ? invId : "missing");
    }
  }

  console.log(`\n${ok ? "ALL PASS" : "SOME FAILURES"}\n`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
