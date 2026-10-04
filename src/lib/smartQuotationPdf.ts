import type { PublicQuoteLine } from "./publicQuotationBuilder";
import type { jsPDF } from "jspdf";

export type SmartQuotationPdfData = {
  quoteNumber: string; system: string; generatedAt: string;
  clientName: string; clientPhone: string; clientCity: string;
  lines: PublicQuoteLine[]; subtotalPkr: number; discountPkr: number; totalPkr: number;
  logoDataUrl?: string;
};
const navy = "#0f172a", gold = "#fbbf24", ink = "#172033", muted = "#64748b";
const money = (n: number) => `PKR ${Math.round(n).toLocaleString("en-PK")}`;
export async function loadQuotationLogo() {
  const res = await fetch("/assets/sunchaser-logo.png");
  if (!res.ok) throw new Error("Could not load the Sunchaser logo. Please retry.");
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not load quotation logo.")); reader.readAsDataURL(blob);
  });
}
export async function buildSmartQuotationPdf(data: SmartQuotationPdfData): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  pdf.setProperties({ title: `${data.system} Solar Proposal - ${data.quoteNumber}`, author: "Sunchaser Energy Systems", subject: "Client solar system quotation" });
  const text = (value: string | string[], x: number, y: number, size = 11, color = ink, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(color); pdf.text(value, x, y);
  };
  const date = new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium" }).format(new Date(data.generatedAt));
  // Dedicated front cover; all pricing/BOQ starts on the next page.
  pdf.setFillColor(navy); pdf.rect(0, 0, 210, 297, "F");
  pdf.setFillColor(gold); pdf.rect(0, 0, 210, 5, "F"); pdf.rect(16, 88, 28, 2, "F");
  if (data.logoDataUrl) { pdf.setFillColor("#ffffff"); pdf.roundedRect(16, 19, 31, 31, 2, 2, "F"); pdf.addImage(data.logoDataUrl, "PNG", 18, 21, 27, 27); }
  text("SUNCHASER", data.logoDataUrl ? 55 : 16, 30, 24, "#ffffff", true);
  text("Energy Systems", data.logoDataUrl ? 55 : 16, 40, 15, gold, true);
  text("SOLAR SYSTEM PROPOSAL", 16, 75, 12, gold, true);
  text(pdf.splitTextToSize(`${data.system} Solar System`, 175), 16, 110, 31, "#ffffff", true);
  text("Technical & Financial Quotation", 16, 132, 15, "#cbd5e1");
  text("PREPARED FOR", 16, 162, 9, gold, true);
  pdf.setFontSize(data.clientName.length > 65 ? 13 : 18); text(pdf.splitTextToSize(data.clientName || "Valued Client", 175), 16, 175, data.clientName.length > 65 ? 13 : 18, "#ffffff", true);
  pdf.setFontSize(10); text(pdf.splitTextToSize(`${data.clientPhone || ""}${data.clientCity ? `  |  ${data.clientCity}` : ""}`, 175), 16, 195, 10, "#cbd5e1");
  text("PREPARED BY", 16, 214, 9, gold, true);
  text("Sunchaser Energy Systems", 16, 226, 17, "#ffffff", true);
  text(`${data.quoteNumber}  |  ${date}`, 16, 242, 10, "#cbd5e1");
  text("www.sunchaserenergy.co", 16, 265, 11, gold);
  text("0330-7776444  |  0309-0236666", 16, 275, 10, "#ffffff");
  text("Professional solar design, installation and after-sales support", 16, 286, 8, "#cbd5e1");

  let y = 0;
  const detailPage = () => {
    pdf.addPage(); pdf.setFillColor(navy); pdf.rect(0, 0, 210, 31, "F"); pdf.setFillColor(gold); pdf.rect(0, 31, 210, 2, "F");
    text("Sunchaser Energy Systems", 14, 13, 15, "#ffffff", true);
    text(`${data.system} | ${data.quoteNumber} | ${date}`, 14, 24, 9, "#cbd5e1");
    text("BILL OF QUANTITIES", 14, 43, 12, ink, true);
    pdf.setFillColor("#e2e8f0"); pdf.rect(14, 44, 182, 8, "F");
    text("Item / specification", 17, 49.5, 9, ink, true); text("Quantity", 113, 49.5, 9, ink, true); text("Unit price", 141, 49.5, 9, ink, true); text("Amount", 174, 49.5, 9, ink, true);
    y = 57;
  };
  detailPage();
  let lastCategory = "";
  const orderedLines = (["Equipment", "Cables & protection", "Structure", "Services"] as const).flatMap(category => data.lines.filter(line => line.category === category));
  for (const line of orderedLines) {
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
    const description: string[] = pdf.splitTextToSize(line.description, 91);
    const spec: string[] = pdf.splitTextToSize(line.specification || "", 91);
    const rowHeight = Math.max(9, (description.length + spec.length) * 3.4 + 2);
    const needsCategory = lastCategory !== line.category;
    if (y + rowHeight + (needsCategory ? 7 : 0) > 267) { detailPage(); lastCategory = ""; }
    if (lastCategory !== line.category) {
      pdf.setFillColor("#fef3c7"); pdf.rect(14, y - 3, 182, 6, "F"); text(line.category.toUpperCase(), 17, y + 2, 8, "#92400e", true); y += 7; lastCategory = line.category;
    }
    text(description, 17, y, 9, ink, true); text(spec, 17, y + description.length * 3.4, 8, muted);
    text(`${line.quantity} ${line.unit}`, 113, y, 8); text(money(line.unitPricePkr), 141, y, 8); text(line.totalPkr === 0 ? "Included" : money(line.totalPkr), 174, y, 8, ink, true);
    pdf.setDrawColor("#dbe3ee"); pdf.line(14, y + rowHeight - 4, 196, y + rowHeight - 4); y += rowHeight;
  }
  if (y + 51 > 275) { pdf.addPage(); y = 25; }
  text(`Subtotal: ${money(data.subtotalPkr)}`, 115, y + 5, 10);
  text(`Discount: ${money(data.discountPkr)}`, 115, y + 12, 10, "#047857");
  pdf.setFillColor(navy); pdf.roundedRect(14, y + 18, 182, 13, 2, 2, "F");
  text("FINAL ESTIMATED COST", 19, y + 26, 10, "#ffffff", true); text(money(data.totalPkr), 132, y + 26, 14, gold, true);
  pdf.setFontSize(9);
  text(pdf.splitTextToSize("Estimate valid for 3 days and subject to site survey, stock availability and final technical approval. Unlisted civil work is excluded.", 182), 14, y + 39, 9, muted);
  text("Payment: Advance booking and milestone payments as agreed in the final sales contract.", 14, y + 50, 8, muted);
  for (let page = 2; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page); pdf.setFontSize(8); text(pdf.splitTextToSize(`Prepared for ${data.clientName || "Valued Client"}`, 145)[0], 14, 283, 8, muted); text(`${page} / ${pdf.getNumberOfPages()}`, 180, 283, 8, muted);
  }
  return pdf;
}
