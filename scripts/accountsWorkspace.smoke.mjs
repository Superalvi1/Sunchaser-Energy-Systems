import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined,
  headless: true,
  args: ["--no-sandbox"],
});
const user = {
  id: "staff-fixture",
  username: "test-director",
  name: "Test Director",
  role: "Director",
  accountStatus: "Approved",
  onboardingCompleted: true,
};
const party = {
  partyKey: "party-1",
  customerId: null,
  name: "Solar Client",
  phone: "03011234567",
  billingAddress: "Lahore",
  balanceDue: 1000,
  totalSales: 1500,
  receivedAmount: 500,
  invoiceCount: 1,
};
const manual = {
  id: "lead-manual",
  name: "Manual Client",
  phone: "03021234567",
  leadSource: "Direct/Referral",
  status: "New",
  createdAt: new Date().toISOString(),
  quotes: [],
};
const auto = {
  ...manual,
  id: "auto",
  name: "Inbox Enquiry",
  leadSource: "WhatsApp Shared Inbox",
  notes:
    "Created from WhatsApp Shared Inbox conversation c1 by system_auto_link.",
};
const smart = {
  ...manual,
  id: "smart",
  name: "Smart Quote Client",
  leadSource: "Smart Quote",
};
const state = {
  leads: [manual, auto, smart],
  products: [{ id: "panel", name: "Solar Panel", price: 12000 }],
  tickets: [],
  inventory: [],
  categories: [],
  orders: [],
  warranties: [],
  solarPackages: [],
  bankAccounts: [],
  quotations: [],
  settings: {},
  websiteContent: {},
  stats: {
    totalRevenue: 0,
    pendingRevenue: 0,
    totalLeads: 3,
    pipelineCount: 3,
    installedCount: 0,
    contractedCount: 0,
    leadsByStatus: { New: 3 },
  },
};
let saved,
  payment,
  authCalls = 0;
async function setup(width, native = false) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  await context.addInitScript(
    ({ user, native }) => {
      localStorage.setItem("sunchaser_auth_token", "fixture-token");
      localStorage.setItem("sunchaser_user", JSON.stringify(user));
      if (native) {
        window.androidBridge = {};
        window.Capacitor = {
          Plugins: {
            App: { addListener: async () => ({ remove: async () => {} }) },
          },
        };
      }
    },
    { user, native },
  );
  await context.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let body = {};
    if (url.pathname === "/api/auth/me") {
      authCalls++;
      body = { success: true, user };
    } else if (url.pathname === "/api/state") body = state;
    else if (url.pathname === "/api/onboarding/me")
      body = { onboardingCompleted: true };
    else if (url.pathname === "/api/admin/parties") body = { parties: [party] };
    else if (url.pathname.includes("/parties/party-1"))
      body = {
        party,
        transactions: [
          {
            invoiceId: "invoice-1",
            invoiceNumber: "INV-1",
            invoiceDate: "2026-10-06",
            grandTotal: 1500,
            paidAmount: 500,
            balanceDue: 1000,
            paymentStatus: "Partial",
          },
        ],
        payments: [],
      };
    else if (url.pathname.endsWith("/payments") && req.method() === "POST") {
      payment = req.postDataJSON();
      body = { success: true };
    } else if (url.pathname === "/api/leads" && req.method() === "POST") {
      const l = req.postDataJSON();
      state.leads.push({ ...manual, ...l, id: "new-party" });
      body = { success: true };
    } else if (
      url.pathname === "/api/admin/invoices" &&
      req.method() === "POST"
    ) {
      saved = req.postDataJSON();
      body = { invoice: { ...saved, id: "new-invoice" } };
    } else if (url.pathname === "/api/admin/invoices") body = { invoices: [] };
    else if (url.pathname.includes("customer-accounts"))
      body = { accounts: [] };
    else if (url.pathname.includes("ready-for-invoice")) body = { leads: [] };
    await route.fulfill({ json: body });
  });
  return { context, page: await context.newPage() };
}
try {
  const { context, page } = await setup(390);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    `${process.env.ACCOUNTS_SMOKE_URL || "http://127.0.0.1:4173"}/accounts`,
  );
  await page.getByRole("heading", { name: "Sunchaser Accounts" }).waitFor();
  await page.getByRole("button", { name: /Manual Client/ }).waitFor();
  assert.equal(await page.getByText("Inbox Enquiry").count(), 0);
  await page.screenshot({
    path: "/tmp/accounts-parties-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Solar Client/ }).click();
  await page.getByRole("button", { name: "Take Payment", exact: true }).click();
  await page
    .getByRole("heading", { name: "Record Payment", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("[role=dialog]")
      .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    390,
  );
  await page.locator("[role=dialog] input[type=number]").fill("250");
  await page.getByRole("button", { name: "Save Payment", exact: true }).click();
  await page
    .getByRole("heading", { name: "Record Payment", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(payment.amount, 250);
  await page.getByRole("button", { name: /Add Sale/ }).click();
  await page.locator('input[placeholder="Customer name"]').count();
  await page.getByRole("button", { name: /Add item details/ }).click();
  await page.getByRole("heading", { name: "Item Details" }).waitFor();
  await page.getByLabel("Item name", { exact: true }).fill("Panel");
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await page.getByLabel("Price per unit (Rs)", { exact: true }).fill("12000");
  await page.screenshot({
    path: "/tmp/accounts-item-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page
      .locator("[role=dialog]")
      .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    390,
  );
  await page.getByRole("button", { name: "Save Item", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Invoice created.", { exact: true }).waitFor();
  assert.equal(saved.customerName, "Solar Client");
  assert.equal(saved.items[0].qty, 2);
  assert.equal(saved.items[0].rate, 12000);
  assert.equal(saved.items[0].lineTotal, 24000);
  await page.screenshot({
    path: "/tmp/accounts-sale-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Parties", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "+ Add Party", exact: true }).click();
  await page.getByLabel("name *", { exact: true }).fill("New Client");
  await page.getByLabel("phone *", { exact: true }).fill("03031234567");
  await page.getByRole("button", { name: "Save Party" }).click();
  await page.getByRole("button", { name: /New Client/ }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
  const d = await setup(1440);
  await d.page.goto(
    `${process.env.ACCOUNTS_SMOKE_URL || "http://127.0.0.1:4173"}/accounts`,
  );
  await d.page.getByRole("button", { name: /Manual Client/ }).waitFor();
  assert.equal(
    await d.page
      .getByRole("navigation", { name: "Accounts navigation", exact: true })
      .isVisible(),
    true,
  );
  await d.page.screenshot({
    path: "/tmp/accounts-desktop.png",
    fullPage: true,
  });
  await d.context.close();
  const n = await setup(390, true);
  await n.page.goto(
    `${process.env.ACCOUNTS_SMOKE_URL || "http://127.0.0.1:4173"}/accounts`,
  );
  await n.page.getByRole("heading", { name: "Sunchaser Accounts" }).waitFor();
  await n.page.reload();
  await n.page.getByRole("heading", { name: "Sunchaser Accounts" }).waitFor();
  assert.equal(
    await n.page.evaluate(() => localStorage.getItem("sunchaser_auth_token")),
    "fixture-token",
  );
  await n.page.getByRole("button", { name: "Back", exact: true }).click();
  await n.page
    .getByRole("button", { name: "Accounts", exact: true })
    .first()
    .waitFor();
  assert.equal(
    await n.page
      .getByRole("button", { name: "WhatsApp Inbox", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await n.page
      .getByRole("button", { name: "Learning Studio", exact: true })
      .count(),
    0,
  );
  await n.context.close();
  console.log(
    "PASS: mobile/desktop Accounts, qualified parties, full-screen item edits, invoice POST totals, party form, native session reload and trimmed menus; auth checks=" +
      authCalls,
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
