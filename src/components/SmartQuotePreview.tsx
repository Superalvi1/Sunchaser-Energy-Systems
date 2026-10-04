import React, { useRef, useState } from "react";
import type { Lead } from "../types";
import AppModal from "./ui/AppModal";
import { formatLeadReceivedAt, parseSmartQuoteLeadNotes, quoteSnapshot, parseSmartQuotePdfArchive } from "../lib/smartQuoteLead";

export default function SmartQuotePreview({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const summary = parseSmartQuoteLeadNotes(lead.notes);
  const archive = parseSmartQuotePdfArchive(lead.notes);
  const snapshot = quoteSnapshot(lead.notes);
  const money = (n: number) => `PKR ${Math.round(n).toLocaleString("en-PK")}`;
  const download = async (kind: "pdf" | "png") => {
    if (!ref.current) return;
    setBusy(true); setError("");
    try {
      const { default: html2canvas } = await import("html2canvas-pro");
      const canvas = await html2canvas(ref.current, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
      if (kind === "pdf") {
        const { jsPDF } = await import("jspdf");
        const pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height], orientation: canvas.width > canvas.height ? "landscape" : "portrait" });
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
        pdf.save(`${summary?.quoteNumber || "quotation"}.pdf`);
      } else {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Image export failed"))));
        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${summary?.quoteNumber || "quotation"}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Download failed"); }
    finally { setBusy(false); }
  };
  return <AppModal open onClose={onClose} panelClassName="max-w-4xl w-full p-5"><button onClick={onClose} className="mb-3">Close quotation</button>
    <div className="space-y-3">
      {archive && <a href={archive.fileUrl} target="_blank" rel="noopener noreferrer" download={archive.fileName} className="block rounded-xl border border-emerald-400/40 bg-emerald-500/15 p-3 text-emerald-200">Open / download original client PDF (includes cover)</a>}
      <div className="flex gap-3"><button disabled={busy} onClick={() => download("pdf")}>Download preview PDF</button><button disabled={busy} onClick={() => download("png")}>Download picture</button></div>
      {error && <p role="alert">{error}</p>}
      <div className="overflow-auto"><div ref={ref} style={{ background: "white", color: "#172033", padding: 24, minWidth: 550, fontFamily: "Arial" }}>
        <h2>Sunchaser Energy Systems</h2><h3>Client quotation · {summary?.quoteNumber}</h3>
        <p>{lead.name} · {lead.phone} · {lead.location}</p><p>Received: {formatLeadReceivedAt(lead.createdAt)}</p>
        <p>{summary?.system} · Client-submitted estimate</p>
        {snapshot ? <><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Item / specification", "Qty", "Unit price", "Amount"].map(t => <th key={t} style={{ textAlign: "left", padding: 8 }}>{t}</th>)}</tr></thead><tbody>{snapshot.lines.map((line, i) => <tr key={i}><td style={{ padding: 8, borderBottom: "1px solid #ddd" }}>{line.description}<br/><small>{line.specification}</small></td><td>{line.quantity} {line.unit}</td><td>{money(line.unitPricePkr)}</td><td>{money(line.totalPkr)}</td></tr>)}</tbody></table><p>Subtotal: {money(snapshot.subtotalPkr)} · Discount: {money(snapshot.discountPkr)}</p></> : <><p>Historical summary only. The original itemized quotation was not saved.</p>{[summary?.panel, summary?.inverter, summary?.battery, summary?.structure].map((text, i) => <p key={i}>{text}</p>)}</>}
        <h3>Total estimate: {money(summary?.estimatePkr || 0)}</h3>
      </div></div>
    </div>
  </AppModal>;
}
