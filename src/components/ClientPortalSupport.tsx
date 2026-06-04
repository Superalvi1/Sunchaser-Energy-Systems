import React, { useEffect, useState } from "react";
import {
  Loader2,
  Plus,
  Headphones,
  ChevronRight,
  ArrowLeft,
  Phone,
  MessageCircle,
  ImagePlus,
  Video,
} from "lucide-react";
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
import { portal, supportPhoneFromBranding, whatsAppHref } from "../lib/clientPortalUi";
import type { CompanyBranding } from "../lib/branding";

interface ClientPortalSupportProps {
  user: User;
  branding?: CompanyBranding | null;
}

export default function ClientPortalSupport({ user, branding }: ClientPortalSupportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [view, setView] = useState<"hub" | "create" | "detail">("hub");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportTicketRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [category, setCategory] = useState(SUPPORT_CATEGORIES[0]);
  const [priority, setPriority] = useState<(typeof SUPPORT_PRIORITIES)[number]>("Medium");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [preferredVisitDate, setPreferredVisitDate] = useState("");

  const phone = supportPhoneFromBranding(branding?.phoneNumbers);
  const waLink = whatsAppHref(phone, `Hello Sunchaser, I need support. Customer: ${user.name}`);

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
    if (view === "hub") loadList();
  }, [user.id, user.username, view]);

  const readFileAsDataUrl = (file: File, setter: (v: string) => void) => {
    if (file.size > 800_000) {
      setError("File too large. Please use a smaller photo or video (under 800KB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

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
      const attachmentNote =
        photoUrl && videoUrl
          ? "\n\n[Customer attached photo and video.]"
          : videoUrl
            ? "\n\n[Customer attached a video.]"
            : "";
      await createCustomerSupportTicket(user.id, user.username, {
        category,
        priority,
        subject,
        description: description + attachmentNote,
        photoUrl: photoUrl || videoUrl || undefined,
        preferredVisitDate: preferredVisitDate || undefined,
      });
      setSubject("");
      setDescription("");
      setPhotoUrl("");
      setVideoUrl("");
      setPreferredVisitDate("");
      setView("hub");
      await loadList();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (view === "create") {
    return (
      <div className="space-y-5">
        <button type="button" onClick={() => setView("hub")} className={portal.btnGhost}>
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h3 className={portal.titleSm}>Open support ticket</h3>
        <form onSubmit={handleCreate} className={`${portal.card} ${portal.cardPad} space-y-4`}>
          <div>
            <label className={portal.label}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className={portal.input + " mt-1"}
            >
              {SUPPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={portal.label}>Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className={portal.input + " mt-1"}
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
            className={portal.input}
          />
          <textarea
            required
            rows={4}
            placeholder="Describe the issue"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={portal.input}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className={portal.btnSecondary + " cursor-pointer !py-3"}>
              <ImagePlus className="h-4 w-4" />
              Photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readFileAsDataUrl(f, setPhotoUrl);
                }}
              />
            </label>
            <label className={portal.btnSecondary + " cursor-pointer !py-3"}>
              <Video className="h-4 w-4" />
              Video
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readFileAsDataUrl(f, setVideoUrl);
                }}
              />
            </label>
          </div>
          {(photoUrl || videoUrl) && (
            <p className="text-xs text-emerald-400">Attachment ready to send</p>
          )}
          <input
            type="date"
            value={preferredVisitDate}
            onChange={(e) => setPreferredVisitDate(e.target.value)}
            className={portal.input}
          />
          <button type="submit" disabled={submitting} className={portal.btnPrimary + " w-full"}>
            {submitting ? "Submitting…" : "Submit ticket"}
          </button>
        </form>
        {error && <p className="text-xs text-red-400 text-center">{error}</p>}
      </div>
    );
  }

  if (view === "detail" && detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setView("hub");
            setDetail(null);
          }}
          className={portal.btnGhost}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <div className={`${portal.card} ${portal.cardPad} space-y-3`}>
          <p className="text-xs text-amber-400 font-semibold">{detail.ticketNumber}</p>
          <h3 className="text-lg font-bold text-white">{detail.subject}</h3>
          <p className="text-sm text-slate-400">{detail.category} · {detail.status}</p>
          <p className="text-sm text-slate-300 leading-relaxed">{detail.description}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className={portal.subtitle}>Fast help for your solar system</p>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setView("create")} className={portal.btnPrimary + " flex-col !py-5"}>
          <Plus className="h-5 w-5" />
          Open ticket
        </button>
        <a href={`tel:${phone.replace(/\s/g, "")}`} className={portal.btnSecondary + " flex-col !py-5"}>
          <Phone className="h-5 w-5 text-amber-400" />
          Call support
        </a>
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className={portal.btnSecondary + " col-span-2 !py-4"}
        >
          <MessageCircle className="h-5 w-5 text-emerald-400" />
          WhatsApp support
        </a>
      </div>

      <div>
        <h3 className={portal.titleSm + " mb-3 flex items-center gap-2"}>
          <Headphones className="w-5 h-5 text-amber-400" />
          Ticket history
        </h3>
        {loading ? (
          <div className="py-12 text-center">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin mx-auto" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-400 text-center">{error}</p>
        ) : tickets.length === 0 ? (
          <p className={`${portal.card} ${portal.cardPad} text-sm text-slate-500 text-center`}>
            No tickets yet. Open a ticket or message us on WhatsApp.
          </p>
        ) : (
          <ul className="space-y-3">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => openDetail(t.id)}
                  className={`${portal.card} ${portal.cardPad} w-full flex items-center justify-between gap-2 text-left`}
                >
                  <div className="min-w-0">
                    <p className="text-xs text-amber-400">{t.ticketNumber}</p>
                    <p className="text-sm font-semibold text-white truncate">{t.subject}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {t.status} · {new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-600 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
