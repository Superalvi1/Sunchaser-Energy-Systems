import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  FileDown,
  ImageDown,
  LoaderCircle,
  MessageCircle,
  Minus,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sun,
  Zap,
} from "lucide-react";
import {
  BATTERY_ACCESSORY_CATALOG,
  PANEL_CATALOG,
  inverterDisplayName,
} from "../lib/solarEquipmentCatalog";
import {
  PUBLIC_QUOTE_CAPACITIES,
  QUOTE_ITEM_PRICES,
  calculateCivilPadBreakdown,
  calculatePublicQuotation,
  defaultPublicQuoteConfig,
  publicQuoteBatteries,
  publicQuoteInverters,
  recommendedPanelQuantity,
  type PublicQuoteConfig,
  type PublicQuoteLine,
  type PublicQuoteStructure,
} from "../lib/publicQuotationBuilder";
import { normalizePakistanMobile } from "../lib/smartQuoteLead";
import { ProfessionalQuotationDocument } from "./ProfessionalQuotationDocument";
import { submitPublicSmartQuoteLead } from "../services/api";

const CONTACT_PHONE = "0330-7776444 / 0309-0236666";
const WHATSAPP_PHONE = "923307776444";

function formatPkr(value: number) {
  return `Rs. ${Math.round(value).toLocaleString("en-PK")}`;
}

function makeQuoteNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SES-${date}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function safeQuoteFilename(quoteNumber: string, extension: "pdf" | "png") {
  return `Sunchaser-Quotation-${quoteNumber.replace(/[^a-zA-Z0-9-]/g, "-")}.${extension}`;
}

async function renderQuotationCanvas() {
  const quotation = document.getElementById("generated-quotation");
  if (!quotation) throw new Error("Please generate the quotation before saving it.");
  await document.fonts?.ready;
  const { default: html2canvas } = await import("html2canvas-pro");
  return html2canvas(quotation, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false,
    windowWidth: 1100,
    ignoreElements: (element) => element.classList.contains("public-quote-no-print"),
    onclone: (clonedDocument) => {
      const clonedQuotation = clonedDocument.getElementById("generated-quotation");
      if (!clonedQuotation) return;
      clonedQuotation.style.width = "900px";
      clonedQuotation.style.maxWidth = "none";
      clonedQuotation.style.margin = "0";
      clonedQuotation.style.borderRadius = "0";
      clonedQuotation.style.boxShadow = "none";
      clonedQuotation.querySelectorAll<HTMLElement>(".public-quote-no-print").forEach((element) => {
        element.style.display = "none";
      });
    },
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create the quotation file.")), type, quality);
  });
}

async function saveOrShareFile(blob: Blob, filename: string, title: string) {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  const isTouchDevice = navigator.maxTouchPoints > 0;
  if (isTouchDevice && nav.canShare?.({ files: [file] }) && navigator.share) {
    await navigator.share({ files: [file], title });
    return "share" as const;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "download" as const;
}

async function createQuotationPdf(canvas: HTMLCanvasElement) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const margin = 8;
  const usableWidth = 210 - margin * 2;
  const usableHeight = 297 - margin * 2;
  const sliceHeight = Math.floor((canvas.width * usableHeight) / usableWidth);
  let offsetY = 0;
  let page = 0;

  while (offsetY < canvas.height) {
    const height = Math.min(sliceHeight, canvas.height - offsetY);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = height;
    const context = pageCanvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the PDF page.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(canvas, 0, offsetY, canvas.width, height, 0, 0, canvas.width, height);
    if (page > 0) pdf.addPage();
    const renderedHeight = (height * usableWidth) / canvas.width;
    pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.94), "JPEG", margin, margin, usableWidth, renderedHeight, undefined, "FAST");
    offsetY += height;
    page += 1;
  }
  return pdf.output("blob");
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

function SearchableSelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; keywords?: string }>;
  disabled?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        `${option.label} ${option.keywords || ""}`.toLowerCase().includes(normalizedQuery),
      )
    : options;

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setQuery("");
    setOpen(false);
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <span className="mb-2 block text-sm font-bold text-slate-800">{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-left text-[15px] font-semibold text-slate-900 shadow-sm outline-none transition hover:border-amber-300 focus:border-amber-500 focus:ring-4 focus:ring-amber-100 disabled:bg-slate-100 disabled:text-slate-600"
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label || "Select inverter"}</span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && !disabled ? (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Goodwe, Solis, Knox, 10 kW..."
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold text-slate-900 outline-none focus:border-amber-500 focus:bg-white focus:ring-2 focus:ring-amber-100"
              />
            </div>
          </div>
          <div role="listbox" className="max-h-72 overflow-y-auto p-1">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.value)}
                className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition ${option.value === value ? "bg-amber-50 font-bold text-slate-950" : "text-slate-700 hover:bg-slate-50"}`}
              >
                {option.label}
              </button>
            )) : (
              <div className="px-3 py-5 text-center text-sm text-slate-500">No inverter matches “{query}”.</div>
            )}
          </div>
        </div>
      ) : null}
      {hint ? <span className="mt-1.5 block text-xs leading-5 text-slate-500">{hint}</span> : null}
    </div>
  );
}

function QuantityField({
  label,
  value,
  onChange,
  min = 0,
  max = 300,
  hint,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  hint?: string;
  disabled?: boolean;
}) {
  const clamp = (value: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  return (
    <div>
      <span className="mb-2 block text-sm font-bold text-slate-800">{label}</span>
      <div className="flex min-h-14 items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button type="button" disabled={disabled || value <= min} aria-label={`Decrease ${label}`} onClick={() => onChange(clamp(value - 1))} className="grid h-14 w-14 place-items-center text-slate-700 hover:bg-slate-100 disabled:opacity-30">
          <Minus className="h-5 w-5" />
        </button>
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(clamp(Number(event.target.value)))}
          className="h-14 min-w-0 flex-1 border-x border-slate-200 text-center text-lg font-black outline-none disabled:bg-slate-100"
        />
        <button type="button" disabled={disabled || value >= max} aria-label={`Increase ${label}`} onClick={() => onChange(clamp(value + 1))} className="grid h-14 w-14 place-items-center text-slate-700 hover:bg-slate-100 disabled:opacity-30">
          <Plus className="h-5 w-5" />
        </button>
      </div>
      {hint ? <p className="mt-1.5 text-xs leading-5 text-slate-500">{hint}</p> : null}
    </div>
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

type QuotationBuilderMode = "public" | "staff";

export default function PublicQuotationBuilderPage({ mode = "public" }: { mode?: QuotationBuilderMode }) {
  const isStaffMode = mode === "staff";
  const [config, setConfig] = useState<PublicQuoteConfig>(() => defaultPublicQuoteConfig(8));
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientCity, setClientCity] = useState("");
  const [generated, setGenerated] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState(makeQuoteNumber);
  const [exporting, setExporting] = useState<"pdf" | "image" | null>(null);
  const [exportMessage, setExportMessage] = useState("");
  const [savingLead, setSavingLead] = useState(false);
  const [leadMessage, setLeadMessage] = useState("");
  const [leadError, setLeadError] = useState("");

  useEffect(() => {
    const previous = document.title;
    document.title = isStaffMode
      ? "Staff Solar Quote | Sunchaser Energy Systems"
      : "Build Your Solar Quote | Sunchaser Energy Systems";
    return () => {
      document.title = previous;
    };
  }, [isStaffMode]);

  const calculationState = useMemo(() => {
    try {
      return { calculation: calculatePublicQuotation(config, { allowDiscount: isStaffMode, allowCustomTransport: isStaffMode }), error: "" };
    } catch (error) {
      return { calculation: null, error: error instanceof Error ? error.message : "This combination needs manual review." };
    }
  }, [config, isStaffMode]);
  const calculation = calculationState.calculation;
  const inverters = publicQuoteInverters(config.systemCapacityKw);
  const selectedInverter = inverters.find((item) => item.id === config.inverterId);
  const batteries = publicQuoteBatteries(config.systemCapacityKw);
  const selectedBattery = batteries.find((item) => item.id === config.batteryId);
  const compatibleBatteryAccessories = selectedBattery?.id === "battery-knox-hv-5"
    ? BATTERY_ACCESSORY_CATALOG.filter((item) => item.model.includes("52Ah"))
    : selectedBattery?.id === "battery-knox-hv-10"
      ? BATTERY_ACCESSORY_CATALOG.filter((item) => item.model.includes("100Ah"))
      : [];
  const civilPad = calculateCivilPadBreakdown(config);
  const inverterSearchOptions = inverters.map((inverter) => ({
    value: inverter.id,
    label: `${inverterDisplayName(inverter)}${inverter.phase === "three" ? " 3P" : ""}${inverter.protection ? ` ${inverter.protection}` : ""} — ${formatPkr(inverter.pricePkr)}`,
    keywords: [
      inverter.brand,
      inverter.model,
      `${inverter.capacityKw} kW`,
      inverter.phase === "three" ? "three phase 3 phase 3p" : "single phase 1 phase",
      inverter.protection || "",
      inverter.voltageClass || "",
    ].join(" "),
  }));
  const batterySearchOptions = selectedInverter?.bundle
    ? [{
        value: selectedInverter.bundle.batteryId,
        label: selectedInverter.bundle.batteryLabel,
        keywords: `${selectedInverter.bundle.batteryLabel} bundled battery`,
      }]
    : batteries.map((battery) => ({
        value: battery.id,
        label: `${battery.brand} ${battery.model !== "Lithium" ? `${battery.model} · ` : ""}${battery.capacityKwh}kWh${battery.protection ? ` ${battery.protection}` : ""} — ${formatPkr(battery.pricePkr)}`,
        keywords: [
          battery.brand,
          battery.model,
          `${battery.capacityKwh} kWh`,
          battery.protection || "",
          battery.voltageClass || "",
        ].join(" "),
      }));

  const updateConfig = (patch: Partial<PublicQuoteConfig>) => {
    setGenerated(false);
    setLeadMessage("");
    setLeadError("");
    setConfig((current) => ({ ...current, ...patch }));
  };
  const toggleItem = (key: keyof PublicQuoteConfig["included"]) => {
    if (key === "battery" && selectedInverter?.bundle && config.included.inverter) return;
    const next = !config.included[key];
    updateConfig({ included: { ...config.included, [key]: next, ...(key === "inverter" && !next && selectedInverter?.bundle ? { battery: false } : {}) } });
  };
  const itemToggle = (key: keyof PublicQuoteConfig["included"], label: string) => (
    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
      <input type="checkbox" checked={config.included[key]} disabled={key === "battery" && Boolean(selectedInverter?.bundle) && config.included.inverter} onChange={() => toggleItem(key)} className="h-5 w-5 accent-amber-500 disabled:opacity-50" />
      {label}
    </label>
  );

  const selectCapacity = (capacity: (typeof PUBLIC_QUOTE_CAPACITIES)[number]) => {
    const next = defaultPublicQuoteConfig(capacity);
    const panel = PANEL_CATALOG.find((item) => item.id === config.panelId) || PANEL_CATALOG[0];
    setGenerated(false);
    const panelQuantity = recommendedPanelQuantity(capacity, panel.watts);
    setConfig({
      ...next,
      panelId: panel.id,
      panelQuantity,
      structurePanelQuantity: panelQuantity,
      mixedL2StandQuantity: Math.ceil(panelQuantity / 2),
      included: config.included,
      acCableBrand: config.acCableBrand,
      acCableMeters: config.acCableMeters,
      dcCableBrand: config.dcCableBrand,
      dcCableMeters: config.dcCableMeters,
      earthingCableMeters: config.earthingCableMeters,
      earthingBoreCount: config.earthingBoreCount,
      transportationPkr: config.transportationPkr,
      transportOutOfCity: config.transportOutOfCity,
      discountPkr: config.discountPkr,
      inverterId: config.inverterId,
      wiringPhase: config.wiringPhase,
      batteryId: config.batteryId,
    });
  };

  const selectPanel = (panelId: string) => {
    const panel = PANEL_CATALOG.find((item) => item.id === panelId);
    if (!panel) return;
    const panelQuantity = recommendedPanelQuantity(config.systemCapacityKw, panel.watts);
    updateConfig({
      panelId,
      panelQuantity,
      structurePanelQuantity: panelQuantity,
      mixedL2StandQuantity: Math.ceil(panelQuantity / 2),
    });
  };

  const selectInverter = (inverterId: string) => {
    const inverter = inverters.find((item) => item.id === inverterId);
    if (!inverter) return;
    updateConfig({
      inverterId,
      batteryId: inverter.bundle?.batteryId || batteries[0]?.id || "",
      wiringPhase: inverter.phase === "three" ? "three" : "single",
    });
  };

  const toggleBatteryAccessory = (accessoryId: string) => {
    const selected = config.batteryAccessoryIds.includes(accessoryId);
    updateConfig({
      batteryAccessoryIds: selected
        ? config.batteryAccessoryIds.filter((id) => id !== accessoryId)
        : [...config.batteryAccessoryIds, accessoryId],
    });
  };

  const generateQuote = async () => {
    if (!calculation) return;
    const nextQuoteNumber = makeQuoteNumber();

    if (isStaffMode) {
      setQuoteNumber(nextQuoteNumber);
      setGenerated(true);
      setLeadError("");
      setLeadMessage("Internal quotation generated. No Smart Quote lead was created.");
      window.setTimeout(() => document.getElementById("generated-quotation")?.scrollIntoView({ behavior: "smooth" }), 50);
      return;
    }

    const name = clientName.trim();
    const phone = normalizePakistanMobile(clientPhone);
    if (!name) {
      setLeadError("Please enter your name so our team can identify your quotation.");
      document.getElementById("smart-quote-client-name")?.focus();
      return;
    }
    if (!phone) {
      setLeadError("Please enter a valid Pakistan mobile number, for example 0300-1234567, +923001234567, or 00923001234567.");
      document.getElementById("smart-quote-client-phone")?.focus();
      return;
    }

    setSavingLead(true);
    setLeadError("");
    setLeadMessage("");
    try {
      await submitPublicSmartQuoteLead({
        name,
        phone,
        city: clientCity.trim() || undefined,
        quoteNumber: nextQuoteNumber,
        systemCapacityKw: calculation.systemCapacityKw,
        estimatedTotalPkr: calculation.totalPkr,
        panel: config.included.panels ? `${config.panelQuantity} × ${calculation.panel.brand} ${calculation.panel.watts}W` : "Not included",
        inverter: config.included.inverter ? `${config.inverterQuantity} × ${inverterDisplayName(calculation.inverter)}` : "Not included",
        battery: config.included.battery ? `${selectedInverter?.bundle ? config.inverterQuantity : config.batteryQuantity} × ${calculation.battery.brand} ${calculation.battery.capacityKwh}kWh` : "Not included",
        structure: calculation.structureLabel,
        generatedAt: new Date().toISOString(),
      });
      setQuoteNumber(nextQuoteNumber);
      setGenerated(true);
      setLeadMessage("Quotation generated. Your request is now visible to the Sunchaser sales team.");
      window.setTimeout(() => document.getElementById("generated-quotation")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : "Could not save your details. Please try again.");
    } finally {
      setSavingLead(false);
    }
  };

  const sendToWhatsApp = () => {
    if (!calculation) return;
    const message = [
      "Hello Sunchaser Energy Systems,",
      `I generated quotation ${quoteNumber} for a ${calculation.systemCapacityKw} kW solar system.`,
      config.included.panels ? `${calculation.panel.brand} ${calculation.panel.watts}W × ${config.panelQuantity}` : "",
      config.included.inverter ? `${config.inverterQuantity} × ${inverterDisplayName(calculation.inverter)} inverter` : "",
      config.included.battery ? `${selectedInverter?.bundle ? config.inverterQuantity : config.batteryQuantity} × ${calculation.battery.brand} ${calculation.battery.capacityKwh} kWh battery` : "",
      config.included.acCable ? `AC cable: ${config.acCableBrand} · ${config.acCableMeters} m` : "",
      config.included.dcCable ? `DC cable: ${config.dcCableBrand} · ${config.dcCableMeters} m` : "",
      config.included.structure ? `${calculation.structureLabel} (capacity: ${calculation.configuredStructureCapacityPanels} panels)` : "",
      `Estimated total: ${formatPkr(calculation.totalPkr)}`,
      clientName.trim() ? `Name: ${clientName.trim()}` : "",
      clientCity.trim() ? `City: ${clientCity.trim()}` : "",
    ].filter(Boolean).join("\n");
    window.open(`https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  const savePdf = async () => {
    setExporting("pdf");
    setExportMessage("");
    try {
      const canvas = await renderQuotationCanvas();
      const blob = await createQuotationPdf(canvas);
      const method = await saveOrShareFile(blob, safeQuoteFilename(quoteNumber, "pdf"), `Sunchaser quotation ${quoteNumber}`);
      setExportMessage(method === "share" ? "PDF is ready. Choose Save to Files or share it." : "PDF downloaded successfully.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setExportMessage(error instanceof Error ? error.message : "Could not save the PDF. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  const savePicture = async () => {
    setExporting("image");
    setExportMessage("");
    try {
      const canvas = await renderQuotationCanvas();
      const blob = await canvasToBlob(canvas, "image/png");
      const method = await saveOrShareFile(blob, safeQuoteFilename(quoteNumber, "png"), `Sunchaser quotation ${quoteNumber}`);
      setExportMessage(method === "share" ? "Picture is ready. Choose Save Image or share it." : "Quotation picture downloaded successfully.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setExportMessage(error instanceof Error ? error.message : "Could not save the picture. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  const reset = () => {
    setConfig(defaultPublicQuoteConfig(8));
    setClientName("");
    setClientPhone("");
    setClientCity("");
    setGenerated(false);
    setExportMessage("");
    setLeadMessage("");
    setLeadError("");
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
              <h1 className="truncate text-base font-black tracking-tight sm:text-lg">{isStaffMode ? "Sunchaser Staff Quote" : "Sunchaser Solar Quote"}</h1>
              <p className="text-xs text-slate-500">{isStaffMode ? "Private quotation builder · client details optional" : "Choose your system. See your price instantly."}</p>
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
            <p className="mt-3 text-xs text-slate-500">System size suggests panel quantity only. You may choose any inverter size below.</p>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-100 text-sm font-black text-amber-900">2</span>
              <div>
                <h2 className="text-lg font-black">Choose equipment</h2>
                <p className="text-sm text-slate-500">Select equipment independently and include only what the client needs.</p>
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">{itemToggle("panels", "Include solar panels")}</div>
              {config.included.panels ? <><SelectField label="Solar panel" value={config.panelId} onChange={selectPanel}>
                {PANEL_CATALOG.map((panel) => (
                  <option key={panel.id} value={panel.id}>
                    {panel.brand} {panel.watts}W — Rs. {panel.pricePerWattPkr}/W
                  </option>
                ))}
              </SelectField>

              <QuantityField
                label="Number of panels"
                value={config.panelQuantity}
                min={1}
                max={200}
                onChange={(panelQuantity) => updateConfig({ panelQuantity })}
                hint={calculation ? `Panel array: ${calculation.configuredPanelCapacityKw.toFixed(2)} kW` : undefined}
              /></> : null}

              <div className="sm:col-span-2">{itemToggle("inverter", "Include hybrid inverter")}</div>
              {config.included.inverter ? <>
              <SearchableSelectField
                label="Hybrid inverter"
                value={config.inverterId}
                onChange={selectInverter}
                options={inverterSearchOptions}
                hint="Search by brand, model, capacity, phase or protection."
              />

              <QuantityField
                label="Number of inverters"
                value={config.inverterQuantity}
                min={1}
                max={10}
                onChange={(inverterQuantity) => updateConfig({ inverterQuantity })}
                hint="The selected inverter price is multiplied by this quantity."
              /></> : null}

              <div className="sm:col-span-2">{itemToggle("battery", "Include lithium battery")}{selectedInverter?.bundle && config.included.inverter ? <p className="text-xs text-slate-500">This inverter comes with its battery. Choose a different inverter to exclude the battery.</p> : null}</div>
              {config.included.battery ? <>
              <SearchableSelectField
                label="Lithium battery"
                value={selectedInverter?.bundle?.batteryId || config.batteryId}
                disabled={Boolean(selectedInverter?.bundle)}
                onChange={(batteryId) => updateConfig({ batteryId, batteryAccessoryIds: [] })}
                options={batterySearchOptions}
                hint={selectedInverter?.bundle ? "This inverter includes its matching battery automatically." : "Search by brand, model, capacity, IP rating or voltage class."}
              />

              <QuantityField
                label="Number of batteries"
                value={selectedInverter?.bundle ? config.inverterQuantity : config.batteryQuantity}
                min={1}
                max={20}
                disabled={Boolean(selectedInverter?.bundle)}
                onChange={(batteryQuantity) => updateConfig({ batteryQuantity })}
                hint={selectedInverter?.bundle ? "One FOX battery is included per inverter." : "Choose one or more batteries of any listed capacity."}
              /></> : null}

              {config.included.battery && compatibleBatteryAccessories.length ? <div className="sm:col-span-2">
                <div className="mb-2 text-sm font-bold text-slate-700">Optional Knox HV accessories</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {compatibleBatteryAccessories.map((accessory) => {
                    const selected = config.batteryAccessoryIds.includes(accessory.id);
                    return (
                      <button
                        key={accessory.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleBatteryAccessory(accessory.id)}
                        className={`rounded-xl border px-3 py-3 text-left text-sm transition ${selected ? "border-amber-500 bg-amber-50 font-bold text-slate-950" : "border-slate-200 bg-white text-slate-700 hover:border-amber-300"}`}
                      >
                        <span className="block">{selected ? "✓ " : "+ "}{accessory.brand} {accessory.model}</span>
                        <span className="mt-1 block text-xs text-slate-500">{formatPkr(accessory.pricePkr)}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-slate-500">Select only the HV control box and base wheel required for a custom high-voltage stack. Complete PowerStack battery prices are already available in the battery list.</p>
              </div> : null}
            </div>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-100 text-sm font-black text-amber-900">3</span>
              <div>
                <h2 className="text-lg font-black">Choose panel structure</h2>
                <p className="text-sm text-slate-500">Structure capacity can be different from the installed panel quantity.</p>
              </div>
            </div>
            {itemToggle("structure", "Include panel structure")}
            {config.included.structure ? <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {([
                ["standard-l2", "L2 standard", "2 panels per stand · Rs. 4,500"],
                ["standard-l3", "L3 standard", "3 panels per stand · Rs. 7,200"],
                ["elevated", "Elevated", "Panels × watts × Rs. 16"],
                ["mixed", "Mix structures", "Combine L2, L3 and elevated"],
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

            {config.structureType === "mixed" ? (
              <div className="mt-5 grid gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3">
                <QuantityField label="L2 stands" value={config.mixedL2StandQuantity} max={150} onChange={(mixedL2StandQuantity) => updateConfig({ mixedL2StandQuantity })} hint={`${config.mixedL2StandQuantity * 2} panel capacity`} />
                <QuantityField label="L3 stands" value={config.mixedL3StandQuantity} max={100} onChange={(mixedL3StandQuantity) => updateConfig({ mixedL3StandQuantity })} hint={`${config.mixedL3StandQuantity * 3} panel capacity`} />
                <QuantityField label="Elevated panels" value={config.mixedElevatedPanelQuantity} max={300} onChange={(mixedElevatedPanelQuantity) => updateConfig({ mixedElevatedPanelQuantity })} hint="Panels supported by elevated structure" />
              </div>
            ) : (
              <div className="mt-5 max-w-sm rounded-2xl bg-slate-50 p-4">
                <QuantityField
                  label="Structure capacity (panels)"
                  value={config.structurePanelQuantity}
                  min={1}
                  max={300}
                  onChange={(structurePanelQuantity) => updateConfig({ structurePanelQuantity })}
                  hint={`You can install ${config.panelQuantity} panels now and buy structure capacity for a different number.`}
                />
              </div>
            )}

            {calculation && config.included.panels ? (
              <div className={`mt-4 rounded-2xl border p-4 text-sm ${calculation.configuredStructureCapacityPanels < config.panelQuantity ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                <span className="font-black">Structure capacity: {calculation.configuredStructureCapacityPanels} panels.</span>{" "}
                {calculation.configuredStructureCapacityPanels < config.panelQuantity
                  ? `This is short of the ${config.panelQuantity} panels being installed. Increase the structure capacity.`
                  : `This covers the ${config.panelQuantity} installed panels${calculation.configuredStructureCapacityPanels > config.panelQuantity ? " and leaves room for expansion" : ""}.`}
              </div>
            ) : null}
            </> : null}
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-100 text-sm font-black text-amber-900">4</span>
              <div>
                <h2 className="text-lg font-black">Cables, protection and services</h2>
                <p className="text-sm text-slate-500">Untick anything the client will provide. Lengths and selected charges appear in the quotation.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-4">
                {itemToggle("acCable", `AC cable · Rs. ${QUOTE_ITEM_PRICES.acCable}/meter`)}
                {config.included.acCable ? <div className="mt-2 grid gap-3">
                  <SelectField label="AC cable brand" value={config.acCableBrand} onChange={(acCableBrand) => updateConfig({ acCableBrand: acCableBrand as PublicQuoteConfig["acCableBrand"] })}>
                    <option value="Pakistan Cables">Pakistan Cables</option><option value="Industrial Innovative">Industrial Innovative</option>
                  </SelectField>
                  <QuantityField label="AC cable length (meters)" value={config.acCableMeters} min={1} max={10_000} onChange={(acCableMeters) => updateConfig({ acCableMeters })} />
                </div> : null}
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                {itemToggle("dcCable", `DC cable · Rs. ${QUOTE_ITEM_PRICES.dcCable}/meter`)}
                {config.included.dcCable ? <div className="mt-2 grid gap-3">
                  <SelectField label="DC cable brand" value={config.dcCableBrand} onChange={(dcCableBrand) => updateConfig({ dcCableBrand: dcCableBrand as PublicQuoteConfig["dcCableBrand"] })}>
                    <option value="Pakistan Cables">Pakistan Cables</option><option value="Industrial Innovative">Industrial Innovative</option>
                  </SelectField>
                  <QuantityField label="DC cable length (meters)" value={config.dcCableMeters} min={1} max={10_000} onChange={(dcCableMeters) => updateConfig({ dcCableMeters })} />
                </div> : null}
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                {itemToggle("breakers", "Breakers and protection")}
                <div className="mt-2"><SelectField label="Wiring phase" value={config.wiringPhase} onChange={(wiringPhase) => updateConfig({ wiringPhase: wiringPhase as PublicQuoteConfig["wiringPhase"] })}>
                  <option value="single">Single phase · Rs. 20,000</option><option value="three">Three phase · Rs. 25,000</option>
                </SelectField></div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                {itemToggle("miscellaneous", `Miscellaneous · Rs. ${QUOTE_ITEM_PRICES.miscellaneous.toLocaleString("en-PK")}`)}
                <p className="mt-1 text-xs text-slate-500">Duct pipes, fittings and electrical accessories for the selected phase.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                {itemToggle("earthingCable", `Earthing cable · Rs. ${QUOTE_ITEM_PRICES.earthingCable}/meter`)}
                {config.included.earthingCable ? <div className="mt-2"><QuantityField label="Earthing cable length (meters)" value={config.earthingCableMeters} min={1} max={10_000} onChange={(earthingCableMeters) => updateConfig({ earthingCableMeters })} /></div> : null}
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                {itemToggle("earthingBore", "Earthing bore · Rs. 9,000 each")}
                {config.included.earthingBore ? <div className="mt-2"><SelectField label="Number of bores" value={String(config.earthingBoreCount)} onChange={(value) => updateConfig({ earthingBoreCount: Number(value) as 1 | 2 })}>
                  <option value="1">One bore · Rs. 9,000</option><option value="2">Two bores · Rs. 18,000</option>
                </SelectField></div> : null}
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                {itemToggle("civilPad", `Civil pads · Rs. ${QUOTE_ITEM_PRICES.civilPadPerLeg}/leg`)}
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {civilPad.totalLegs > 0
                    ? `${civilPad.l2Stands ? `${civilPad.l2Stands} L2 stand${civilPad.l2Stands === 1 ? "" : "s"} × 4 legs${civilPad.l3Stands ? " + " : ""}` : ""}${civilPad.l3Stands ? `${civilPad.l3Stands} L3 stand${civilPad.l3Stands === 1 ? "" : "s"} × 6 legs` : ""} = ${civilPad.totalLegs} pads · ${formatPkr(civilPad.totalPkr)}`
                    : "Civil pads apply to L2/L3 stands. Elevated-only structure has no civil-pad charge."}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">{itemToggle("lightningArrester", "Lightning arrester · Rs. 6,000")}</div>
              <div className="rounded-2xl border border-slate-200 p-4">{itemToggle("installation", "Installation and wiring · Rs. 4/W")}</div>
              <div className="rounded-2xl border border-slate-200 p-4">
                {itemToggle("transport", "Transportation")}
                {config.included.transport ? <div className="mt-2 text-xs text-slate-500">Within city: Rs. 10,000.
                  {isStaffMode ? <><label className="mt-2 flex items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" checked={config.transportOutOfCity} onChange={(event) => updateConfig({ transportOutOfCity: event.target.checked })} className="h-5 w-5 accent-amber-500" />Out-of-city travel</label>
                    {config.transportOutOfCity ? <label className="mt-2 block text-sm font-bold text-slate-700">Out-of-city transport charge (Rs.)
                      <input type="number" min="0" max="1000000" step="1" value={config.transportationPkr} onChange={(event) => updateConfig({ transportationPkr: Number(event.target.value) })} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base" />
                    </label> : null}</> : null}
                </div> : null}
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">{itemToggle("survey", "Survey and design · Rs. 5,000")}</div>
            </div>
          </div>

          {isStaffMode ? <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-lg font-black">Staff discount</h2>
            <p className="mt-1 text-sm text-slate-500">Enter an amount to discount or round the final total. The PDF shows the subtotal and discount.</p>
            <label className="mt-4 block max-w-xs text-sm font-bold text-slate-700">Discount (Rs.)
              <input type="number" min="0" max={calculation?.subtotalPkr || undefined} step="1" value={config.discountPkr} onChange={(event) => updateConfig({ discountPkr: Number(event.target.value) })} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base" />
            </label>
            {calculation ? <button type="button" onClick={() => updateConfig({ discountPkr: calculation.subtotalPkr % 1_000 })} className="mt-3 min-h-11 rounded-xl border border-amber-400 px-4 text-sm font-bold text-slate-800">Round total down to nearest Rs. 1,000</button> : null}
          </div> : null}

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-100 text-sm font-black text-amber-900">5</span>
              <div>
                <h2 className="text-lg font-black">{isStaffMode ? "Client details (optional)" : "Your contact details"}</h2>
                <p className="text-sm text-slate-500">{isStaffMode ? "Leave these blank when you need a quick internal quotation. No CRM lead will be created." : "Name and mobile number are required so our sales team can follow up on this quote."}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                [isStaffMode ? "Client name" : "Your name *", clientName, setClientName, "e.g. Hassan", "smart-quote-client-name", "text"],
                [isStaffMode ? "Mobile number" : "Mobile number *", clientPhone, setClientPhone, "03XX-XXXXXXX", "smart-quote-client-phone", "tel"],
                ["City", clientCity, setClientCity, "e.g. Lahore", "smart-quote-client-city", "text"],
              ].map(([label, value, setter, placeholder, id, type]) => (
                <label key={label as string} className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-800">{label as string}</span>
                  <input id={id as string} type={type as string} value={value as string} onChange={(event) => { (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value); setGenerated(false); setLeadMessage(""); setLeadError(""); }} placeholder={placeholder as string} className="min-h-14 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100" />
                </label>
              ))}
            </div>
            {leadError ? <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{leadError}</div> : null}
            {leadMessage ? <div role="status" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{leadMessage}</div> : null}
          </div>
        </section>

        <aside className="h-fit rounded-3xl bg-slate-950 p-5 text-white shadow-xl lg:sticky lg:top-24">
          <div className="flex items-center gap-2 text-amber-400"><Zap className="h-5 w-5" /><span className="text-sm font-black uppercase tracking-wide">Your estimate</span></div>
          {calculation ? (
            <>
              <div className="mt-4 text-3xl font-black">{formatPkr(calculation.totalPkr)}</div>
              <div className="mt-1 text-sm text-slate-400">Complete {calculation.systemCapacityKw} kW quotation</div>
              <div className="my-5 space-y-3 border-y border-white/10 py-5 text-sm">
                <div className="flex justify-between gap-3"><span className="text-slate-400">Panels</span><span className="text-right font-bold">{config.included.panels ? `${config.panelQuantity} × ${calculation.panel.watts}W` : "Excluded"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-400">Inverter</span><span className="text-right font-bold">{config.included.inverter ? `${config.inverterQuantity} × ${inverterDisplayName(calculation.inverter)}` : "Excluded"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-400">Battery</span><span className="text-right font-bold">{config.included.battery ? `${selectedInverter?.bundle ? config.inverterQuantity : config.batteryQuantity} × ${calculation.battery.brand} ${calculation.battery.capacityKwh}kWh` : "Excluded"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-400">Structure</span><span className="text-right font-bold">{calculation.structureLabel}</span></div>
                {calculation.discountPkr > 0 ? <><div className="flex justify-between gap-3"><span>Subtotal</span><span>{formatPkr(calculation.subtotalPkr)}</span></div><div className="flex justify-between gap-3 text-emerald-300"><span>Discount</span><span>−{formatPkr(calculation.discountPkr)}</span></div></> : null}
              </div>
              <button type="button" disabled={savingLead || generated} onClick={() => void generateQuote()} className="min-h-14 w-full rounded-2xl bg-amber-400 px-5 text-base font-black text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70">
                {savingLead ? <span className="inline-flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /> Saving…</span> : generated ? "Quote Generated" : isStaffMode ? "Generate Quotation" : "Generate My Quote"}
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-slate-400">{isStaffMode ? "Staff-only mode. This quotation is not added to Smart Quote Leads." : "No login needed. Generating the quote sends your details and selections to Sunchaser for follow-up."}</p>
            </>
          ) : (
            <div className="mt-4 rounded-2xl bg-red-500/10 p-4 text-sm leading-6 text-red-200">{calculationState.error}</div>
          )}
        </aside>
      </div>

      {generated && calculation ? (
        <section className="mx-auto mb-28 max-w-5xl px-4 sm:mb-12">
          <ProfessionalQuotationDocument
            calculation={calculation}
            config={config}
            quoteNumber={quoteNumber}
            clientName={clientName}
            clientPhone={clientPhone}
            clientCity={clientCity}
            batteryQuantity={selectedInverter?.bundle ? config.inverterQuantity : config.batteryQuantity}
          />

          <div className="public-quote-no-print mx-auto mt-5 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button type="button" disabled={Boolean(exporting)} onClick={savePdf} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 font-black text-slate-950 shadow-sm disabled:cursor-wait disabled:opacity-60">
              {exporting === "pdf" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <FileDown className="h-5 w-5" />}
              {exporting === "pdf" ? "Preparing PDF..." : "Save PDF"}
            </button>
            <button type="button" disabled={Boolean(exporting)} onClick={savePicture} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 font-black text-white shadow-sm disabled:cursor-wait disabled:opacity-60">
              {exporting === "image" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ImageDown className="h-5 w-5" />}
              {exporting === "image" ? "Preparing image..." : "Save Picture"}
            </button>
            <button type="button" onClick={sendToWhatsApp} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 font-black text-white shadow-sm"><MessageCircle className="h-5 w-5" /> WhatsApp</button>
            <button type="button" onClick={reset} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 font-black text-slate-800 shadow-sm"><RotateCcw className="h-5 w-5" /> Start again</button>
          </div>
          {exportMessage ? <div className="public-quote-no-print mx-auto mt-3 max-w-4xl rounded-2xl bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800">{exportMessage}</div> : null}
        </section>
      ) : null}

      {calculation && !generated ? (
        <div className="public-quote-no-print fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white p-3 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] lg:hidden">
          <button type="button" onClick={generateQuote} className="mx-auto flex min-h-14 w-full max-w-lg items-center justify-between rounded-2xl bg-amber-400 px-5 text-slate-950">
            <span className="font-black">{isStaffMode ? "Generate Quotation" : "Generate My Quote"}</span><span className="font-black">{formatPkr(calculation.totalPkr)}</span>
          </button>
        </div>
      ) : null}
    </main>
  );
}
