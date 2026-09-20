import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  FileDown,
  MessageCircle,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sun,
  Zap,
} from "lucide-react";
import { PANEL_CATALOG } from "../lib/solarEquipmentCatalog";
import {
  PUBLIC_QUOTE_CAPACITIES,
  calculatePublicQuotation,
  defaultPublicQuoteConfig,
  publicQuoteBatteries,
  publicQuoteInverters,
  recommendedPanelQuantity,
  type PublicQuoteConfig,
  type PublicQuoteLine,
  type PublicQuoteStructure,
} from "../lib/publicQuotationBuilder";

const CONTACT_PHONE = "0330-7776444 / 0309-0236666";
const WHATSAPP_PHONE = "923307776444";

function formatPkr(value: number) {
  return `Rs. ${Math.round(value).toLocaleString("en-PK")}`;
}

function makeQuoteNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SES-${date}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function SelectField({
  label,
  value,
  onChange,
  children,
  disabled = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-800">{label}</span>
      <span className="relative block">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-14 w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 pr-11 text-[15px] font-semibold text-slate-900 shadow-sm outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-100 disabled:bg-slate-100 disabled:text-slate-600"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
      </span>
      {hint ? <span className="mt-1.5 block text-xs leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}

function QuoteTable({ lines }: { lines: PublicQuoteLine[] }) {
  const groups = ["Equipment", "Cables & protection", "Structure", "Services"] as const;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <table className="w-full border-collapse text-left text-xs sm:text-sm">
        <thead className="bg-slate-900 text-white">
          <tr>
            <th className="px-3 py-3 font-bold">Item</th>
            <th className="hidden px-3 py-3 font-bold sm:table-cell">Specification</th>
            <th className="px-2 py-3 text-center font-bold">Qty.</th>
            <th className="px-3 py-3 text-right font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const groupLines = lines.filter((line) => line.category === group);
            if (!groupLines.length) return null;
            return (
              <React.Fragment key={group}>
                <tr className="bg-amber-100 text-amber-950">
                  <th colSpan={4} className="px-3 py-2 text-xs font-extrabold uppercase tracking-wide">{group}</th>
                </tr>
                {groupLines.map((line, index) => (
                  <tr key={`${group}-${line.description}-${index}`} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-3 font-semibold text-slate-900">
                      {line.description}
                      <div className="mt-1 font-normal leading-4 text-slate-500 sm:hidden">{line.specification}</div>
                    </td>
                    <td className="hidden px-3 py-3 leading-5 text-slate-600 sm:table-cell">{line.specification}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-center text-slate-600">{line.quantity} {line.unit}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-bold text-slate-900">
                      {line.totalPkr === 0 ? "Included" : formatPkr(line.totalPkr)}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PublicQuotationBuilderPage() {
  const [config, setConfig] = useState<PublicQuoteConfig>(() => defaultPublicQuoteConfig(8));
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientCity, setClientCity] = useState("");
  const [generated, setGenerated] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState(makeQuoteNumber);

  useEffect(() => {
    const previous = document.title;
    document.title = "Build Your Solar Quote | Sunchaser Energy Systems";
    return () => {
      document.title = previous;
    };
  }, []);

  const calculationState = useMemo(() => {
    try {
      return { calculation: calculatePublicQuotation(config), error: "" };
    } catch (error) {
      return { calculation: null, error: error instanceof Error ? error.message : "This combination needs manual review." };
    }
  }, [config]);
  const calculation = calculationState.calculation;
  const inverters = publicQuoteInverters(config.systemCapacityKw);
  const selectedInverter = inverters.find((item) => item.id === config.inverterId);
  const batteries = publicQuoteBatteries(config.systemCapacityKw);

  const updateConfig = (patch: Partial<PublicQuoteConfig>) => {
    setGenerated(false);
    setConfig((current) => ({ ...current, ...patch }));
  };

  const selectCapacity = (capacity: (typeof PUBLIC_QUOTE_CAPACITIES)[number]) => {
    const next = defaultPublicQuoteConfig(capacity);
    const panel = PANEL_CATALOG.find((item) => item.id === config.panelId) || PANEL_CATALOG[0];
    setGenerated(false);
    setConfig({
      ...next,
      panelId: panel.id,
      panelQuantity: recommendedPanelQuantity(capacity, panel.watts),
    });
  };

  const selectPanel = (panelId: string) => {
    const panel = PANEL_CATALOG.find((item) => item.id === panelId);
    if (!panel) return;
    updateConfig({
      panelId,
      panelQuantity: recommendedPanelQuantity(config.systemCapacityKw, panel.watts),
    });
  };

  const selectInverter = (inverterId: string) => {
    const inverter = inverters.find((item) => item.id === inverterId);
    if (!inverter) return;
    updateConfig({
      inverterId,
      batteryId: inverter.bundle?.batteryId || batteries[0]?.id || "",
    });
  };

  const generateQuote = () => {
    if (!calculation) return;
    setQuoteNumber(makeQuoteNumber());
    setGenerated(true);
    window.setTimeout(() => document.getElementById("generated-quotation")?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const sendToWhatsApp = () => {
    if (!calculation) return;
    const message = [
      "Hello Sunchaser Energy Systems,",
      `I generated quotation ${quoteNumber} for a ${calculation.systemCapacityKw} kW solar system.`,
      `${calculation.panel.brand} ${calculation.panel.watts}W × ${config.panelQuantity}`,
      `${calculation.inverter.brand} ${calculation.inverter.capacityKw} kW inverter`,
      `${calculation.battery.brand} ${calculation.battery.capacityKwh} kWh battery`,
      calculation.structureLabel,
      `Estimated total: ${formatPkr(calculation.totalPkr)}`,
      clientName.trim() ? `Name: ${clientName.trim()}` : "",
      clientCity.trim() ? `City: ${clientCity.trim()}` : "",
    ].filter(Boolean).join("\n");
    window.open(`https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  const reset = () => {
    setConfig(defaultPublicQuoteConfig(8));
    setClientName("");
    setClientPhone("");
    setClientCity("");
    setGenerated(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <style>{`
        @media print {
          body { background: #fff !important; }
          .public-quote-no-print { display: none !important; }
          .public-quote-print { display: block !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; border: 0 !important; }
          .public-quote-print table { font-size: 9px !important; }
          .public-quote-print tr { break-inside: avoid; }
        }
      `}</style>

      <header className="public-quote-no-print sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-400 text-slate-950">
              <Sun className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-black tracking-tight sm:text-lg">Sunchaser Solar Quote</h1>
              <p className="text-xs text-slate-500">Choose your system. See your price instantly.</p>
            </div>
          </div>
          {calculation ? (
            <div className="shrink-0 text-right">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Estimated total</div>
              <div className="text-sm font-black text-emerald-700 sm:text-lg">{formatPkr(calculation.totalPkr)}</div>
            </div>
          ) : null}
        </div>
      </header>

      <div className="public-quote-no-print mx-auto grid max-w-5xl gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:py-8">
        <section className="space-y-5">
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-100 text-sm font-black text-amber-900">1</span>
              <div>
                <h2 className="text-lg font-black">Choose system size</h2>
                <p className="text-sm text-slate-500">Select how much solar power you need.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {PUBLIC_QUOTE_CAPACITIES.map((capacity) => (
                <button
                  key={capacity}
                  type="button"
                  onClick={() => selectCapacity(capacity)}
                  className={`min-h-14 rounded-2xl border-2 px-3 text-base font-black transition ${config.systemCapacityKw === capacity ? "border-amber-500 bg-amber-400 text-slate-950 shadow-md shadow-amber-100" : "border-slate-200 bg-white text-slate-700 hover:border-amber-300"}`}
                >
                  {capacity} kW
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-100 text-sm font-black text-amber-900">2</span>
              <div>
                <h2 className="text-lg font-black">Choose equipment</h2>
                <p className="text-sm text-slate-500">Only compatible options are shown.</p>
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField label="Solar panel" value={config.panelId} onChange={selectPanel}>
                {PANEL_CATALOG.map((panel) => (
                  <option key={panel.id} value={panel.id}>
                    {panel.brand} {panel.watts}W — Rs. {panel.pricePerWattPkr}/W
                  </option>
                ))}
              </SelectField>

              <div>
                <span className="mb-2 block text-sm font-bold text-slate-800">Number of panels</span>
                <div className="flex min-h-14 items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <button type="button" aria-label="Remove one panel" onClick={() => updateConfig({ panelQuantity: Math.max(1, config.panelQuantity - 1) })} className="grid h-14 w-14 place-items-center text-slate-700 hover:bg-slate-100">
                    <Minus className="h-5 w-5" />
                  </button>
                  <input
                    aria-label="Panel quantity"
                    type="number"
                    min={1}
                    max={200}
                    value={config.panelQuantity}
                    onChange={(event) => updateConfig({ panelQuantity: Number(event.target.value) })}
                    className="h-14 min-w-0 flex-1 border-x border-slate-200 text-center text-lg font-black outline-none"
                  />
                  <button type="button" aria-label="Add one panel" onClick={() => updateConfig({ panelQuantity: Math.min(200, config.panelQuantity + 1) })} className="grid h-14 w-14 place-items-center text-slate-700 hover:bg-slate-100">
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
                {calculation ? <p className="mt-1.5 text-xs text-slate-500">Panel array: {calculation.configuredPanelCapacityKw.toFixed(2)} kW</p> : null}
              </div>

              <SelectField label="Hybrid inverter" value={config.inverterId} onChange={selectInverter}>
                {inverters.map((inverter) => (
                  <option key={inverter.id} value={inverter.id}>
                    {inverter.brand} {inverter.capacityKw}kW{inverter.phase === "three" ? " 3P" : ""}{inverter.protection ? ` ${inverter.protection}` : ""} — {formatPkr(inverter.pricePkr)}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Lithium battery"
                value={selectedInverter?.bundle?.batteryId || config.batteryId}
                disabled={Boolean(selectedInverter?.bundle)}
                onChange={(batteryId) => updateConfig({ batteryId })}
                hint={selectedInverter?.bundle ? "FOX ESS includes its matching 10.2 kWh battery automatically." : "Battery sizes are matched to the selected system."}
              >
                {selectedInverter?.bundle ? (
                  <option value={selectedInverter.bundle.batteryId}>{selectedInverter.bundle.batteryLabel}</option>
                ) : batteries.map((battery) => (
                  <option key={battery.id} value={battery.id}>
                    {battery.brand} {battery.capacityKwh}kWh{battery.protection ? ` ${battery.protection}` : ""} — {formatPkr(battery.pricePkr)}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-100 text-sm font-black text-amber-900">3</span>
              <div>
                <h2 className="text-lg font-black">Choose panel structure</h2>
                <p className="text-sm text-slate-500">Stand quantity is calculated automatically.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                ["standard-l2", "L2 standard", "2 panels per stand · Rs. 4,500"],
                ["standard-l3", "L3 standard", "3 panels per stand · Rs. 7,200"],
                ["elevated", "Elevated", "Fabricated for this system size"],
              ] as Array<[PublicQuoteStructure, string, string]>).map(([value, label, detail]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateConfig({ structureType: value })}
                  className={`min-h-24 rounded-2xl border-2 p-4 text-left transition ${config.structureType === value ? "border-amber-500 bg-amber-50 shadow-sm" : "border-slate-200 hover:border-amber-300"}`}
                >
                  <span className="block font-black text-slate-900">{label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{detail}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-100 text-sm font-black text-amber-900">4</span>
              <div>
                <h2 className="text-lg font-black">Your details</h2>
                <p className="text-sm text-slate-500">Optional—used only on your downloaded quote.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["Your name", clientName, setClientName, "e.g. Hassan"],
                ["Phone number", clientPhone, setClientPhone, "03XX-XXXXXXX"],
                ["City", clientCity, setClientCity, "e.g. Lahore"],
              ].map(([label, value, setter, placeholder]) => (
                <label key={label as string} className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-800">{label as string}</span>
                  <input value={value as string} onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)} placeholder={placeholder as string} className="min-h-14 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100" />
                </label>
              ))}
            </div>
          </div>
        </section>

        <aside className="h-fit rounded-3xl bg-slate-950 p-5 text-white shadow-xl lg:sticky lg:top-24">
          <div className="flex items-center gap-2 text-amber-400"><Zap className="h-5 w-5" /><span className="text-sm font-black uppercase tracking-wide">Your estimate</span></div>
          {calculation ? (
            <>
              <div className="mt-4 text-3xl font-black">{formatPkr(calculation.totalPkr)}</div>
              <div className="mt-1 text-sm text-slate-400">Complete {calculation.systemCapacityKw} kW quotation</div>
              <div className="my-5 space-y-3 border-y border-white/10 py-5 text-sm">
                <div className="flex justify-between gap-3"><span className="text-slate-400">Panels</span><span className="text-right font-bold">{config.panelQuantity} × {calculation.panel.watts}W</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-400">Inverter</span><span className="text-right font-bold">{calculation.inverter.brand} {calculation.inverter.capacityKw}kW</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-400">Battery</span><span className="text-right font-bold">{calculation.battery.brand} {calculation.battery.capacityKwh}kWh</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-400">Structure</span><span className="text-right font-bold">{calculation.structureLabel}</span></div>
              </div>
              <button type="button" onClick={generateQuote} className="min-h-14 w-full rounded-2xl bg-amber-400 px-5 text-base font-black text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-300 active:scale-[0.99]">
                Generate My Quote
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-slate-400">No login needed. Your choices calculate on this device.</p>
            </>
          ) : (
            <div className="mt-4 rounded-2xl bg-red-500/10 p-4 text-sm leading-6 text-red-200">{calculationState.error}</div>
          )}
        </aside>
      </div>

      {generated && calculation ? (
        <section id="generated-quotation" className="public-quote-print mx-auto mb-28 max-w-5xl bg-white p-5 shadow-2xl sm:mb-12 sm:rounded-3xl sm:p-9">
          <div className="flex flex-col justify-between gap-5 border-b-4 border-amber-400 pb-6 sm:flex-row sm:items-start">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-400"><Sun className="h-7 w-7" /></div>
              <div>
                <h2 className="text-xl font-black">Sunchaser Energy Systems</h2>
                <p className="text-xs leading-5 text-slate-600">ceo.sunchaser@gmail.com · www.sunchaserenergy.co<br />{CONTACT_PHONE}</p>
              </div>
            </div>
            <div className="sm:text-right">
              <div className="text-xs font-bold uppercase tracking-widest text-amber-700">Technical & Financial BOQ</div>
              <div className="mt-1 text-lg font-black">{calculation.systemCapacityKw} kW Hybrid Solar System</div>
              <div className="text-xs text-slate-500">Quote {quoteNumber} · {new Date().toLocaleDateString("en-PK")}</div>
            </div>
          </div>

          <div className="grid gap-3 border-b border-slate-200 py-5 text-sm sm:grid-cols-3">
            <div><span className="block text-xs font-bold uppercase text-slate-400">Prepared for</span><span className="font-bold">{clientName.trim() || "Valued Client"}</span></div>
            <div><span className="block text-xs font-bold uppercase text-slate-400">Phone</span><span className="font-bold">{clientPhone.trim() || "Not provided"}</span></div>
            <div><span className="block text-xs font-bold uppercase text-slate-400">City</span><span className="font-bold">{clientCity.trim() || "Not provided"}</span></div>
          </div>

          <div className="py-6">
            <QuoteTable lines={calculation.lines} />
          </div>

          <div className="ml-auto max-w-sm rounded-2xl bg-slate-950 p-5 text-white">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-bold text-slate-300">Final estimated cost</span>
              <span className="text-2xl font-black text-amber-400">{formatPkr(calculation.totalPkr)}</span>
            </div>
          </div>

          <div className="mt-6 grid gap-4 text-xs leading-5 text-slate-600 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-1 flex items-center gap-2 font-black text-slate-900"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Included</div>
              Capacity-specific cables, protection, accessories, earthing, installation, transport, testing and commissioning shown above.
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-1 font-black text-slate-900">Important</div>
              Estimate is valid for 3 days and subject to site survey, stock availability and final technical approval. Civil work outside the listed scope is excluded.
            </div>
          </div>

          <div className="public-quote-no-print mt-7 grid gap-3 sm:grid-cols-3">
            <button type="button" onClick={() => window.print()} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 font-black text-slate-950"><FileDown className="h-5 w-5" /> Save as PDF</button>
            <button type="button" onClick={sendToWhatsApp} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 font-black text-white"><MessageCircle className="h-5 w-5" /> Send on WhatsApp</button>
            <button type="button" onClick={reset} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 font-black text-slate-800"><RotateCcw className="h-5 w-5" /> Start again</button>
          </div>
          <div className="mt-7 flex items-center justify-center gap-2 text-center text-xs text-slate-400"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Generated instantly—no account or laptop required.</div>
        </section>
      ) : null}

      {calculation && !generated ? (
        <div className="public-quote-no-print fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white p-3 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] lg:hidden">
          <button type="button" onClick={generateQuote} className="mx-auto flex min-h-14 w-full max-w-lg items-center justify-between rounded-2xl bg-amber-400 px-5 text-slate-950">
            <span className="font-black">Generate My Quote</span><span className="font-black">{formatPkr(calculation.totalPkr)}</span>
          </button>
        </div>
      ) : null}
    </main>
  );
}
