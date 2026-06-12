import type { DeliveryChallan } from "./src/lib/deliveryManagement.ts";

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fmt = (n: number) => "Rs " + Math.round(n || 0).toLocaleString("en-PK");

export function compileDeliveryCertificateHtml(input: {
  challan: DeliveryChallan;
  invoice?: { invoiceNumber?: string; customerName?: string; customerAddress?: string; projectId?: string } | null;
  branding?: { companyName?: string; logoUrl?: string; primaryColor?: string };
}) {
  const { challan, invoice, branding } = input;
  const company = branding?.companyName || "Sunchaser Energy Systems";
  const logo = branding?.logoUrl || "";
  const primary = branding?.primaryColor || "#f59e0b";
  const items = challan.items || [];
  const photos = challan.photos || [];
  const checklist = challan.verificationChecklist || {
    receivedMaterial: false,
    quantityCorrect: false,
    conditionAcceptable: false,
  };

  const itemRows = items
    .map(
      (it) => `<tr>
      <td>${esc(it.itemName)}</td>
      <td style="text-align:center">${esc(it.deliverNowQty)}</td>
      <td>${esc(it.serialNumber || "—")}</td>
      <td style="text-align:center">${esc(it.remainingQtyAfter)}</td>
    </tr>`
    )
    .join("");

  const photoList = photos
    .map((p) => `<li>${esc(p.photoType)} — ${esc(p.caption || p.photoUrl.slice(0, 60))}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Delivery Certificate — ${esc(challan.challanNumber)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; margin: 24px; font-size: 12px; }
  .header { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid ${primary}; padding-bottom: 12px; margin-bottom: 20px; }
  .header img { max-height: 56px; }
  h1 { margin: 0; font-size: 20px; color: ${primary}; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
  th { background: #f5f5f5; font-size: 10px; text-transform: uppercase; }
  .declaration { background: #fffbeb; border: 1px solid ${primary}; padding: 12px; margin: 20px 0; font-style: italic; }
  .sig { max-width: 280px; max-height: 120px; border: 1px solid #ddd; margin-top: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #ecfdf5; color: #047857; font-weight: bold; font-size: 10px; }
</style>
</head>
<body>
  <div class="header">
    ${logo ? `<img src="${esc(logo)}" alt="Logo"/>` : ""}
    <div>
      <h1>${esc(company)}</h1>
      <div>Material Delivery Certificate</div>
    </div>
  </div>

  <div class="meta">
    <div><strong>Challan #:</strong> ${esc(challan.challanNumber)}</div>
    <div><strong>Invoice #:</strong> ${esc(invoice?.invoiceNumber || "—")}</div>
    <div><strong>Project ID:</strong> ${esc(challan.projectId || invoice?.projectId || "—")}</div>
    <div><strong>Delivery Date:</strong> ${esc(challan.deliveryDate || "—")}</div>
    <div><strong>Customer:</strong> ${esc(invoice?.customerName || "—")}</div>
    <div><strong>Site Address:</strong> ${esc(invoice?.customerAddress || "—")}</div>
    <div><strong>Status:</strong> <span class="badge">${esc(challan.status)}</span></div>
    <div><strong>OTP:</strong> ${challan.otpVerifiedAt ? "Verified ✓" : "Pending"}</div>
  </div>

  <h2>Delivered Items</h2>
  <table>
    <thead><tr><th>Item</th><th>Qty Delivered</th><th>Serial #</th><th>Remaining</th></tr></thead>
    <tbody>${itemRows || "<tr><td colspan='4'>No items</td></tr>"}</tbody>
  </table>

  <h2>Receiver Verification</h2>
  <div class="meta">
    <div><strong>Name:</strong> ${esc(challan.receiverName)}</div>
    <div><strong>Phone:</strong> ${esc(challan.receiverPhone)}</div>
    <div><strong>CNIC:</strong> ${esc(challan.receiverCnic || "—")}</div>
    <div><strong>Relation:</strong> ${esc(challan.receiverRelation || "—")}</div>
    <div><strong>GPS:</strong> ${esc(challan.gpsAddress || (challan.gpsLat != null ? `${challan.gpsLat}, ${challan.gpsLng}` : "—"))}</div>
    <div><strong>Signed At:</strong> ${esc(challan.signedAt || "—")}</div>
  </div>

  ${challan.signatureImageUrl ? `<div><strong>Digital Signature</strong><br/><img class="sig" src="${esc(challan.signatureImageUrl)}" alt="Signature"/></div>` : ""}

  <h2>Photo References</h2>
  <ul>${photoList || "<li>None</li>"}</ul>

  <div class="declaration">
    “I confirm that I have received the above listed materials in the stated quantities and condition.”
    <br/><br/>
    Checklist: Material received ${checklist.receivedMaterial ? "✓" : "✗"} ·
    Quantity correct ${checklist.quantityCorrect ? "✓" : "✗"} ·
    Condition acceptable ${checklist.conditionAcceptable ? "✓" : "✗"}
  </div>

  <p style="font-size:10px;color:#666;margin-top:32px;">Generated by Sunchaser CRM · ${new Date().toISOString()}</p>
</body>
</html>`;
}
