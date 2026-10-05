import React, { useEffect, useState } from "react";
import type { User } from "../types";
import { fetchAdminCustomerDocumentsList } from "../services/api";
import { formatLeadReceivedAt } from "../lib/smartQuoteLead";

export default function CustomerDocumentList({ staffUser, customerId, quotationOnly = false, refreshVersion = 0 }: { staffUser: User; customerId: string; quotationOnly?: boolean; refreshVersion?: number }) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setDocuments([]); setError("");
    if (!customerId) return;
    setLoading(true);
    fetchAdminCustomerDocumentsList(staffUser, customerId).then(data => {
      if (active) setDocuments(data.documents || []);
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not load saved files."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [staffUser.id, staffUser.username, customerId, refreshVersion, refresh]);
  if (!customerId) return null;
  const visible = quotationOnly ? documents.filter(d => d.documentType === "quotation_pdf") : documents;
  return <div className="space-y-3">
    <div className="flex items-center justify-between"><h4 className="font-bold text-white">{quotationOnly ? "Saved quotation files" : "Saved documents"}</h4><button type="button" disabled={loading} onClick={() => setRefresh(n => n + 1)} className="rounded-lg border border-cyan-400/40 px-3 py-2 text-xs text-cyan-200">Refresh files</button></div>
    {loading ? <p role="status" className="text-sm text-slate-300">Loading saved files…</p> : error ? <p role="alert" className="text-sm text-red-300">{error}</p> : visible.length ? visible.map(doc => <div key={doc.id} className="rounded-xl border border-slate-700 bg-slate-900 p-3">
      <p className="font-semibold text-white">{doc.title || doc.fileName}</p><p className="text-xs text-cyan-200">{formatLeadReceivedAt(doc.uploadedAt)}</p>
      <a className="mt-2 inline-block rounded-lg border border-emerald-400/40 px-3 py-2 text-sm text-emerald-200" href={doc.fileUrl} target="_blank" rel="noopener noreferrer">Open / download file</a>
    </div>) : <p className="text-sm text-slate-400">{quotationOnly ? "No uploaded quotation files for this client." : "No uploaded documents for this client yet."}</p>}
  </div>;
}
