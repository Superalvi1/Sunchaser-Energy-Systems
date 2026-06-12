#!/usr/bin/env node
/**
 * Phase 24 FINAL — QR + WhatsApp customer delivery verification.
 */
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
process.env.NODE_ENV = "development";

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
  const { buildWhatsAppVerificationMessage } = await import("../src/lib/deliveryManagement.ts");
  const { buildDeliveryVerificationUrl } = await import("../src/lib/deliveryQr.ts");

  const ACTOR = { userId: "u-super", username: "allauddin", role: "Super Admin" };
  const PORTAL = { userId: "u-cust-portal", username: "arsalan" };
  const quoteId = "q-qr-delivery";
  const leadId = "lead-qr-delivery";
  const inventoryPanelId = "inv-panel-qr";

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
      { id: inventoryPanelId, category: "Panels", sku: "LONGI", stockQty: 50, reservedQty: 0, availableQty: 50, costPrice: 25000, updatedAt: new Date().toISOString() },
    ],
    inventoryFoundationMovements: [],
    customerDocuments: [],
  };

  localDb.leads.push({
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
        totalCost: 360000,
        systemSizekW: 10,
        boqRows: [
          { id: "h-1", type: "heading", name: "Solar Panels" },
          { id: "panel-1", type: "item", name: "Longi X10 panels", qty: 18, rate: 20000, total: 360000 },
        ],
      },
    ],
  });

  console.log("\n1) Contract lead → invoice");
  const provision = await provisionContractToInvoiceWorkflow(localDb.leads[0], localDb, {
    quotationId: quoteId,
    actor: ACTOR,
  });
  check("invoice created", !!provision.invoiceId);
  localDb.users.find((u) => u.id === PORTAL.userId).customerId = provision.customerId;

  const invoice = await invoiceDb.getAdminInvoiceById(ACTOR.userId, ACTOR.username, ACTOR.role, provision.invoiceId, localDb);
  const panelLine = invoice.items[0];
  const panelItemId = panelLine.id;
  const panelQty = Number(panelLine.qty || 18);

  console.log("\n2) Create Delivery #1 — panels");
  const { challan: ch1 } = await delivery.createAdminDeliveryChallan(ACTOR.userId, ACTOR.username, ACTOR.role, {
    invoiceId: provision.invoiceId,
    deliveryTitle: "Delivery #1 — Panels",
    items: [{ invoiceItemId: panelItemId, itemName: panelLine.itemName, invoiceQty: panelQty, deliverNowQty: 10, inventoryItemId: inventoryPanelId }],
  }, localDb);
  check("verification token generated", !!ch1.verificationToken);
  check("token expiry set", !!ch1.tokenExpiresAt);

  const info = await delivery.getAdminDeliveryVerificationInfo(ACTOR.userId, ACTOR.username, ACTOR.role, ch1.id, localDb);
  const verificationUrl = buildDeliveryVerificationUrl(info.challan.verificationToken);
  check("verification URL built", verificationUrl.includes("/delivery/verify/"));

  const waMsg = buildWhatsAppVerificationMessage({
    customerName: invoice.customerName,
    invoiceNumber: invoice.invoiceNumber,
    challanNumber: ch1.challanNumber,
    verificationUrl,
  });
  check("WhatsApp message includes link", waMsg.includes(verificationUrl));
  check("WhatsApp message includes challan", waMsg.includes(ch1.challanNumber));

  console.log("\n3) Public page load (no login)");
  const page1 = await delivery.getPublicDeliveryVerificationPage(info.challan.verificationToken, localDb);
  check("public access pending", page1.access === "pending");
  check("public hides otp", page1.challan.otpCode == null);

  console.log("\n4-8) Public OTP + signature + photo + verify");
  await delivery.updateAdminDeliveryChallanStatus(ACTOR.userId, ACTOR.username, ACTOR.role, ch1.id, "out_for_delivery", localDb);
  await delivery.updateAdminDeliveryChallanStatus(ACTOR.userId, ACTOR.username, ACTOR.role, ch1.id, "delivered_pending_verification", localDb);

  const { otp } = await delivery.sendPublicDeliveryOtp(info.challan.verificationToken, localDb);
  check("public OTP sent", String(otp).length === 6);
  await delivery.verifyPublicDeliveryOtp(info.challan.verificationToken, { code: otp, verifiedByPhone: "03001234567" }, localDb);
  await delivery.capturePublicDeliverySignature(info.challan.verificationToken, { signatureDataUrl: "data:image/png;base64,iVBORw0KGgo=" }, localDb);
  await delivery.uploadPublicDeliveryPhoto(info.challan.verificationToken, { photoUrl: "https://example.com/material.jpg", photoType: "material" }, localDb);

  const verified = await delivery.submitPublicDeliveryVerification(
    info.challan.verificationToken,
    {
      receiverName: "Arsalan",
      receiverPhone: "03001234567",
      receiverRelation: "owner",
      receivedMaterial: true,
      quantityCorrect: true,
      conditionAcceptable: true,
    },
    { ip: "127.0.0.1", userAgent: "verify-script" },
    localDb
  );
  check("verified received", verified.challan.status === "verified_received");
  check("public status verified", verified.challan.publicVerificationStatus === "verified");
  check("verified IP stored", verified.challan.verifiedIp === "127.0.0.1");

  console.log("\n9-11) Certificate + invoice summary + portal");
  const certHtml = await delivery.renderPublicDeliveryCertificate(info.challan.verificationToken, localDb);
  check("certificate generated", certHtml.includes("confirm"));
  check("customer document synced", (localDb.customerDocuments || []).some((d) => d.documentType === "material_delivery_certificate"));

  const { summary } = await delivery.getInvoiceDeliverySummaryAdmin(ACTOR.userId, ACTOR.username, ACTOR.role, provision.invoiceId, localDb);
  check("invoice delivery summary updated", summary.verifiedCount === 1);

  const portal = await delivery.fetchCustomerPortalDeliveriesMe(PORTAL.userId, PORTAL.username, localDb);
  check("portal shows challan", portal.deliveries.some((d) => d.id === ch1.id));

  console.log("\n12) Challan PDF HTML includes QR");
  const challanHtml = await delivery.renderDeliveryChallanHtml(ch1.id, localDb);
  check("challan PDF has QR", challanHtml.includes("qrserver.com"));
  check("challan PDF has verify text", challanHtml.includes("Scan this QR code"));

  console.log("\n13-16) Delivery #2 + public dispute");
  const { challan: ch2 } = await delivery.createAdminDeliveryChallan(ACTOR.userId, ACTOR.username, ACTOR.role, {
    invoiceId: provision.invoiceId,
    deliveryTitle: "Delivery #2 — Inverter",
    items: [{ invoiceItemId: panelItemId, itemName: "Inverter unit", invoiceQty: panelQty, deliverNowQty: 4 }],
  }, localDb);
  const info2 = await delivery.getAdminDeliveryVerificationInfo(ACTOR.userId, ACTOR.username, ACTOR.role, ch2.id, localDb);
  await delivery.updateAdminDeliveryChallanStatus(ACTOR.userId, ACTOR.username, ACTOR.role, ch2.id, "delivered_pending_verification", localDb);

  const lineId = ch2.items[0].id;
  const disputed = await delivery.disputePublicDeliveryChallan(
    info2.challan.verificationToken,
    { comments: "Inverter box damaged", items: [{ itemId: lineId, itemName: ch2.items[0].itemName, issueType: "damaged" }] },
    { ip: "127.0.0.2", userAgent: "verify-script" },
    localDb
  );
  check("ch2 disputed", disputed.challan.status === "disputed");
  check("public dispute status", disputed.challan.publicVerificationStatus === "disputed");

  console.log("\n17) Verified challan locked on public");
  let locked = false;
  try {
    await delivery.sendPublicDeliveryOtp(info.challan.verificationToken, localDb);
  } catch (e) {
    locked = String(e.message || "").includes("verified");
  }
  check("verified token read-only", locked);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
