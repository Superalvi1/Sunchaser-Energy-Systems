import React, { useEffect, useState } from "react";
import { Loader2, Upload, Shield } from "lucide-react";
import { User } from "../types";
import {
  createAdminCustomerDocument,
  listAdminWarrantyClaims,
  patchAdminWarrantyClaim,
  upsertAdminCustomerWarranty,
} from "../services/api";
import { DOCUMENT_WALLET_TYPES, WARRANTY_COMPONENT_TYPES } from "../lib/clientPortalPhase2";

interface ClientPortalStaffToolsProps {
  staffUser: User;
  section?: "documents" | "warranty" | "all";
}

export default function ClientPortalStaffTools({
  staffUser,
  section = "all",
}: ClientPortalStaffToolsProps) {
  const showDocuments = section === "all" || section === "documents";
  const showWarranty = section === "all" || section === "warranty";
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [documentType, setDocumentType] = useState(DOCUMENT_WALLET_TYPES[0].type);
  const [title, setTitle] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [docMsg, setDocMsg] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  const [warrantyComponent, setWarrantyComponent] = useState(WARRANTY_COMPONENT_TYPES[0].type);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [warrantyMsg, setWarrantyMsg] = useState<string | null>(null);

  const [claims, setClaims] = useState<any[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);

  const loadClaims = async () => {
    setClaimsLoading(true);
    try {
      const data = await listAdminWarrantyClaims(staffUser.id, staffUser.username);
      setClaims(data.claims || []);
    } catch {
      setClaims([]);
    } finally {
      setClaimsLoading(false);
    }
  };

  useEffect(() => {
    loadClaims();
  }, [staffUser.id, staffUser.username]);

  const uploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setDocLoading(true);
    setDocMsg(null);
    try {
      await createAdminCustomerDocument(staffUser.id, staffUser.username, {
        customerId,
        projectId: projectId || undefined,
        documentType,
        title: title || documentType,
        fileUrl,
        uploadedBy: staffUser.name,
      });
      setDocMsg("Document linked successfully.");
      setTitle("");
      setFileUrl("");
    } catch (err: any) {
      setDocMsg(err.message || "Upload failed.");
    } finally {
      setDocLoading(false);
    }
  };

  const saveWarranty = async (e: React.FormEvent) => {
    e.preventDefault();
    setWarrantyMsg(null);
    try {
      await upsertAdminCustomerWarranty(staffUser.id, staffUser.username, {
        customerId,
        projectId: projectId || undefined,
        componentType: warrantyComponent,
        brand,
        model,
        serialNumber,
        startDate,
        endDate,
      });
      setWarrantyMsg("Warranty record saved.");
    } catch (err: any) {
      setWarrantyMsg(err.message || "Save failed.");
    }
  };

  const updateClaimStatus = async (id: string, status: string) => {
    try {
      await patchAdminWarrantyClaim(staffUser.id, staffUser.username, id, status);
      await loadClaims();
    } catch (err: any) {
      alert(err.message || "Update failed");
    }
  };

  return (
    <div className="space-y-8 text-slate-100">
      {showDocuments && (
      <>
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Upload className="w-5 h-5 text-amber-500" />
          Client Portal — Document Upload
        </h3>
        <p className="text-xs text-slate-500 font-mono mt-1">
          Link documents to a customer for the Document Wallet.
        </p>
      </div>

      <form onSubmit={uploadDocument} className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <input
          required
          placeholder="Customer ID"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <input
          placeholder="Project ID (optional)"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <select
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value as any)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        >
          {DOCUMENT_WALLET_TYPES.map((d) => (
            <option key={d.type} value={d.type}>
              {d.label}
            </option>
          ))}
        </select>
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <input
          required
          placeholder="File URL"
          value={fileUrl}
          onChange={(e) => setFileUrl(e.target.value)}
          className="md:col-span-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={docLoading}
          className="md:col-span-2 bg-amber-500 text-slate-950 font-bold py-2 rounded-xl text-sm disabled:opacity-50"
        >
          {docLoading ? "Saving…" : "Save document link"}
        </button>
        {docMsg && <p className="md:col-span-2 text-xs text-amber-400 font-mono">{docMsg}</p>}
      </form>
      </>
      )}

      {showWarranty && (
      <>
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Shield className="w-5 h-5 text-amber-500" />
          Warranty records
        </h3>
        <form onSubmit={saveWarranty} className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <select
            value={warrantyComponent}
            onChange={(e) => setWarrantyComponent(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          >
            {WARRANTY_COMPONENT_TYPES.map((w) => (
              <option key={w.type} value={w.type}>
                {w.label}
              </option>
            ))}
          </select>
          <input
            placeholder="Brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            placeholder="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            placeholder="Serial number"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="md:col-span-2 bg-slate-800 hover:bg-slate-700 font-bold py-2 rounded-xl text-sm"
          >
            Save warranty card
          </button>
          {warrantyMsg && <p className="md:col-span-2 text-xs text-amber-400 font-mono">{warrantyMsg}</p>}
        </form>
      </div>

      <div>
        <h3 className="text-lg font-bold">Warranty claims</h3>
        {claimsLoading ? (
          <Loader2 className="w-6 h-6 animate-spin text-amber-500 mt-4" />
        ) : claims.length === 0 ? (
          <p className="text-sm text-slate-500 mt-2">No warranty claims yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {claims.map((c) => (
              <li
                key={c.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap gap-2 justify-between items-start"
              >
                <div className="text-xs">
                  <p className="font-bold text-slate-200">{c.component}</p>
                  <p className="text-slate-500 font-mono">{c.customerId}</p>
                  <p className="text-slate-400 mt-1">{c.issueDescription}</p>
                  <p className="text-amber-500/80 mt-1">{c.status}</p>
                </div>
                <select
                  value={c.status}
                  onChange={(e) => updateClaimStatus(c.id, e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg text-xs px-2 py-1"
                >
                  {["New", "In Review", "Technician Assigned", "Resolved", "Rejected"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
      </>
      )}
    </div>
  );
}
