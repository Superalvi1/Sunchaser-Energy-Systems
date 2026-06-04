import React, { useEffect, useState } from "react";
import { Headphones, Loader2, Filter } from "lucide-react";
import { User } from "../types";
import { listAdminSupportTickets, updateAdminSupportTicket } from "../services/api";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  type SupportTicketRecord,
} from "../lib/clientPortalSupport";
import { resolveLeadPhoneFromLeads } from "../lib/whatsapp";
import WhatsAppModule from "./WhatsAppModule";
import { Lead } from "../types";

interface SupportDeskStaffProps {
  staffUser: User;
  leads?: Lead[];
}

export default function SupportDeskStaff({ staffUser, leads = [] }: SupportDeskStaffProps) {
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SupportTicketRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [status, setStatus] = useState("");
  const [technician, setTechnician] = useState("");
  const [scheduledVisit, setScheduledVisit] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listAdminSupportTickets(staffUser.id, staffUser.username, {
        status: statusFilter || undefined,
        category: categoryFilter || undefined,
        priority: priorityFilter || undefined,
      });
      setTickets(data.tickets || []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [staffUser.id, staffUser.username, statusFilter, categoryFilter, priorityFilter]);

  const selectTicket = (t: SupportTicketRecord) => {
    setSelected(t);
    setStatus(t.status);
    setTechnician(t.assignedTechnician || "");
    setScheduledVisit(t.scheduledVisitDate || "");
    setResolution(t.resolutionSummary || "");
    setCustomerNote("");
    setInternalNote("");
    setMsg(null);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    try {
      await updateAdminSupportTicket(staffUser.id, staffUser.username, selected.id, {
        status,
        assignedTechnician: technician,
        scheduledVisitDate: scheduledVisit || undefined,
        customerVisibleNote: customerNote || undefined,
        internalNote: internalNote || undefined,
        resolutionSummary: resolution || undefined,
      });
      setMsg("Ticket updated.");
      await load();
      setCustomerNote("");
      setInternalNote("");
    } catch (err: any) {
      setMsg(err.message || "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-slate-100">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Headphones className="w-5 h-5 text-amber-500" />
        Support Desk
      </h3>

      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="w-4 h-4 text-slate-500" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-lg text-xs px-2 py-1"
        >
          <option value="">All statuses</option>
          {SUPPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-lg text-xs px-2 py-1"
        >
          <option value="">All categories</option>
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-lg text-xs px-2 py-1"
        >
          <option value="">All priorities</option>
          {SUPPORT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl max-h-[480px] overflow-y-auto">
          {loading ? (
            <Loader2 className="w-6 h-6 animate-spin text-amber-500 m-6" />
          ) : tickets.length === 0 ? (
            <p className="text-sm text-slate-500 p-4">No tickets match filters.</p>
          ) : (
            <ul>
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => selectTicket(t)}
                    className={`w-full text-left p-3 border-b border-slate-800 hover:bg-slate-950 ${
                      selected?.id === t.id ? "bg-amber-950/20" : ""
                    }`}
                  >
                    <p className="text-[10px] font-mono text-amber-500">{t.ticketNumber}</p>
                    <p className="text-sm font-semibold truncate">{t.subject}</p>
                    <p className="text-[10px] text-slate-500">
                      {t.customerName} · {t.status} · {t.priority}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          {!selected ? (
            <p className="text-sm text-slate-500">Select a ticket to manage.</p>
          ) : (
            <>
              <div>
                <p className="text-[10px] font-mono text-amber-500">{selected.ticketNumber}</p>
                <p className="font-bold text-white">{selected.subject}</p>
                <p className="text-xs text-slate-400 mt-1">{selected.description}</p>
              </div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              >
                {SUPPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                placeholder="Technician name"
                value={technician}
                onChange={(e) => setTechnician(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={scheduledVisit}
                onChange={(e) => setScheduledVisit(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <textarea
                placeholder="Note visible to customer"
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                rows={2}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <textarea
                placeholder="Internal note (staff only)"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                rows={2}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <textarea
                placeholder="Resolution summary"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={2}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <WhatsAppModule
                staffUser={staffUser}
                preset="support_ticket"
                phone={resolveLeadPhoneFromLeads(leads, {
                  customerId: selected.customerId,
                  email: selected.email,
                  name: selected.customerName,
                })}
                customerId={selected.customerId || undefined}
                customerName={selected.customerName}
                templateVars={{
                  customerName: selected.customerName,
                  ticketId: selected.ticketNumber,
                  ticketSubject: selected.subject,
                  ticketStatus: status,
                  date: scheduledVisit,
                  technicianName: technician,
                }}
              />
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="w-full bg-amber-500 text-slate-950 font-bold py-2 rounded-xl text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              {msg && <p className="text-xs text-amber-400 font-mono">{msg}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
