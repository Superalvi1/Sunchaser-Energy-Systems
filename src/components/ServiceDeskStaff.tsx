import React, { useEffect, useState } from "react";
import { Wrench, Loader2, Filter } from "lucide-react";
import { User } from "../types";
import { listAdminServiceRequests, updateAdminServiceRequest } from "../services/api";
import {
  SERVICE_TYPES,
  SERVICE_STATUSES,
  type ServiceRequestRecord,
} from "../lib/clientPortalService";
import { resolveLeadPhoneFromLeads } from "../lib/whatsapp";
import WhatsAppModule from "./WhatsAppModule";
import { Lead } from "../types";

interface ServiceDeskStaffProps {
  staffUser: User;
  leads?: Lead[];
}

export default function ServiceDeskStaff({ staffUser, leads = [] }: ServiceDeskStaffProps) {
  const [requests, setRequests] = useState<ServiceRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ServiceRequestRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [status, setStatus] = useState("");
  const [technician, setTechnician] = useState("");
  const [scheduledVisit, setScheduledVisit] = useState("");
  const [beforePhoto, setBeforePhoto] = useState("");
  const [afterPhoto, setAfterPhoto] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listAdminServiceRequests(staffUser.id, staffUser.username, {
        status: statusFilter || undefined,
      });
      setRequests(data.requests || []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [staffUser.id, staffUser.username, statusFilter]);

  const selectRequest = (r: ServiceRequestRecord) => {
    setSelected(r);
    setStatus(r.status);
    setTechnician(r.assignedTechnician || "");
    setScheduledVisit(r.scheduledVisitDate || "");
    setBeforePhoto(r.beforePhotoUrl || "");
    setAfterPhoto(r.afterPhotoUrl || "");
    setCompletionNotes(r.completionNotes || "");
    setMsg(null);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    try {
      await updateAdminServiceRequest(staffUser.id, staffUser.username, selected.id, {
        status,
        assignedTechnician: technician,
        scheduledVisitDate: scheduledVisit || undefined,
        beforePhotoUrl: beforePhoto || undefined,
        afterPhotoUrl: afterPhoto || undefined,
        completionNotes: completionNotes || undefined,
      });
      setMsg("Service request updated.");
      await load();
    } catch (err: any) {
      setMsg(err.message || "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-slate-100">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Wrench className="w-5 h-5 text-amber-500" />
        Service Management
      </h3>

      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="w-4 h-4 text-slate-500" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-lg text-xs px-2 py-1"
        >
          <option value="">All statuses</option>
          {SERVICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl max-h-[480px] overflow-y-auto">
          {loading ? (
            <Loader2 className="w-6 h-6 animate-spin text-amber-500 m-6" />
          ) : requests.length === 0 ? (
            <p className="text-sm text-slate-500 p-4">No service requests match filters.</p>
          ) : (
            <ul>
              {requests.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => selectRequest(r)}
                    className={`w-full text-left p-3 border-b border-slate-800 hover:bg-slate-950 ${
                      selected?.id === r.id ? "bg-amber-950/20" : ""
                    }`}
                  >
                    <p className="text-[10px] font-mono text-amber-500">{r.requestNumber}</p>
                    <p className="text-sm font-semibold truncate">{r.serviceType}</p>
                    <p className="text-[10px] text-slate-500">
                      {r.customerId} · {r.status}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          {!selected ? (
            <p className="text-sm text-slate-500">Select a request to manage.</p>
          ) : (
            <>
              <div>
                <p className="text-[10px] font-mono text-amber-500">{selected.requestNumber}</p>
                <p className="font-bold text-white">{selected.serviceType}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Customer: {selected.customerId}
                  {selected.preferredDate
                    ? ` · Preferred ${selected.preferredDate} ${selected.preferredTime || ""}`
                    : ""}
                </p>
                {selected.notes && (
                  <p className="text-xs text-slate-500 mt-2">Notes: {selected.notes}</p>
                )}
              </div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              >
                {SERVICE_STATUSES.map((s) => (
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
              <input
                placeholder="Before photo URL"
                value={beforePhoto}
                onChange={(e) => setBeforePhoto(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <input
                placeholder="After photo URL"
                value={afterPhoto}
                onChange={(e) => setAfterPhoto(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <textarea
                placeholder="Completion notes"
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                rows={3}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              />
              <p className="text-[10px] text-slate-600">
                Types: {SERVICE_TYPES.join(", ")}
              </p>
              <WhatsAppModule
                staffUser={staffUser}
                preset="project"
                phone={resolveLeadPhoneFromLeads(leads, { customerId: selected.customerId })}
                customerId={selected.customerId}
                templateVars={{
                  customerName: selected.customerId,
                  date: scheduledVisit,
                  technicianName: technician,
                  ticketId: selected.requestNumber,
                }}
                actions={[
                  "open_chat",
                  "service_ticket_received",
                  "installation_scheduled",
                  "payment_balance_reminder",
                ]}
              />
              {msg && <p className="text-xs text-amber-400">{msg}</p>}
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
