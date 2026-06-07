import React, { useEffect, useState } from "react";
import { Loader2, Upload, Save, FileText } from "lucide-react";
import type { User } from "../types";
import {
  fetchCustomerAccounts,
  fetchCustomerSystem,
  saveCustomerSystem,
  fetchAdminCustomerDocumentsList,
} from "../services/api";
import { DOCUMENT_WALLET_TYPES } from "../lib/clientPortalPhase2";
import CustomerDocumentUploader from "./CustomerDocumentUploader";
import CustomerInvitationPanel from "./CustomerInvitationPanel";

interface CustomerProfileStaffProps {
  staffUser: User;
}

const emptySystem = {
  systemSizeKw: "",
  systemType: "",
  panelBrand: "",
  panelWattage: "",
  panelQuantity: "",
  inverterBrand: "",
  inverterSizeKw: "",
  batteryBrand: "",
  batteryCapacityKwh: "",
  structureType: "",
  installationDate: "",
  warrantyStart: "",
  warrantyEnd: "",
  netMeteringStatus: "",
  meterNumber: "",
  consumerNumber: "",
  sanctionedLoadKw: "",
  siteAddress: "",
  notes: "",
};

export default function CustomerProfileStaff({ staffUser }: CustomerProfileStaffProps) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [system, setSystem] = useState<any>(emptySystem);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [docType, setDocType] = useState(DOCUMENT_WALLET_TYPES[0].type);
  const [docTitle, setDocTitle] = useState("");
  const [visibleToCustomer, setVisibleToCustomer] = useState(true);
  const [internalOnly, setInternalOnly] = useState(false);
  const [docNotes, setDocNotes] = useState("");

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const data = await fetchCustomerAccounts(staffUser);
      setAccounts(data.accounts || []);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomer = async (acc: any) => {
    setSelected(acc);
    setMsg(null);
    try {
      const [sys, docs] = await Promise.all([
        fetchCustomerSystem(staffUser, acc.customerId),
        fetchAdminCustomerDocumentsList(staffUser, acc.customerId),
      ]);
      const s = sys.system || { customerId: acc.customerId };
      setSystem({
        systemSizeKw: s.systemSizeKw ?? "",
        systemType: s.systemType ?? "",
        panelBrand: s.panelBrand ?? "",
        panelWattage: s.panelWattage ?? "",
        panelQuantity: s.panelQuantity ?? "",
        inverterBrand: s.inverterBrand ?? "",
        inverterSizeKw: s.inverterSizeKw ?? "",
        batteryBrand: s.batteryBrand ?? "",
        batteryCapacityKwh: s.batteryCapacityKwh ?? "",
        structureType: s.structureType ?? "",
        installationDate: s.installationDate ?? "",
        warrantyStart: s.warrantyStart ?? "",
        warrantyEnd: s.warrantyEnd ?? "",
        netMeteringStatus: s.netMeteringStatus ?? "",
        meterNumber: s.meterNumber ?? "",
        consumerNumber: s.consumerNumber ?? "",
        sanctionedLoadKw: s.sanctionedLoadKw ?? "",
        siteAddress: s.siteAddress ?? "",
        notes: s.notes ?? "",
      });
      setDocuments(docs.documents || []);
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, [staffUser.id]);

  const saveSystem = async () => {
    if (!selected?.customerId) return;
    try {
      await saveCustomerSystem(staffUser, {
        customerId: selected.customerId,
        ...system,
        systemSizeKw: system.systemSizeKw ? Number(system.systemSizeKw) : null,
        panelWattage: system.panelWattage ? Number(system.panelWattage) : null,
        panelQuantity: system.panelQuantity ? Number(system.panelQuantity) : null,
        inverterSizeKw: system.inverterSizeKw ? Number(system.inverterSizeKw) : null,
        batteryCapacityKwh: system.batteryCapacityKwh ? Number(system.batteryCapacityKwh) : null,
        sanctionedLoadKw: system.sanctionedLoadKw ? Number(system.sanctionedLoadKw) : null,
      });
      setMsg("System profile saved.");
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  if (loading) return <Loader2 className="h-8 w-8 animate-spin text-amber-500" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className="lg:col-span-1 space-y-2 max-h-[70vh] overflow-y-auto">
        <p className="text-xs text-slate-500 font-mono uppercase">Customer accounts</p>
        {accounts.map((a) => (
          <button
            key={a.userId}
            type="button"
            onClick={() => loadCustomer(a)}
            className={`w-full text-left p-3 rounded-xl border text-sm ${
              selected?.userId === a.userId
                ? "border-amber-500 bg-amber-500/10"
                : "border-slate-800 bg-slate-950"
            }`}
          >
            <span className="font-bold text-white block">{a.name}</span>
            <span className="text-[10px] text-slate-500 font-mono">@{a.username}</span>
          </button>
        ))}
      </div>

      <div className="lg:col-span-3 space-y-6">
        {msg && <p className="text-xs text-amber-400 font-mono">{msg}</p>}
        {!selected ? (
          <p className="text-sm text-slate-500">
            Select a customer (e.g. Shafiq) to add system details, quotations, and agreements.
          </p>
        ) : (
          <>
            <h3 className="text-lg font-bold text-white">
              {selected.name} — <span className="text-slate-500 font-mono text-sm">{selected.customerId}</span>
            </h3>

            <CustomerInvitationPanel
              customerName={selected.name}
              customerCode={selected.customerCode}
              phone={selected.phone}
            />

            <section className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h4 className="text-sm font-bold text-amber-400">Installed system</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <input placeholder="System size (kW)" value={system.systemSizeKw} onChange={(e) => setSystem({ ...system, systemSizeKw: e.target.value })} className="input-cell" />
                <select value={system.systemType} onChange={(e) => setSystem({ ...system, systemType: e.target.value })} className="input-cell">
                  <option value="">System type</option>
                  <option value="On-grid">On-grid</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="Off-grid">Off-grid</option>
                </select>
                <input placeholder="Panel brand" value={system.panelBrand} onChange={(e) => setSystem({ ...system, panelBrand: e.target.value })} className="input-cell" />
                <input placeholder="Panel wattage" value={system.panelWattage} onChange={(e) => setSystem({ ...system, panelWattage: e.target.value })} className="input-cell" />
                <input placeholder="Panel qty" value={system.panelQuantity} onChange={(e) => setSystem({ ...system, panelQuantity: e.target.value })} className="input-cell" />
                <input placeholder="Inverter brand" value={system.inverterBrand} onChange={(e) => setSystem({ ...system, inverterBrand: e.target.value })} className="input-cell" />
                <input placeholder="Inverter size (kW)" value={system.inverterSizeKw} onChange={(e) => setSystem({ ...system, inverterSizeKw: e.target.value })} className="input-cell" />
                <input placeholder="Battery brand" value={system.batteryBrand} onChange={(e) => setSystem({ ...system, batteryBrand: e.target.value })} className="input-cell" />
                <input placeholder="Battery capacity (kWh)" value={system.batteryCapacityKwh} onChange={(e) => setSystem({ ...system, batteryCapacityKwh: e.target.value })} className="input-cell" />
                <input placeholder="Structure type" value={system.structureType} onChange={(e) => setSystem({ ...system, structureType: e.target.value })} className="input-cell" />
                <input type="date" value={system.installationDate} onChange={(e) => setSystem({ ...system, installationDate: e.target.value })} className="input-cell" />
                <input type="date" placeholder="Warranty start" value={system.warrantyStart} onChange={(e) => setSystem({ ...system, warrantyStart: e.target.value })} className="input-cell" />
                <input type="date" placeholder="Warranty end" value={system.warrantyEnd} onChange={(e) => setSystem({ ...system, warrantyEnd: e.target.value })} className="input-cell" />
                <input placeholder="Net metering status" value={system.netMeteringStatus} onChange={(e) => setSystem({ ...system, netMeteringStatus: e.target.value })} className="input-cell" />
                <input placeholder="Meter number" value={system.meterNumber} onChange={(e) => setSystem({ ...system, meterNumber: e.target.value })} className="input-cell" />
                <input placeholder="Consumer number" value={system.consumerNumber} onChange={(e) => setSystem({ ...system, consumerNumber: e.target.value })} className="input-cell" />
                <input placeholder="Sanctioned load (kW)" value={system.sanctionedLoadKw} onChange={(e) => setSystem({ ...system, sanctionedLoadKw: e.target.value })} className="input-cell" />
                <input placeholder="Site address" value={system.siteAddress} onChange={(e) => setSystem({ ...system, siteAddress: e.target.value })} className="md:col-span-2 input-cell" />
                <textarea placeholder="Notes" value={system.notes} onChange={(e) => setSystem({ ...system, notes: e.target.value })} className="md:col-span-2 input-cell min-h-[60px]" />
              </div>
              <button type="button" onClick={saveSystem} className="flex items-center gap-2 bg-amber-500 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl">
                <Save className="h-4 w-4" /> Save system profile
              </button>
            </section>

            <section className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h4 className="text-sm font-bold text-amber-400 flex items-center gap-2">
                <Upload className="h-4 w-4" /> Assign quotation / agreement
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <select value={docType} onChange={(e) => setDocType(e.target.value)} className="input-cell">
                  {DOCUMENT_WALLET_TYPES.map((d) => (
                    <option key={d.type} value={d.type}>{d.label}</option>
                  ))}
                </select>
                <input placeholder="Title" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} className="input-cell" />
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={visibleToCustomer} onChange={(e) => setVisibleToCustomer(e.target.checked)} />
                  Visible to customer
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={internalOnly} onChange={(e) => setInternalOnly(e.target.checked)} />
                  Internal only
                </label>
                <input placeholder="Notes" value={docNotes} onChange={(e) => setDocNotes(e.target.value)} className="md:col-span-2 input-cell" />
                <CustomerDocumentUploader
                  staffUser={staffUser}
                  customerId={selected.customerId}
                  documentType={docType}
                  title={docTitle}
                  visibleToCustomer={visibleToCustomer}
                  internalOnly={internalOnly}
                  notes={docNotes}
                  onSuccess={async () => {
                    setMsg("Document uploaded and linked.");
                    setDocNotes("");
                    setDocTitle("");
                    await loadCustomer(selected);
                  }}
                />
              </div>
            </section>

            <section>
              <h4 className="text-sm font-bold text-slate-400 mb-2">Linked documents</h4>
              <ul className="space-y-2">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-xs bg-slate-900 border border-slate-800 rounded-xl p-3">
                    <FileText className="h-4 w-4 text-amber-500" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-white truncate">{d.title}</p>
                      <p className="text-slate-500">{d.documentType} · {d.visibleToCustomer ? "Customer visible" : "Internal"}</p>
                    </div>
                    <a href={d.fileUrl} download target="_blank" rel="noreferrer" className="text-amber-400 font-bold">Download</a>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
      <style>{`.input-cell { width:100%; background:#020617; border:1px solid #1e293b; border-radius:0.75rem; padding:0.5rem 0.75rem; color:#f1f5f9; }`}</style>
    </div>
  );
}
