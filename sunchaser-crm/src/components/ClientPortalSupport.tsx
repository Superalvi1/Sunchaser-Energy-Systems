import React, { useEffect, useState } from "react";
import { Loader2, Plus, Headphones, ChevronRight, ArrowLeft } from "lucide-react";
import { User } from "../types";
import {
  fetchCustomerSupportTickets,
  fetchCustomerSupportTicketById,
  createCustomerSupportTicket,
} from "../services/api";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  type SupportTicketRecord,
} from "../lib/clientPortalSupport";

interface ClientPortalSupportProps {
  user: User;
}

export default function ClientPortalSupport({ user }: ClientPortalSupportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportTicketRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [category, setCategory] = useState(SUPPORT_CATEGORIES[0]);
  const [priority, setPriority] = useState<(typeof SUPPORT_PRIORITIES)[number]>("Medium");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [faultCode, setFaultCode] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [preferredVisitDate, setPreferredVisitDate] = useState("");

  const loadList = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCustomerSupportTickets(user.id, user.username);
      setTickets(data.tickets || []);
    } catch (err: any) {
      setError(err.message || "Unable to load tickets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (view === "list") loadList();
  }, [user.id, user.username, view]);

  const openDetail = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCustomerSupportTicketById(user.id, user.username, id);
      setDetail(data.ticket);
      setSelectedId(id);
      setView("detail");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createCustomerSupportTicket(user.id, user.username, {
        category,
        priority,
        subject,
        description,
        faultCode: faultCode || undefined,
        photoUrl: photoUrl || undefined,
        preferredVisitDate: preferredVisitDate || undefined,
      });
      setSubject("");
      setDescription("");
      setFaultCode("");
      setPhotoUrl("");
      setPreferredVisitDate("");
      setView("list");
      await loadList();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (view === "create") {
    return (
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => setView("list")}
          className="text-xs text-amber-400 font-bold flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to tickets
        </button>
        <h3 className="text-sm font-bold text-white">New support request</h3>
        <form onSubmit={handleCreate} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            >
              {SUPPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            >
              {SUPPORT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <input
            required
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <textarea
            required
            rows={4}
            placeholder="Describe the issue"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            placeholder="Fault code (optional)"
            value={faultCode}
            onChange={(e) => setFaultCode(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            placeholder="Photo URL (optional)"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={preferredVisitDate}
            onChange={(e) => setPreferredVisitDate(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-amber-500 text-slate-950 font-extrabold py-3 rounded-xl text-sm disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit ticket"}
          </button>
        </form>
        {error && <p className="text-xs text-rose-400 text-center">{error}</p>}
      </section>
    );
  }

  if (view === "detail" && detail) {
    return (
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setView("list");
            setDetail(null);
          }}
          className="text-xs text-amber-400 font-bold flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to tickets
        </button>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <p className="text-[10px] font-mono text-amber-500">{detail.ticketNumber}</p>
          <h3 className="text-lg font-bold text-white">{detail.subject}</h3>
          <p className="text-xs text-slate-400">{detail.category} · {detail.priority}</p>
          <p className="text-sm text-slate-300">{detail.description}</p>
          <dl className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
            <div>
              <dt>Status</dt>
              <dd className="text-slate-200">{detail.status}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd className="text-slate-200">{new Date(detail.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Last update</dt>
              <dd className="text-slate-200">{new Date(detail.updatedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Technician</dt>
              <dd className="text-slate-200">{detail.assignedTechnician || "Not assigned yet"}</dd>
            </div>
          </dl>
          {detail.resolutionSummary && (
            <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-xl p-3 text-xs text-emerald-200">
              <p className="font-bold mb-1">Resolution</p>
              <p>{detail.resolutionSummary}</p>
            </div>
          )}
          {detail.customerVisibleNotes && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-300">
              <p className="font-bold text-slate-400 mb-1">Updates from our team</p>
              <p className="whitespace-pre-wrap">{detail.customerVisibleNotes}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] font-mono uppercase text-slate-500 mb-2">Timeline</p>
            <ul className="space-y-2">
              {detail.timeline.length === 0 ? (
                <li className="text-xs text-slate-500">No timeline entries yet.</li>
              ) : (
                detail.timeline.map((u) => (
                  <li key={u.id} className="text-xs border-l-2 border-amber-500/40 pl-3 py-1">
                    <span className="text-amber-400/90">{u.status || "Update"}</span>
                    <span className="text-slate-500 block font-mono text-[10px]">
                      {new Date(u.createdAt).toLocaleString()} · {u.createdBy}
                    </span>
                    {u.note && <p className="text-slate-300 mt-0.5">{u.note}</p>}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
          <Headphones className="w-4 h-4 text-amber-500" />
          Support Center
        </h3>
        <button
          type="button"
          onClick={() => setView("create")}
          className="text-xs font-bold bg-amber-500 text-slate-950 px-3 py-1.5 rounded-lg flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> New ticket
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin mx-auto" />
        </div>
      ) : error ? (
        <p className="text-sm text-rose-400 text-center">{error}</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-slate-500 text-center font-mono py-8">No support tickets yet.</p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => openDetail(t.id)}
                className="w-full text-left bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-2 hover:border-amber-500/30"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-mono text-amber-500">{t.ticketNumber}</p>
                  <p className="text-sm font-semibold text-white truncate">{t.subject}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {t.category} · {t.status} · {t.priority}
                  </p>
                  <p className="text-[10px] text-slate-600 font-mono mt-0.5">
                    {new Date(t.createdAt).toLocaleDateString()}
                    {t.assignedTechnician ? ` · ${t.assignedTechnician}` : ""}
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-600 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
