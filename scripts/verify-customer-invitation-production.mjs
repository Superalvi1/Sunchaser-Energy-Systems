/**
 * Phase 14A production verification — customer invitation & portal linking.
 * Usage: node scripts/verify-customer-invitation-production.mjs
 */
const BASE = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
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

function staffHeaders(staff) {
  return {
    "Content-Type": "application/json",
    "X-Sunchaser-User-Id": staff.id,
    "X-Sunchaser-Username": staff.username,
    "X-Sunchaser-Role": staff.role || "Super Admin",
  };
}

let SA_HEADERS = {};

const results = [];

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${detail}`);
}

async function api(method, path, body, headers = SA_HEADERS) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
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

function buildPortalInvitationMessage(customerName, customerCode) {
  const portalUrl = `${BASE}/`;
  return `Hello ${customerName}

Welcome to Sunchaser Energy Systems.

Your Customer Portal Code:

${customerCode}

Register here:
${portalUrl}

Enter this code during registration to connect your portal account with your quotation, invoices, warranties, and project updates.

Thank you.`;
}

function buildWhatsAppUrl(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  const encoded = encodeURIComponent(message);
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

function countCustomersByEmail(customers, email) {
  const e = email.trim().toLowerCase();
  return customers.filter((c) => String(c.email || "").trim().toLowerCase() === e).length;
}

async function searchCustomers(q) {
  const res = await api("GET", `/api/admin/customer-linking/customers?q=${encodeURIComponent(q)}`);
  return res.json?.customers || [];
}

async function searchUsers(q) {
  const res = await api("GET", `/api/admin/customer-linking/users?q=${encodeURIComponent(q)}`);
  return res.json?.users || [];
}

async function resolveCustomer(email, phone) {
  const q = new URLSearchParams({ email, phone });
  const res = await api("GET", `/api/admin/customer-linking/resolve?${q}`);
  return { status: res.status, customer: res.json?.customer || null, error: res.json?.error };
}

async function main() {
  console.log(`\n=== Customer invitation production verify @ ${BASE} ===`);
  console.log(`Timestamp: ${TS}\n`);

  const staff = await loginStaff();
  SA_HEADERS = staffHeaders(staff);
  console.log(`Staff: ${staff.username} (${staff.id}, ${staff.role})\n`);

  // Deploy / bundle markers
  const indexHtml = await fetch(`${BASE}/`).then((r) => r.text());
  const jsMatch = indexHtml.match(/src="(\/assets\/index-[^"]+\.js)"/);
  let bundleJs = "";
  if (jsMatch) {
    bundleJs = await fetch(`${BASE}${jsMatch[1]}`).then((r) => r.text());
    const hasInvitationUi =
      bundleJs.includes("Customer Invitation") &&
      bundleJs.includes("WhatsApp Invitation") &&
      bundleJs.includes("Customer Code:");
    record(
      "4 Sales Team UI bundle",
      hasInvitationUi,
      `${jsMatch[1]} — CustomerInvitationPanel strings ${hasInvitationUi ? "present" : "missing"}`
    );
  } else {
    record("4 Sales Team UI bundle", false, "no index JS asset found");
  }

  // Step 2: Create lead A (code registration path)
  const leadA = {
    name: `InviteVerifyA ${TS}`,
    email: `invite-a-${TS}@verify.local`,
    phone: `0300${String(TS).slice(-7)}`,
    address: "Verify Street A",
    location: "Lahore",
    leadSource: "Production verify script",
    assignedSalesperson: "Verify Bot",
  };
  const createA = await api("POST", "/api/leads", leadA);
  const leadCreated = createA.status === 201 && createA.json?.id;
  record("2 Create lead", leadCreated, leadCreated ? `id=${createA.json.id}` : `status=${createA.status} ${createA.json?.error || createA.text?.slice(0, 120)}`);

  let migrationOk = false;
  let customerCode = null;
  let customerId = null;

  if (leadCreated) {
    const resolved = await resolveCustomer(leadA.email, leadA.phone);
    customerCode = resolved.customer?.customerCode || null;
    customerId = resolved.customer?.id || null;
    migrationOk = !!customerCode && /^SES-\d{6}$/.test(customerCode);
    record(
      "1 Migration / customer_code column",
      migrationOk,
      migrationOk
        ? `customer_code=${customerCode} on customer ${customerId}`
        : resolved.error?.includes("customer_code")
          ? `column missing — run scripts/customer-invitation-schema.sql (${resolved.error})`
          : `no code on customer row (${resolved.error || "null customer"})`
    );
    record(
      "3 customer_code on customer row",
      migrationOk,
      migrationOk ? customerCode : "missing or invalid"
    );
  } else {
    const err = createA.json?.error || createA.text || "";
    migrationOk = !String(err).includes("customer_code");
    record(
      "1 Migration / customer_code column",
      false,
      String(err).includes("customer_code")
        ? "column missing — run scripts/customer-invitation-schema.sql"
        : `lead create failed: ${String(err).slice(0, 120)}`
    );
    record("3 customer_code on customer row", false, "lead not created");
  }

  // Step 5: WhatsApp invitation message
  if (customerCode) {
    const invitation = buildPortalInvitationMessage(leadA.name, customerCode);
    const waUrl = buildWhatsAppUrl(leadA.phone, invitation);
    const waOk =
      waUrl.startsWith("https://wa.me/") &&
      waUrl.includes(encodeURIComponent(customerCode)) &&
      invitation.includes("Your Customer Portal Code:");
    record("5 WhatsApp invitation copy", waOk, waOk ? `wa.me URL built with code ${customerCode}` : "message/url invalid");
  } else {
    record("5 WhatsApp invitation copy", false, "skipped — no customer code");
  }

  // Step 6–9: Register with valid code
  const regUserA = `invcode_a_${TS}`;
  const regEmailA = leadA.email;
  let userAId = null;
  if (customerCode) {
    const beforeCustomers = await searchCustomers(leadA.email);
    const beforeCount = countCustomersByEmail(beforeCustomers, leadA.email);

    const regA = await api(
      "POST",
      "/api/auth/register",
      {
        username: regUserA,
        password: "VerifyPass123!",
        name: leadA.name,
        email: regEmailA,
        phone: leadA.phone,
        role: "Customer",
        customerCode,
      },
      { "Content-Type": "application/json" }
    );
    const regOk = regA.status === 201 && regA.json?.user?.id;
    userAId = regA.json?.user?.id || null;
    record(
      "6 Register with valid code",
      regOk,
      regOk ? `user=${userAId}` : `status=${regA.status} ${regA.json?.error || ""}`
    );

    const afterCustomers = await searchCustomers(leadA.email);
    const afterCount = countCustomersByEmail(afterCustomers, leadA.email);
    record(
      "7 No duplicate customer row",
      afterCount === 1 && beforeCount === 1,
      `customer rows for email: before=${beforeCount} after=${afterCount}`
    );

    const resolvedAfter = await resolveCustomer(leadA.email, leadA.phone);
    const linkedCustomer = resolvedAfter.customer;
    const usersForA = await searchUsers(regUserA);
    const portalUser = usersForA.find((u) => u.username === regUserA || u.id === userAId);

    const userPointsToCustomer =
      !!portalUser && (portalUser.customerId === customerId || portalUser.customer_id === customerId);
    record(
      "8 users.customer_id → existing customer",
      userPointsToCustomer,
      userPointsToCustomer
        ? `user ${userAId} → customer ${customerId}`
        : `user customerId=${portalUser?.customerId || portalUser?.customer_id || "none"}`
    );

    const customerPointsToUser = linkedCustomer?.userId === userAId;
    record(
      "9 customers.user_id → portal user",
      customerPointsToUser,
      customerPointsToUser
        ? `customer ${customerId} → user ${userAId}`
        : `customer userId=${linkedCustomer?.userId || "none"}`
    );
  } else {
    record("6 Register with valid code", false, "skipped — no code");
    record("7 No duplicate customer row", false, "skipped");
    record("8 users.customer_id → existing customer", false, "skipped");
    record("9 customers.user_id → portal user", false, "skipped");
  }

  // Step 10: Invalid code
  const badEmail = `invite-bad-${TS}@verify.local`;
  const badReg = await api(
    "POST",
    "/api/auth/register",
    {
      username: `invbad_${TS}`,
      password: "VerifyPass123!",
      name: "Bad Code Test",
      email: badEmail,
      phone: `0301${String(TS).slice(-7)}`,
      role: "Customer",
      customerCode: "SES-000000",
    },
    { "Content-Type": "application/json" }
  );
  const badUsers = await searchUsers(`invbad_${TS}`);
  const invalidBlocked = badReg.status >= 400 && badUsers.length === 0;
  record(
    "10 Invalid code → error, no account",
    invalidBlocked,
    invalidBlocked
      ? `status=${badReg.status} error="${badReg.json?.error || "rejected"}" users=0`
      : `status=${badReg.status} users=${badUsers.length}`
  );

  // Step 11: Blank code + matching phone/email → link existing
  const leadB = {
    name: `InviteVerifyB ${TS}`,
    email: `invite-b-${TS}@verify.local`,
    phone: `0302${String(TS).slice(-7)}`,
    address: "Verify Street B",
    location: "Karachi",
    leadSource: "Production verify script",
  };
  const createB = await api("POST", "/api/leads", leadB);
  const leadBId = createB.json?.id;
  let fallbackOk = false;
  if (createB.status === 201 && leadBId) {
    const resolvedB = await resolveCustomer(leadB.email, leadB.phone);
    const custBId = resolvedB.customer?.id;
    const beforeB = countCustomersByEmail(await searchCustomers(leadB.email), leadB.email);

    const regB = await api(
      "POST",
      "/api/auth/register",
      {
        username: `invfb_${TS}`,
        password: "VerifyPass123!",
        name: leadB.name,
        email: leadB.email,
        phone: leadB.phone,
        role: "Customer",
      },
      { "Content-Type": "application/json" }
    );
    const afterB = countCustomersByEmail(await searchCustomers(leadB.email), leadB.email);
    const resolvedBAfter = await resolveCustomer(leadB.email, leadB.phone);
    fallbackOk =
      regB.status === 201 &&
      beforeB === 1 &&
      afterB === 1 &&
      resolvedBAfter.customer?.id === custBId &&
      !!resolvedBAfter.customer?.userId;
    record(
      "11 Blank code + matching phone/email links existing",
      fallbackOk,
      fallbackOk
        ? `linked user ${resolvedBAfter.customer.userId} to customer ${custBId}, rows=${afterB}`
        : `reg status=${regB.status} before=${beforeB} after=${afterB} cust=${resolvedBAfter.customer?.id}`
    );
  } else {
    record("11 Blank code + matching phone/email links existing", false, "lead B create failed");
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${passed}/${results.length} passed, ${failed} failed ===`);
  console.log(
    JSON.stringify(
      {
        base: BASE,
        timestamp: TS,
        migrationInferred: migrationOk ? "applied (customer_code populated on new lead)" : "missing or not working",
        results,
      },
      null,
      2
    )
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
