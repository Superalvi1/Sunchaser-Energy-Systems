#!/usr/bin/env node
/**
 * Phase 24 verification — invoice-linked partial delivery + digital proof.
 */
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;

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
  const PORTAL = { userId: "u-cust-portal", username: "arsalan" };
  const quoteId = "q-delivery-test";
  const leadId = "lead-delivery-test";
  const invItemPanels = "ii-panels";
  const invItemStructure = "ii-structure";
  const inventoryPanelId = "inv-panel-longi";

  const localDb = {
    users: [
      { id: ACTOR.userId, username: "allauddin", role: "Super Admin", name: "Allauddin" },
      { id: PORTAL.userId, username: "arsalan", role: "Customer", name: "Arsalan", customerId: null },
    ],
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
        brand: "Longi",
        sku: "LONGI-550",
        stockQty: 100,
        reservedQty: 0,
        availableQty: 100,
        costPrice: 25000,
        updatedAt: new Date().toISOString(),
      },
    ],
    inventoryFoundationMovements: [],
    customerDocuments: [],
  };

  const lead = {
    id: leadId,
    name: "Arsalan",
    email: "arsalan@test.com",
    phone: "03001234567",
    address: "123 Solar Street, Lahore",
    status: "Contracted",
    quotes: [
      {
        id: quoteId,
        status: "Pending",
        totalCost: 500000,
        systemSizekW: 10,
        boqRows: [
          { id: "h-1", type: "heading", name: "Solar Panels" },
          {
            id: "panel-1",
            type: "item",
            name: "Longi X10 panels",
            qty: 18,
            rate: 20000,
            total: 360000,
          },
          { id: "h-2", type: "heading", name: "Structure" },
          {
            id: "struct-1",
            type: "item",
            name: "Galvanized structure kit",
            qty: 1,
            rate: 140000,
            total: 140000,
          },
        ],
      },
    ],
  };
  localDb.leads.push(lead);

  console.log("\n1) Contract lead → invoice");
  const provision = await provisionContractToInvoiceWorkflow(lead, localDb, {
    quotationId: quoteId,
    actor: ACTOR,
  });
  check("invoice created", !!provision.invoiceId);
  check("customer created", !!provision.customerId);

  const portalUser = localDb.users.find((u) => u.id === PORTAL.userId);
  portalUser.customerId = provision.customerId;

  const invoice = await invoiceDb.getAdminInvoiceById(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    provision.invoiceId,
    localDb
  );
  check("invoice has line items", (invoice.items || []).length >= 1, `count=${(invoice.items || []).length}`);

  const panelLine =
    (invoice.items || []).find((it) => String(it.itemName || it.description || "").toLowerCase().includes("panel")) ||
    invoice.items[0];
  const structLine =
    (invoice.items || []).find((it) => String(it.itemName || it.description || "").toLowerCase().includes("struct")) ||
    invoice.items[1];

  const panelItemId = panelLine?.id;
  const structItemId = structLine?.id;
  const panelQty = Number(panelLine?.qty || 18);

  if (!structLine) {
    const structRow = {
      id: invItemStructure,
      invoiceId: provision.invoiceId,
      itemName: "Galvanized structure kit",
      qty: 1,
      rate: 140000,
      lineTotal: 140000,
    };
    localDb.invoiceItems.push(structRow);
  }

  console.log("\n2) Create Delivery #1 — partial panels");
  const { challan: ch1 } = await delivery.createAdminDeliveryChallan(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    {
      invoiceId: provision.invoiceId,
      deliveryTitle: "Delivery #1 — Panels",
      items: [
        {
          invoiceItemId: panelItemId,
          itemName: panelLine?.itemName || "Longi X10 panels",
          invoiceQty: panelQty,
          deliverNowQty: 10,
          inventoryItemId: inventoryPanelId,
          serialNumber: "SN-PANEL-001",
        },
      ],
    },
    localDb
  );
  check("challan #1 created", !!ch1.id);
  check("challan status draft", ch1.status === "draft");
  check("deliver 10 panels", ch1.items?.[0]?.deliverNowQty === 10);
  check("remaining 8 after", ch1.items?.[0]?.remainingQtyAfter === panelQty - 10);

  console.log("\n3) Status → out for delivery → pending verification");
  await delivery.updateAdminDeliveryChallanStatus(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    ch1.id,
    "out_for_delivery",
    localDb
  );
  await delivery.updateAdminDeliveryChallanStatus(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    ch1.id,
    "delivered_pending_verification",
    localDb
  );

  console.log("\n4) OTP + signature + photo + verify");
  const { otp } = await delivery.sendAdminDeliveryOtp(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    ch1.id,
    localDb
  );
  check("OTP generated", String(otp).length === 6);

  await delivery.verifyAdminDeliveryOtp(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    ch1.id,
    { code: otp, verifiedByPhone: "03001234567" },
    localDb
  );

  await delivery.captureAdminDeliverySignature(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    ch1.id,
    { signatureDataUrl: "data:image/png;base64,iVBORw0KGgo=" },
    localDb
  );

  await delivery.uploadAdminDeliveryPhoto(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    ch1.id,
    { photoUrl: "https://example.com/material.jpg", photoType: "material", caption: "Panels loaded" },
    localDb
  );

  const { challan: verified1 } = await delivery.verifyAdminDeliveryChallan(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    ch1.id,
    {
      receiverName: "Arsalan",
      receiverPhone: "03001234567",
      receiverRelation: "owner",
      receivedMaterial: true,
      quantityCorrect: true,
      conditionAcceptable: true,
    },
    localDb
  );
  check("verified status", verified1.status === "verified_received");
  check("challan locked", verified1.otpVerifiedAt && verified1.signatureImageUrl);

  console.log("\n5) Certificate + customer document");
  const html = await delivery.renderDeliveryCertificateHtml(ch1.id, localDb);
  check("certificate HTML generated", html.includes("confirm") || html.includes("Confirm"));
  const certDoc = (localDb.customerDocuments || []).find(
    (d) => d.documentType === "material_delivery_certificate" && d.title?.includes(verified1.challanNumber)
  );
  check("customer document synced", !!certDoc);

  console.log("\n6) Invoice delivery summary");
  const { summary } = await delivery.getInvoiceDeliverySummaryAdmin(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    provision.invoiceId,
    localDb
  );
  check("delivered percent > 0", summary.deliveredPercent > 0, `${summary.deliveredPercent}%`);
  check("one verified challan", summary.verifiedCount === 1);
  const panelSummary = summary.lineSummaries.find((l) => l.invoiceItemId === panelItemId);
  check("panels remaining qty", panelSummary?.remainingQty === panelQty - 10, `got ${panelSummary?.remainingQty}`);

  console.log("\n7) Create Delivery #2 — remaining panels + structure");
  const { challan: ch2 } = await delivery.createAdminDeliveryChallan(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    {
      invoiceId: provision.invoiceId,
      deliveryTitle: "Delivery #2 — Structure + remaining panels",
      items: [
        {
          invoiceItemId: panelItemId,
          itemName: panelLine?.itemName || "Longi X10 panels",
          invoiceQty: panelQty,
          deliverNowQty: panelQty - 10,
        },
        {
          invoiceItemId: structItemId,
          itemName: structLine?.itemName || "Galvanized structure kit",
          invoiceQty: 1,
          deliverNowQty: 1,
        },
      ],
    },
    localDb
  );
  check("challan #2 created", !!ch2.id);
  check("two lines on challan 2", (ch2.items || []).length === 2);

  const { summary: summary2 } = await delivery.getInvoiceDeliverySummaryAdmin(
    ACTOR.userId,
    ACTOR.username,
    ACTOR.role,
    provision.invoiceId,
    localDb
  );
  check("two challans on invoice", summary2.challanCount === 2);

  console.log("\n8) Customer portal deliveries");
  const portalData = await delivery.fetchCustomerPortalDeliveriesMe(
    PORTAL.userId,
    PORTAL.username,
    localDb
  );
  check("portal lists verified delivery", portalData.deliveries.some((d) => d.id === ch1.id));
  check("portal hides draft challan 2", !portalData.deliveries.some((d) => d.id === ch2.id));

  console.log("\n9) Inventory movement on verify");
  const movements = localDb.inventoryFoundationMovements || [];
  const matDelivered = movements.filter((m) => (m.reference_type || m.referenceType) === "material_delivered");
  check("material_delivered movement", matDelivered.length >= 1);
  check(
    "stock reduced",
    Number(localDb.inventoryFoundationItems[0].stock_qty ?? localDb.inventoryFoundationItems[0].stockQty) === 90,
    `stock=${localDb.inventoryFoundationItems[0].stock_qty ?? localDb.inventoryFoundationItems[0].stockQty}`
  );

  console.log("\n10) Verified challan locked from edit");
  let locked = false;
  try {
    await delivery.updateAdminDeliveryChallan(
      ACTOR.userId,
      ACTOR.username,
      ACTOR.role,
      ch1.id,
      { notes: "should fail" },
      localDb
    );
  } catch (e) {
    locked = String(e.message || "").includes("locked") || String(e.message || "").includes("cannot");
  }
  check("verified challan edit blocked", locked);

  console.log("\n11) Dashboard summary");
  const { summary: dash } = await delivery.fetchDeliveryDashboardSummary(
    ACTOR.userId,
    ACTOR.username,
    localDb
  );
  check("verified deliveries count", dash.verifiedDeliveries >= 1);
  check("pending includes challan 2", dash.pendingDeliveries >= 1);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
