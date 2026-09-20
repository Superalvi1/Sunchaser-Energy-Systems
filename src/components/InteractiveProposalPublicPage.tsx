import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Battery,
  Check,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  Sun,
  Zap,
} from "lucide-react";
import { API_BASE_URL } from "../services/api";
import {
  calculateInteractiveProposal,
  type InteractiveProposalCalculation,
  type InteractiveProposalConfig,
  type InteractiveProposalDefinition,
  type InteractiveProposalStatus,
} from "../lib/interactiveProposal";

type PublicProposal = {
  id: string;
  status: InteractiveProposalStatus;
  definition: Omit<InteractiveProposalDefinition, "sourceQuoteId">;
  configuration: InteractiveProposalConfig;
  calculation: InteractiveProposalCalculation;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByName: string | null;
  acceptedCalculation: InteractiveProposalCalculation | null;
};

function formatPKR(value: number) {
  return `Rs. ${Math.round(value || 0).toLocaleString("en-PK")}`;
}

function statusLabel(status: InteractiveProposalStatus) {
  if (status === "Modified") return "Configuration updated";
  if (status === "Viewed") return "Proposal opened";
  return status;
}

export default function InteractiveProposalPublicPage({ token }: { token: string }) {
  const [proposal, setProposal] = useState<PublicProposal | null>(null);
  const [configuration, setConfiguration] = useState<InteractiveProposalConfig | null>(null);
  const [calculation, setCalculation] = useState<InteractiveProposalCalculation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptedName, setAcceptedName] = useState("");
  const hydrated = useRef(false);
  const previewSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/public/interactive-proposals/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "This proposal link is not available.");
        return data as PublicProposal;
      })
      .then((data) => {
        if (cancelled) return;
        setProposal(data);
        setConfiguration(data.configuration);
        setCalculation(data.acceptedCalculation || data.calculation);
        setAcceptedName(data.acceptedByName || data.definition.customerName || "");
        hydrated.current = true;
      })
      .catch((requestError: Error) => {
        if (!cancelled) setError(requestError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!proposal || !configuration || !hydrated.current || proposal.status === "Accepted") return;
    const sequence = ++previewSequence.current;
    const timer = window.setTimeout(async () => {
      setSyncing(true);
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/public/interactive-proposals/${encodeURIComponent(token)}/preview`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ configuration }),
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not update this configuration.");
        if (sequence !== previewSequence.current) return;
        setCalculation(data.calculation);
        if (JSON.stringify(data.configuration) !== JSON.stringify(configuration)) {
          setConfiguration(data.configuration);
        }
        setProposal((current) => (current ? { ...current, status: data.status } : current));
      } catch (requestError: any) {
        if (sequence === previewSequence.current) {
          setError(requestError.message || "Could not update this configuration.");
        }
      } finally {
        if (sequence === previewSequence.current) setSyncing(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [configuration, proposal?.id, token]);

  const definition = proposal?.definition as InteractiveProposalDefinition | undefined;
  const localCalculation = useMemo(() => {
    if (!definition || !configuration) return calculation;
    return calculateInteractiveProposal(definition, configuration);
  }, [definition, configuration, calculation]);

  const applyConfiguration = (patch: Partial<InteractiveProposalConfig>) => {
    if (!configuration || proposal?.status === "Accepted") return;
    setError("");
    setConfiguration({ ...configuration, ...patch });
  };

  const acceptProposal = async () => {
    if (!configuration || acceptedName.trim().length < 2) return;
    setAccepting(true);
    setError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/public/interactive-proposals/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ configuration, acceptedByName: acceptedName.trim() }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not accept this proposal.");
      setCalculation(data.calculation);
      setProposal((current) =>
        current
          ? {
              ...current,
              status: "Accepted",
              acceptedAt: data.acceptedAt,
              acceptedByName: data.acceptedByName,
              acceptedCalculation: data.calculation,
            }
          : current
      );
      setConfirming(false);
    } catch (requestError: any) {
      setError(requestError.message || "Could not accept this proposal.");
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#07111f] text-white grid place-items-center p-6">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-amber-400" />
          <p className="mt-3 text-sm text-slate-300">Opening your Sunchaser proposal…</p>
        </div>
      </main>
    );
  }

  if (!proposal || !definition || !configuration || !localCalculation) {
    return (
      <main className="min-h-screen bg-[#07111f] text-white grid place-items-center p-6">
        <section className="w-full max-w-md rounded-3xl border border-red-400/20 bg-slate-900 p-7 text-center shadow-2xl">
          <AlertTriangle className="mx-auto h-10 w-10 text-red-400" />
          <h1 className="mt-4 text-xl font-bold">Proposal unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{error || "Ask Sunchaser to send you a new proposal link."}</p>
        </section>
      </main>
    );
  }

  const accepted = proposal.status === "Accepted";
  const expiresOn = new Date(proposal.expiresAt).toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#17324b_0,_#081522_42%,_#050b13_100%)] px-4 py-5 text-white sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-5 flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20">
              <Sun className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-tight">Sunchaser Energy Systems</div>
              <div className="text-[11px] text-slate-400">Solar proposal · Lahore, Pakistan</div>
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
            {statusLabel(proposal.status)}
          </div>
        </header>

        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/80 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="border-b border-white/10 bg-gradient-to-br from-amber-400 to-orange-500 p-6 text-slate-950 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-70">Prepared for {definition.customerName}</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{definition.title}</h1>
            <p className="mt-2 max-w-xl text-sm font-medium leading-6 opacity-80">
              Choose from the approved options below. Your estimated proposal value updates immediately.
            </p>
          </div>

          {accepted ? (
            <div className="p-6 sm:p-8">
              <div className="rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-6 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
                <h2 className="mt-4 text-2xl font-black">Proposal accepted</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Thank you, {proposal.acceptedByName}. Your exact selected configuration has been sent to Sunchaser for final sales and technical confirmation.
                </p>
                <div className="mt-5 text-sm text-slate-400">Original quotation {formatPKR(definition.basePrice)}</div>
                <div className="mt-1 text-3xl font-black text-amber-400">{formatPKR(localCalculation.totalPrice)}</div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {localCalculation.summary.map((item) => (
                  <div key={item} className="flex gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-5 sm:p-8">
              <div className="grid gap-5">
                <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-bold"><Sun className="h-4 w-4 text-amber-400" /> Solar panels</div>
                      <p className="mt-1 text-xs text-slate-400">{definition.panel.label}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-black">{configuration.panelCount}</div>
                      <div className="text-xs text-amber-400">{localCalculation.panelCapacityKwp.toFixed(2)} kWp</div>
                    </div>
                  </div>
                  {definition.panel.minCount !== definition.panel.maxCount && (
                    <div className="mt-4 grid grid-cols-[48px_1fr_48px] items-center gap-3">
                      <button
                        type="button"
                        aria-label="Remove one panel"
                        disabled={configuration.panelCount <= definition.panel.minCount}
                        onClick={() => applyConfiguration({ panelCount: configuration.panelCount - definition.panel.step })}
                        className="grid h-12 place-items-center rounded-2xl border border-white/10 bg-slate-900 text-white disabled:opacity-30"
                      >
                        <Minus className="h-5 w-5" />
                      </button>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all"
                          style={{
                            width: `${((configuration.panelCount - definition.panel.minCount) / Math.max(1, definition.panel.maxCount - definition.panel.minCount)) * 100}%`,
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        aria-label="Add one panel"
                        disabled={configuration.panelCount >= definition.panel.maxCount}
                        onClick={() => applyConfiguration({ panelCount: configuration.panelCount + definition.panel.step })}
                        className="grid h-12 place-items-center rounded-2xl border border-amber-400/40 bg-amber-400/10 text-amber-300 disabled:opacity-30"
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                </section>

                {[
                  { key: "inverterId" as const, title: "Inverter", icon: Zap, group: definition.inverter },
                  { key: "batteryId" as const, title: "Battery backup", icon: Battery, group: definition.battery },
                  { key: "structureId" as const, title: "Mounting structure", icon: ShieldCheck, group: definition.structure },
                ].map(({ key, title, icon: Icon, group }) => (
                  <fieldset key={key} className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
                    <legend className="sr-only">{title}</legend>
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold"><Icon className="h-4 w-4 text-amber-400" /> {title}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.options.map((option) => {
                        const selected = configuration[key] === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => applyConfiguration({ [key]: option.id })}
                            className={`min-h-[58px] rounded-2xl border p-3 text-left transition ${
                              selected
                                ? "border-amber-400 bg-amber-400/10 text-white"
                                : "border-white/10 bg-slate-900/60 text-slate-300 hover:border-white/20"
                            }`}
                          >
                            <span className="flex items-start justify-between gap-2">
                              <span className="text-sm font-bold leading-5">{option.label}</span>
                              {selected && <Check className="h-4 w-4 shrink-0 text-amber-400" />}
                            </span>
                            {option.priceAdjustment !== 0 && (
                              <span className="mt-1 block text-xs text-slate-400">
                                {option.priceAdjustment > 0 ? "+" : "−"}{formatPKR(Math.abs(option.priceAdjustment))}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>

              {localCalculation.warnings.length > 0 && (
                <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                  <div className="flex gap-2"><AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-400" /> {localCalculation.warnings[0]}</div>
                </div>
              )}
              {error && (
                <div className="mt-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>
              )}

              <section className="mt-6 rounded-3xl border border-amber-400/20 bg-gradient-to-br from-slate-900 to-slate-950 p-5 sm:p-6">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Original quotation</div>
                    <div className="mt-1 text-lg font-bold text-slate-300">{formatPKR(definition.basePrice)}</div>
                    <div className="mt-3 text-xs font-bold uppercase tracking-wider text-slate-500">Estimated proposal</div>
                    <div className="mt-1 text-3xl font-black tracking-tight text-amber-400 sm:text-4xl">{formatPKR(localCalculation.totalPrice)}</div>
                    {localCalculation.priceDifference !== 0 && (
                      <div className="mt-1 text-xs text-slate-400">
                        {localCalculation.priceDifference > 0 ? "+" : "−"}
                        {formatPKR(Math.abs(localCalculation.priceDifference))} vs original
                      </div>
                    )}
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    {syncing ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving</span> : "Saved"}
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  This is your selected configuration. Sunchaser will perform final technical and commercial confirmation before project booking.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="mt-5 min-h-[52px] w-full rounded-2xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-amber-500/20 hover:bg-amber-300"
                >
                  Accept this proposal
                </button>
              </section>

              {confirming && (
                <section className="mt-5 rounded-3xl border border-emerald-400/30 bg-emerald-400/[0.07] p-5">
                  <h2 className="text-lg font-black">Confirm your selection</h2>
                  <div className="mt-3 space-y-2">
                    {localCalculation.summary.map((item) => (
                      <div key={item} className="flex gap-2 text-sm text-slate-300"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> {item}</div>
                    ))}
                  </div>
                  <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-slate-400" htmlFor="accept-name">Your name</label>
                  <input
                    id="accept-name"
                    value={acceptedName}
                    onChange={(event) => setAcceptedName(event.target.value)}
                    className="mt-2 min-h-[48px] w-full rounded-2xl border border-white/10 bg-slate-950 px-4 text-base text-white outline-none focus:border-amber-400"
                    autoComplete="name"
                  />
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setConfirming(false)} className="min-h-[48px] rounded-2xl border border-white/10 text-sm font-bold text-slate-300">Go back</button>
                    <button
                      type="button"
                      disabled={accepting || acceptedName.trim().length < 2}
                      onClick={() => void acceptProposal()}
                      className="min-h-[48px] rounded-2xl bg-emerald-400 text-sm font-black text-slate-950 disabled:opacity-40"
                    >
                      {accepting ? "Accepting…" : "Confirm & accept"}
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}

          <footer className="border-t border-white/10 px-5 py-4 text-center text-[11px] text-slate-500">
            Link valid until {expiresOn} · Original quotation remains unchanged
          </footer>
        </section>
      </div>
    </main>
  );
}
