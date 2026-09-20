import React, { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Plus, Trash2, X } from "lucide-react";
import type { Lead, Quote } from "../types";
import { authorizedFetch } from "../services/api";
import {
  normalizeInteractiveProposalDefinition,
  quoteToInteractiveProposalDefinition,
  type InteractiveProposalChoice,
  type InteractiveProposalDefinition,
} from "../lib/interactiveProposal";
import AppModal from "./ui/AppModal";

type ChoiceGroup = "inverter" | "battery" | "structure";
type ProposalHistoryItem = {
  id: string;
  status: string;
  acceptedByName: string | null;
  acceptedAt: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedCalculation: { totalPrice?: number; summary?: string[] } | null;
};

function OptionEditor({
  title,
  group,
  options,
  selectedId,
  onChange,
}: {
  title: string;
  group: ChoiceGroup;
  options: InteractiveProposalChoice[];
  selectedId: string;
  onChange: (options: InteractiveProposalChoice[], selectedId: string) => void;
}) {
  const addOption = () => {
    const id = `${group}-${Date.now().toString(36)}`;
    onChange([...options, { id, label: "New option", priceAdjustment: 0 }], selectedId);
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <p className="text-[10px] text-slate-500">Price difference is compared with the saved quotation.</p>
        </div>
        <button type="button" onClick={addOption} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold text-slate-300 hover:border-amber-400/50 hover:text-amber-300">
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      <div className="space-y-2">
        {options.map((option, index) => (
          <div key={option.id} className="grid grid-cols-[28px_1fr_110px_34px] items-center gap-2">
            <button
              type="button"
              onClick={() => onChange(options, option.id)}
              title="Use as the original selected option"
              className={`grid h-7 w-7 place-items-center rounded-full border ${selectedId === option.id ? "border-amber-400 bg-amber-400 text-slate-950" : "border-slate-700 text-transparent"}`}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <input
              value={option.label}
              aria-label={`${title} option ${index + 1}`}
              onChange={(event) => {
                const next = options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item);
                onChange(next, selectedId);
              }}
              className="min-h-10 rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs text-white outline-none focus:border-amber-400"
            />
            <input
              type="number"
              value={option.priceAdjustment}
              aria-label={`${title} price adjustment ${index + 1}`}
              onChange={(event) => {
                const next = options.map((item) => item.id === option.id ? { ...item, priceAdjustment: Number(event.target.value) || 0 } : item);
                onChange(next, selectedId);
              }}
              className="min-h-10 rounded-xl border border-slate-800 bg-slate-900 px-3 text-right text-xs text-white outline-none focus:border-amber-400"
              placeholder="PKR ±"
            />
            <button
              type="button"
              disabled={options.length === 1}
              onClick={() => {
                const next = options.filter((item) => item.id !== option.id);
                onChange(next, selectedId === option.id ? next[0].id : selectedId);
              }}
              className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-20"
              title="Remove option"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function InteractiveProposalShareModal({
  open,
  onClose,
  lead,
  quote,
}: {
  open: boolean;
  onClose: () => void;
  lead: Lead;
  quote: Quote;
}) {
  const [definition, setDefinition] = useState<InteractiveProposalDefinition>(() => quoteToInteractiveProposalDefinition(quote, lead));
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<ProposalHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDefinition(quoteToInteractiveProposalDefinition(quote, lead));
    setExpiresInDays(14);
    setCreating(false);
    setError("");
    setShareUrl("");
    setCopied(false);
    setHistory([]);
    setHistoryLoading(true);
    void authorizedFetch(
      `/api/interactive-proposals?leadId=${encodeURIComponent(lead.id)}&quotationId=${encodeURIComponent(quote.id)}`
    )
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return;
        if (!cancelled) setHistory(Array.isArray(data.proposals) ? data.proposals : []);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, quote.id, lead.id]);

  const updateGroup = (
    group: ChoiceGroup,
    options: InteractiveProposalChoice[],
    selectedId: string
  ) => {
    setDefinition((current) => ({
      ...current,
      [group]: { ...current[group], options, selectedId },
    }));
  };

  const createLink = async () => {
    setCreating(true);
    setError("");
    try {
      const normalized = normalizeInteractiveProposalDefinition(definition);
      const response = await authorizedFetch("/api/interactive-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          quotationId: quote.id,
          expiresInDays,
          definition: normalized,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not create the client link.");
      setShareUrl(new URL(data.publicPath, window.location.origin).toString());
    } catch (requestError: any) {
      setError(requestError.message || "Could not create the client link.");
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy failed. Select and copy the link manually.");
    }
  };

  return (
    <AppModal open={open} onClose={onClose} panelClassName="max-w-3xl" mobileFullScreen>
      <div className="min-h-full bg-slate-900 text-white md:min-h-0 md:rounded-3xl md:border md:border-slate-800 md:shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/95 p-5 backdrop-blur md:rounded-t-3xl">
          <div>
            <div className="flex items-center gap-2 text-amber-400"><Link2 className="h-4 w-4" /><span className="text-[10px] font-black uppercase tracking-wider">Interactive client proposal</span></div>
            <h2 className="mt-1 text-xl font-black">Choose what the client may change</h2>
            <p className="mt-1 text-xs text-slate-400">Source quote {quote.id} stays unchanged.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-800 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-4 p-5">
          {historyLoading ? (
            <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking client-link history…
            </div>
          ) : history.length > 0 ? (
            <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Client-link history</h3>
              <div className="mt-3 space-y-2">
                {history.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs">
                    <div>
                      <span className={`font-black ${item.status === "Accepted" ? "text-emerald-400" : "text-amber-400"}`}>{item.status}</span>
                      <span className="ml-2 text-slate-500">{new Date(item.createdAt).toLocaleString("en-PK")}</span>
                      {item.acceptedByName ? <div className="mt-1 text-slate-300">Accepted by {item.acceptedByName}</div> : null}
                    </div>
                    {item.acceptedCalculation?.totalPrice ? (
                      <div className="font-black text-white">Rs. {item.acceptedCalculation.totalPrice.toLocaleString("en-PK")}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {shareUrl ? (
            <section className="rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-6 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-400 text-slate-950"><Check className="h-6 w-6" /></div>
              <h3 className="mt-4 text-xl font-black">Client link is ready</h3>
              <p className="mt-2 text-sm text-slate-300">Send this link on WhatsApp. The client opens it directly in the browser—no login or app installation.</p>
              <input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} className="mt-5 min-h-12 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 text-center text-sm text-white" />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={() => void copyLink()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-amber-400 font-black text-slate-950"><Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy link"}</button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Your Sunchaser solar proposal: ${shareUrl}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 font-bold text-white"
                >
                  Send on WhatsApp
                </a>
              </div>
            </section>
          ) : (
            <>
              <section className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:grid-cols-4">
                <label className="sm:col-span-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Proposal title</span>
                  <input value={definition.title} onChange={(event) => setDefinition({ ...definition, title: event.target.value })} className="mt-1 min-h-10 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs text-white outline-none focus:border-amber-400" />
                </label>
                <label>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Valid days</span>
                  <input type="number" min={1} max={60} value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value) || 14)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs text-white outline-none focus:border-amber-400" />
                </label>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Original value</span>
                  <div className="mt-1 flex min-h-10 items-center rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs font-bold text-amber-400">Rs. {definition.basePrice.toLocaleString("en-PK")}</div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <h3 className="text-sm font-bold">Panel quantity</h3>
                <p className="mt-1 text-[10px] text-slate-500">The original {definition.panel.baseCount} panels remain the price baseline.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label><span className="text-[10px] text-slate-500">Minimum panels</span><input type="number" value={definition.panel.minCount} onChange={(event) => setDefinition({ ...definition, panel: { ...definition.panel, minCount: Number(event.target.value) } })} className="mt-1 min-h-10 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs" /></label>
                  <label><span className="text-[10px] text-slate-500">Maximum panels</span><input type="number" value={definition.panel.maxCount} onChange={(event) => setDefinition({ ...definition, panel: { ...definition.panel, maxCount: Number(event.target.value) } })} className="mt-1 min-h-10 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs" /></label>
                  <label><span className="text-[10px] text-slate-500">Selling price / panel</span><input type="number" value={definition.panel.unitPrice || ""} placeholder="Required if editable" onChange={(event) => setDefinition({ ...definition, panel: { ...definition.panel, unitPrice: Number(event.target.value) || 0 } })} className="mt-1 min-h-10 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs" /></label>
                </div>
              </section>

              <OptionEditor title="Inverter choices" group="inverter" options={definition.inverter.options} selectedId={definition.inverter.selectedId} onChange={(options, selectedId) => updateGroup("inverter", options, selectedId)} />
              <OptionEditor title="Battery choices" group="battery" options={definition.battery.options} selectedId={definition.battery.selectedId} onChange={(options, selectedId) => updateGroup("battery", options, selectedId)} />
              <OptionEditor title="Structure choices" group="structure" options={definition.structure.options} selectedId={definition.structure.selectedId} onChange={(options, selectedId) => updateGroup("structure", options, selectedId)} />

              {error && <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>}
              <button type="button" disabled={creating} onClick={() => void createLink()} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 font-black text-slate-950 disabled:opacity-50">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} {creating ? "Creating secure link…" : "Generate client link"}
              </button>
            </>
          )}
        </div>
      </div>
    </AppModal>
  );
}
