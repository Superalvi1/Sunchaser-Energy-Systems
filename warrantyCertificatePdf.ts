import type { CompanyBranding } from "./src/lib/branding.ts";
import { WARRANTY_COMPONENT_TYPES } from "./src/lib/clientPortalPhase2.ts";

function esc(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type WarrantyCertificateComponentRow = {
  label: string;
  brand: string;
  model: string;
  serial: string;
  expiry: string;
  notApplicable?: boolean;
};

export type WarrantyCertificatePayload = {
  documentId: string;
  issueDate: string;
  customerName: string;
  siteAddress: string;
  projectId: string | null;
  deliveryId: string | null;
  installationDate: string;
  components: WarrantyCertificateComponentRow[];
};

export function compileWarrantyCertificatePDFHtml(
  data: WarrantyCertificatePayload,
  branding: CompanyBranding
) {
  const company = branding.companyName;
  const logo = branding.logoUrl || "/assets/sunchaser-logo.png";
  const primary = branding.primaryColor || "#f59e0b";

  const componentRows = data.components
    .map((row) => {
      if (row.notApplicable) {
        return `<tr>
          <td>${esc(row.label)}</td>
          <td colspan="4" style="color:#64748b;font-style:italic">Not Applicable</td>
        </tr>`;
      }
      return `<tr>
        <td>${esc(row.label)}</td>
        <td>${esc(row.brand || "—")}</td>
        <td>${esc(row.model || "—")}</td>
        <td>${esc(row.serial || "—")}</td>
        <td>${esc(row.expiry || "—")}</td>
      </tr>`;
    })
    .join("");

  const projectRef = [data.deliveryId, data.projectId].filter(Boolean).join(" · ") || "—";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Warranty Certificate — ${esc(data.customerName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: Inter, sans-serif; color: #0f172a; margin: 0; padding: 24px; font-size: 11px; }
    .wrap { max-width: 210mm; margin: 0 auto; border: 1px solid #e2e8f0; padding: 28px; border-radius: 8px; }
    .head { border-bottom: 3px solid ${primary}; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; gap: 16px; }
    .logo { height: 52px; }
    h1 { margin: 0; font-size: 20px; }
    .meta { text-align: right; font-size: 10px; line-height: 1.5; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin-bottom: 16px; }
    h3 { margin: 0 0 8px; font-size: 10px; text-transform: uppercase; color: ${primary}; letter-spacing: 0.04em; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; }
    th { background: #0f172a; color: #fff; padding: 6px; text-align: left; }
    td { border-bottom: 1px solid #e2e8f0; padding: 6px; vertical-align: top; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; }
    @media print { body { padding: 0; } .wrap { border: none; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div>
        <img class="logo" src="${esc(logo)}" alt="${esc(company)}"/>
        <h1>${esc(company)}</h1>
        <div style="font-size:10px;color:#64748b">${esc(branding.officeAddress)}</div>
        <div style="font-size:10px;color:#64748b">${esc(branding.phoneNumbers)}</div>
      </div>
      <div class="meta">
        <strong style="font-size:14px;display:block;margin-bottom:6px">WARRANTY CERTIFICATE</strong>
        Document ID: ${esc(data.documentId)}<br/>
        Issue date: ${esc(data.issueDate)}
      </div>
    </div>

    <div class="box">
      <h3>Customer &amp; site</h3>
      <div><strong>${esc(data.customerName)}</strong></div>
      <div>${esc(data.siteAddress || "—")}</div>
    </div>

    <div class="box">
      <h3>Installation</h3>
      <div>Project / delivery: ${esc(projectRef)}</div>
      <div>Installation completion date: ${esc(data.installationDate || "—")}</div>
    </div>

    <div class="box">
      <h3>Warranty coverage</h3>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Brand</th>
            <th>Model</th>
            <th>Serial</th>
            <th>Warranty expiry</th>
          </tr>
        </thead>
        <tbody>
          ${componentRows || "<tr><td colspan='5'>—</td></tr>"}
        </tbody>
      </table>
    </div>

    <p style="font-size:10px;color:#475569;line-height:1.5;margin:16px 0 0">
      This certificate confirms registered warranty coverage for the installed solar energy system components listed above,
      subject to manufacturer and workmanship terms issued by ${esc(company)}.
    </p>

    <div class="footer">
      <span>${esc(company)} · Warranty Certificate</span>
      <span>${esc(data.documentId)}</span>
    </div>
  </div>
</body>
</html>`;
}

export function buildCertificateComponentRows(
  byType: Partial<Record<string, { brand?: string | null; model?: string | null; serialNumber?: string | null; endDate?: string | null }>>
): WarrantyCertificateComponentRow[] {
  return WARRANTY_COMPONENT_TYPES.map((slot) => {
    const w = byType[slot.type];
    if (slot.type === "battery" && !w) {
      return { label: slot.label, brand: "", model: "", serial: "", expiry: "", notApplicable: true };
    }
    if (!w) {
      return { label: slot.label, brand: "—", model: "—", serial: "—", expiry: "—" };
    }
    return {
      label: slot.label,
      brand: w.brand || "—",
      model: w.model || "—",
      serial: w.serialNumber || "—",
      expiry: w.endDate || "—",
    };
  });
}
