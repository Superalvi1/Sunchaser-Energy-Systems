import React, { useEffect, useState } from "react";
import { DollarSign, Loader2, MessageCircle, Save } from "lucide-react";
import { User } from "../types";
import {
  fetchAdminFinanceSummary,
  fetchAdminFinanceProjects,
  createAdminFinanceProject,
  patchAdminFinanceProject,
  fetchAdminWhatsAppLogs,
} from "../services/api";
import { canViewProjectProfit } from "../lib/projectFinance";
import WhatsAppActionButton from "./WhatsAppActionButton";

interface ProjectFinanceStaffProps {
  staffUser: User;
}

export default function ProjectFinanceStaff({ staffUser }: ProjectFinanceStaffProps) {
  const allowed = canViewProjectProfit(staffUser.role, staffUser.username);
  const [summary, setSummary] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [sumRes, list, waRes] = await Promise.all([
        fetchAdminFinanceSummary(staffUser.id, staffUser.username),
        fetchAdminFinanceProjects(staffUser.id, staffUser.username),
        fetchAdminWhatsAppLogs(staffUser.id, staffUser.username),
      ]);
      setSummary(sumRes.summary || sumRes);
      setProjects(Array.isArray(list) ? list : []);
      setLogs(waRes.logs || []);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [staffUser.id, allowed]);

  const selected = projects.find((p) => p.id === selectedId);

  useEffect(() => {
    if (!selected) {
      setDraft({});
      return;
    }
    setDraft({
      saleValue: String(selected.saleValue ?? 0),
      advanceReceived: String(selected.advanceReceived ?? 0),
      supplierCost: String(selected.supplierCost ?? 0),
      installationCost: String(selected.installationCost ?? 0),
      transportCost: String(selected.transportCost ?? 0),
      miscExpense: String(selected.miscExpense ?? 0),
      paymentStatus: selected.paymentStatus || "Unpaid",
      notes: selected.notes || "",
      customerId: selected.customerId || "",
      projectDeliveryId: selected.projectDeliveryId || "",
    });
  }, [selectedId, projects]);

  const handleCreate = async () => {
    setMsg(null);
    try {
      const row = await createAdminFinanceProject(staffUser.id, staffUser.username, {
        customerId: draft.customerId || "cust-101",
        projectDeliveryId: draft.projectDeliveryId || undefined,
        saleValue: Number(draft.saleValue || 0),
        advanceReceived: Number(draft.advanceReceived || 0),
        supplierCost: Number(draft.supplierCost || 0),
        installationCost: Number(draft.installationCost || 0),
        transportCost: Number(draft.transportCost || 0),
        miscExpense: Number(draft.miscExpense || 0),
        notes: draft.notes,
      });
      setMsg(`Created ${row.id}`);
      setSelectedId(row.id);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setMsg(null);
    try {
      await patchAdminFinanceProject(staffUser.id, staffUser.username, selectedId, {
        saleValue: Number(draft.saleValue || 0),
        advanceReceived: Number(draft.advanceReceived || 0),
        supplierCost: Number(draft.supplierCost || 0),
        installationCost: Number(draft.installationCost || 0),
        transportCost: Number(draft.transportCost || 0),
        miscExpense: Number(draft.miscExpense || 0),
        paymentStatus: draft.paymentStatus,
        notes: draft.notes,
      });
      setMsg("Saved.");
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  if (!allowed) {
    return (
      <p className="text-sm text-amber-200/80 font-mono">
        Project finance (cost &amp; profit) is restricted to Super Admin allauddin.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500 mx-auto" />
      </div>
    );
  }

  const s = summary || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-amber-500" />
        <h2 className="text-lg font-bold text-white">Project Finance</h2>
      </div>
      {msg && <p className="text-xs font-mono text-amber-300">{msg}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Total Sales", s.totalSales],
          ["Advance Received", s.totalAdvanceReceived],
          ["Balance Remaining", s.totalBalanceRemaining],
          ["Supplier Cost", s.totalSupplierCost],
          ["Installation Cost", s.totalInstallationCost],
          ["Total Expenses", s.totalExpenses],
          ["Total Profit", s.totalProfit],
          ["Profit Margin %", s.profitMarginPercent],
        ].map(([label, val]) => (
          <div key={String(label)} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-neutral-500 font-mono">{label}</p>
            <p className="text-lg font-bold text-amber-400">
              {typeof val === "number" ? val.toLocaleString() : "—"}
            </p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2">Projects</h3>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setDraft({
                customerId: "cust-101",
                saleValue: "0",
                advanceReceived: "0",
                supplierCost: "0",
                installationCost: "0",
                transportCost: "0",
                miscExpense: "0",
              });
            }}
            className="text-xs text-amber-400 mb-2"
          >
            + New finance record
          </button>
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left text-xs px-2 py-1 rounded ${
                    selectedId === p.id ? "bg-amber-500/20 text-amber-300" : "text-neutral-400 hover:bg-neutral-800"
                  }`}
                >
                  {p.id} · {p.customerId} · PKR {(p.saleValue || 0).toLocaleString()}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-white">
            {selectedId ? "Edit finance" : "New finance record"}
          </h3>
          {[
            ["customerId", "Customer ID"],
            ["projectDeliveryId", "Delivery ID"],
            ["saleValue", "Sale value"],
            ["advanceReceived", "Advance received"],
            ["supplierCost", "Supplier cost"],
            ["installationCost", "Installation cost"],
            ["transportCost", "Transport cost"],
            ["miscExpense", "Misc expense"],
          ].map(([key, label]) => (
            <label key={key} className="block text-xs">
              <span className="text-neutral-500">{label}</span>
              <input
                className="w-full mt-0.5 bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-white"
                value={draft[key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              />
            </label>
          ))}
          {selected && (
            <div className="text-xs font-mono text-emerald-400/90 space-y-1 border-t border-neutral-800 pt-2">
              <p>Balance: PKR {(selected.balanceRemaining ?? 0).toLocaleString()}</p>
              <p>Total expense: PKR {(selected.totalExpense ?? 0).toLocaleString()}</p>
              <p>Gross profit: PKR {(selected.grossProfit ?? 0).toLocaleString()}</p>
              <p>Margin: {selected.profitMarginPercent ?? 0}%</p>
              <p>Status: {selected.paymentStatus}</p>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            {selectedId ? (
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-black rounded-lg text-xs font-bold"
              >
                <Save className="w-3.5 h-3.5" /> Save
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCreate}
                className="px-3 py-1.5 bg-amber-500 text-black rounded-lg text-xs font-bold"
              >
                Create
              </button>
            )}
            <WhatsAppActionButton
              staffUser={staffUser}
              phone="923001234567"
              messageType="payment_balance_reminder"
              vars={{
                customerName: "Customer",
                balance: selected?.balanceRemaining ?? draft.saleValue,
              }}
              customerId={draft.customerId}
              projectDeliveryId={draft.projectDeliveryId}
            />
          </div>
        </div>
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
        <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-emerald-500" />
          WhatsApp log history
        </h3>
        <ul className="text-xs font-mono text-neutral-400 max-h-48 overflow-y-auto space-y-1">
          {logs.length === 0 && <li>No logs yet.</li>}
          {logs.map((l: any) => (
            <li key={l.id}>
              {l.sentAt} · {l.messageType} · {l.status} · {l.phone}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
