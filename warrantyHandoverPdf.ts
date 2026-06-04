import type { CompanyBranding } from "./src/lib/branding.ts";
import { mediaLabel } from "./src/lib/projectCompletion.ts";

function esc(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const fmt = (n: number) => "Rs. " + Math.round(n || 0).toLocaleString("en-PK");

export function compileWarrantyHandoverPDFHtml(
  data: {
    delivery: any;
    customer: { name: string; phone?: string; address?: string };
    system: any;
    items: any[];
    installed: any[];
    media: any[];
  },
  branding: CompanyBranding
) {
  const d = data.delivery;
  const company = branding.companyName;
  const logo = branding.logoUrl || "/sunchaser-logo.svg";
  const primary = branding.primaryColor || "#f59e0b";

  const panels = data.items.filter((i) => String(i.item_category || i.itemCategory || "").toLowerCase().includes("panel"));
  const inverters = data.items.filter((i) => String(i.item_category || i.itemCategory || "").toLowerCase().includes("inverter"));
  const batteries = data.items.filter((i) => String(i.item_category || i.itemCategory || "").toLowerCase().includes("battery"));

  const serialRows = data.media
    .filter((m) => String(m.mediaType || m.media_type || "").includes("serial"))
    .map(
      (m) =>
        `<tr><td>${esc(mediaLabel(m.mediaType || m.media_type))}</td><td>${esc(m.serialNumber || m.serial_number || "—")}</td><td><a href="${esc(m.fileUrl || m.file_url)}">View photo</a></td></tr>`
    )
    .join("");

  const installedRows = data.installed
    .map(
      (eq) =>
        `<tr><td>${esc(eq.equipment_type || eq.equipmentType)}</td><td>${esc(eq.brand)}</td><td>${esc(eq.model)}</td><td>${esc(eq.serial_number || eq.serialNumber || "—")}</td></tr>`
    )
    .join("");

  const installDate =
    d.installation_completed_date || d.installationCompletedDate || new Date().toISOString().slice(0, 10);
  const wStart = d.warranty_start_date || d.warrantyStartDate || installDate;
  const wEnd = d.warranty_end_date || d.warrantyEndDate || "—";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Warranty Handover — ${esc(d.project_title || d.projectTitle)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: Inter, sans-serif; color: #0f172a; margin: 0; padding: 24px; font-size: 11px; }
    .wrap { max-width: 210mm; margin: 0 auto; border: 1px solid #e2e8f0; padding: 28px; border-radius: 8px; }
    .head { border-bottom: 3px solid ${primary}; padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; }
    .logo { height: 52px; }
    h1 { margin: 0; font-size: 20px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin-bottom: 16px; }
    h3 { margin: 0 0 8px; font-size: 10px; text-transform: uppercase; color: ${primary}; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; }
    th { background: #0f172a; color: #fff; padding: 6px; text-align: left; }
    td { border-bottom: 1px solid #e2e8f0; padding: 6px; }
    .sig { margin-top: 48px; display: flex; justify-content: space-between; }
    .sig-line { border-top: 1px solid #94a3b8; width: 200px; padding-top: 6px; font-size: 9px; color: #64748b; }
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
      <div style="text-align:right;font-size:10px">
        <strong style="font-size:14px">WARRANTY HANDOVER CERTIFICATE</strong><br/>
        Project: ${esc(d.project_title || d.projectTitle)}<br/>
        Date: ${esc(installDate)}
      </div>
    </div>
    <div class="box">
      <h3>Customer</h3>
      <div><strong>${esc(data.customer.name)}</strong></div>
      <div>${esc(data.customer.phone || "")}</div>
      <div>${esc(data.customer.address || "")}</div>
    </div>
    <div class="box">
      <h3>System details</h3>
      <div>System type: ${esc(d.system_type || d.systemType || "—")} · ${esc(d.system_size_kw || d.systemSizeKw || "")} kW</div>
      ${data.system ? `<div>Panels: ${esc(data.system.panelBrand || "")} × ${esc(String(data.system.panelQuantity || ""))} · Inverter: ${esc(data.system.inverterBrand || "")}</div>` : ""}
      <div>Installation address: ${esc(d.installation_address || d.installationAddress || "")}</div>
    </div>
    <div class="box">
      <h3>Equipment summary</h3>
      <table>
        <thead><tr><th>Panels</th><th>Brand</th><th>Qty</th><th>Spec</th></tr></thead>
        <tbody>
          ${panels.map((p) => `<tr><td>Panels</td><td>${esc(p.brand)}</td><td>${esc(String(p.quantity))}</td><td>${esc(p.wattage || p.capacity || "")}</td></tr>`).join("") || "<tr><td colspan='4'>—</td></tr>"}
        </tbody>
      </table>
      <table>
        <thead><tr><th>Inverter</th><th>Brand</th><th>Model</th><th>Capacity</th></tr></thead>
        <tbody>
          ${inverters.map((p) => `<tr><td>Inverter</td><td>${esc(p.brand)}</td><td>${esc(p.model)}</td><td>${esc(p.capacity || "")}</td></tr>`).join("") || "<tr><td colspan='4'>—</td></tr>"}
        </tbody>
      </table>
      ${
        batteries.length
          ? `<table><thead><tr><th>Battery</th><th>Brand</th><th>Model</th><th>Capacity</th></tr></thead><tbody>${batteries.map((p) => `<tr><td>Battery</td><td>${esc(p.brand)}</td><td>${esc(p.model)}</td><td>${esc(p.capacity || "")}</td></tr>`).join("")}</tbody></table>`
          : "<p style='font-size:10px;color:#64748b'>Battery: Not applicable</p>"
      }
    </div>
    ${
      installedRows
        ? `<div class="box"><h3>Installed equipment registry</h3><table><thead><tr><th>Type</th><th>Brand</th><th>Model</th><th>Serial</th></tr></thead><tbody>${installedRows}</tbody></table></div>`
        : ""
    }
    <div class="box">
      <h3>Warranty period</h3>
      <div>Start: <strong>${esc(wStart)}</strong> · End: <strong>${esc(wEnd)}</strong></div>
      <div style="margin-top:6px;font-size:9px;color:#64748b">Standard coverage per Sunchaser warranty policy. Panels 25yr, inverter 5yr, battery 10yr where applicable.</div>
    </div>
    ${
      serialRows
        ? `<div class="box"><h3>Uploaded serial numbers (proof)</h3><table><thead><tr><th>Photo type</th><th>Serial</th><th>Link</th></tr></thead><tbody>${serialRows}</tbody></table></div>`
        : ""
    }
    <div class="box">
      <h3>Terms</h3>
      ${esc(branding.terms || "Warranty valid subject to proper use and Sunchaser maintenance guidelines.")}
    </div>
    <div class="sig">
      <div class="sig-line">Authorized — ${esc(company)}</div>
      <div class="sig-line">Customer signature</div>
    </div>
  </div>
</body>
</html>`;
}
