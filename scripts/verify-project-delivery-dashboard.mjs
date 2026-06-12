#!/usr/bin/env node
/**
 * Project Delivery dashboard — contracted customer picker + invoice-linked challans.
 */
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
process.env.NODE_ENV = "development";

import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  const { register } = await import("tsx/esm/api");
  register();

  const { provisionContractToInvoiceWorkflow } = await import("../contractToInvoiceDb.ts");
  const delivery = await import("../deliveryManagementDb.ts");
  const invoiceDb = await import("../invoiceDb.ts");

  const ACTOR = { userId: "u-super", username: "allauddin", role: "Super Admin" };
  const quoteId = "q-pd-dashboard";
  const leadId = "lead-pd-dashboard";
  const inventoryPanelId = "inv-panel-pd";

  const localDb = {
    users: [{ id: ACTOR.userId, username: "allauddin", role: "Super Admin", name: "Allauddin" }],
    customers: [],
    leads: [],
    projects: [],
    invoices: [],
    invoiceItems: [],
    invoicePayments: [],
    paymentTracks: {},
    deliveryChallans: [],
    deliveryChallanItems: [],
    deliveryChallanPhotos: [],
    inventoryFoundationItems: [
      {
        id: inventoryPanelId,
        category: "Panels",
        sku: "LONGI-PD",
        stockQty: 50,
        reservedQty: 0,
        availableQty: 50,
        costPrice: 25000,
        updatedAt: new Date().toISOString(),
      },
    ],
    inventoryFoundationMovements: [],
    customerDocuments: [],
  };

  localDb.leads.push({
    id: leadId,
    name: "Hassan Solar",
    email: "hassan@test.com",
    phone: "03009998877",
    address: "45 Green Avenue, Islamabad",
    status: "Contracted",
    quotes: [
      {
        id: quoteId,
        status: "Pending",
        totalCost: 360000,
        systemSizekW: 12,
        boqRows: [
          { id: "h-1", type: "heading", name: "Solar Panels" },
          { id: "panel-1", type: "item", name: "Longi panels", qty: 20, rate: 18000, total: 360000 },
        ],
      },
    ],
  });

  console.log("\n1) Lead marked Contracted → provision workflow");
  check("lead is Contracted", localDb.leads[0].status === "Contracted");

  const provision = await provisionContractToInvoiceWorkflow(localDb.leads[0], localDb, {
    quotationId: quoteId,
    actor: ACTOR,
  });
  check("invoice auto-created", !!provision.invoiceId);
  check("project auto-created", !!provision.projectId);
  check("customer auto-created", !!provision.customerId);

  console.log("\n2) Invoice exists with expected context");
  const invoice = await invoiceDb.loadInvoiceRecordById(provision.invoiceId, localDb);
  check("invoice has number", !!invoice.invoiceNumber);
  check("invoice linked to lead", invoice.leadId === leadId);
  check("invoice linked to project", invoice.projectId === provision.projectId);

  console.log("\n3) Delivery dashboard contracted-customers list");
  const customers = await delivery.listDeliveryDashboardCustomers(
    ACTOR.userId,
    ACTOR.username,
    localDb.leads,
    localDb
  );
  check("returns at least one customer", customers.length >= 1);
  const row = customers.find((c) => c.invoiceId === provision.invoiceId);
  check("includes provisioned customer", !!row);
  check("row has customer name", row?.customerName === "Hassan Solar");
  check("row has phone", row?.phone === "03009998877");
  check("row has address", row?.siteAddress?.includes("Green Avenue"));
  check("row has system size", !!row?.systemSize);
  check("row has invoice number", row?.invoiceNumber === invoice.invoiceNumber);
  check("row has quotation id", row?.quotationId === quoteId);
  check("row has project id", row?.projectId === provision.projectId);

  console.log("\n4-6) Project Delivery panel context (DeliveryChallanPanel data source)");
  const panelData = await delivery.listAdminDeliveriesForInvoice(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    provision.invoiceId,
    localDb
  );
  check("DeliveryChallanPanel summary loads", !!panelData.summary);
  check("invoice context in panel payload", panelData.invoice?.id === provision.invoiceId);
  check("customer name in panel payload", panelData.invoice?.customerName === "Hassan Solar");
  check("starts with zero challans", panelData.challans.length === 0);
  check("remaining qty available", panelData.summary.remainingQty > 0);

  console.log("\n7) Create partial delivery challan");
  const panelLine = invoice.items[0];
  const { challan } = await delivery.createAdminDeliveryChallan(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    {
      invoiceId: provision.invoiceId,
      deliveryTitle: "Partial — panels batch 1",
      items: [
        {
          invoiceItemId: panelLine.id,
          itemName: panelLine.itemName,
          invoiceQty: Number(panelLine.qty),
          deliverNowQty: 8,
          inventoryItemId: inventoryPanelId,
        },
      ],
    },
    localDb
  );
  check("partial challan created", !!challan?.id);
  check("partial qty recorded", challan.items?.[0]?.deliverNowQty === 8);

  await delivery.updateAdminDeliveryChallanStatus(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    challan.id,
    "out_for_delivery",
    localDb
  );

  const after = await delivery.listDeliveryDashboardCustomers(
    ACTOR.userId,
    ACTOR.username,
    localDb.leads,
    localDb
  );
  const rowAfter = after.find((c) => c.invoiceId === provision.invoiceId);
  check("dashboard reflects challan count", rowAfter?.challanCount === 1);
  const expectedRemaining = Number(panelLine.qty) - 8;
  check(
    "dashboard reflects remaining qty",
    rowAfter?.remainingQty === expectedRemaining,
    `expected ${expectedRemaining}, got ${rowAfter?.remainingQty}`
  );

  console.log("\n8) No manual cust-101 project creation in UI");
  const staffSrc = readFileSync(join(ROOT, "src/components/ProjectDeliveryStaff.tsx"), "utf8");
  check("ProjectDeliveryStaff has no cust-101", !staffSrc.includes("cust-101"));
  check("ProjectDeliveryStaff has no createAdminProjectDelivery", !staffSrc.includes("createAdminProjectDelivery"));
  check("ProjectDeliveryStaff uses delivery dashboard API", staffSrc.includes("fetchDeliveryDashboardCustomers"));
  check("ProjectDeliveryStaff embeds DeliveryChallanPanel", staffSrc.includes("DeliveryChallanPanel"));

  console.log("\n9) npm run build");
  const viteBin = join(ROOT, "node_modules/.bin/vite");
  const esbuildBin = join(ROOT, "node_modules/.bin/esbuild");
  let buildOk = false;
  try {
    const vite = spawnSync(viteBin, ["build"], { cwd: ROOT, stdio: "pipe" });
    const esbuild = spawnSync(
      esbuildBin,
      [
        "server.ts",
        "--bundle",
        "--platform=node",
        "--format=cjs",
        "--packages=external",
        "--sourcemap",
        "--outfile=dist/server.cjs",
      ],
      { cwd: ROOT, stdio: "pipe" }
    );
    buildOk = vite.status === 0 && esbuild.status === 0;
    if (!buildOk) {
      console.error(vite.stderr?.toString() || vite.stdout?.toString());
      console.error(esbuild.stderr?.toString() || esbuild.stdout?.toString());
    }
  } catch (err) {
    console.error(String(err));
  }
  check("npm run build passes", buildOk);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
