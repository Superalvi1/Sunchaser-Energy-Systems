import React, { useMemo, useState } from "react";
import { getLiveCatalogProducts } from "../lib/boqCatalog";
import {
  AUTOSIZER_PRESET_SIZES_KW,
  AUTOSIZER_PRESETS,
  L3_STRUCTURE_CUSTOMER_NAME,
  L2_STRUCTURE_CUSTOMER_NAME,
  batteryPresetSelectValue,
  findCatalogProduct,
  hydrateCompanySizePreset,
  parseCompanyAutoSizerPresets,
  wattageFromCatalogProduct,
  capacityFromCatalogProduct,
  type AutoSizerPresetSizeKw,
  type CompanyAutoSizerPresets,
  type CompanyAutoSizerSizePreset,
  type CatalogProductLike,
} from "../lib/autoSizer";
import { API_BASE_URL, authorizedFetch } from "../services/api";
import { useToast } from "../lib/toast";

type SizeDraft = {
  panelProductId: string;
  inverterProductId: string;
  batteryProductId: string;
  dcCableProductId: string;
  acCableProductId: string;
  batteryOption: string;
};

function emptyDraft(): SizeDraft {
  return {
    panelProductId: "",
    inverterProductId: "",
    batteryProductId: "",
    dcCableProductId: "",
    acCableProductId: "",
    batteryOption: "",
  };
}

function draftFromPreset(preset: CompanyAutoSizerSizePreset | undefined): SizeDraft {
  return {
    panelProductId: preset?.panelProductId || "",
    inverterProductId: preset?.inverterProductId || "",
    batteryProductId: preset?.batteryProductId || "",
    dcCableProductId: preset?.dcCableProductId || "",
    acCableProductId: preset?.acCableProductId || "",
    batteryOption: preset?.batteryOption || "",
  };
}

function categoryOf(product: CatalogProductLike | Record<string, unknown>): string {
  return String(product.category || "").toLowerCase();
}

function isPanel(product: Record<string, unknown>): boolean {
  const cat = categoryOf(product);
  return cat.includes("panel") && !cat.includes("inverter");
}

function isInverter(product: Record<string, unknown>): boolean {
  return categoryOf(product).includes("inverter");
}

function isBattery(product: Record<string, unknown>): boolean {
  return categoryOf(product).includes("batter");
}

function isDcCable(product: Record<string, unknown>): boolean {
  const cat = categoryOf(product);
  const label = `${product.model || ""} ${product.name || ""}`.toLowerCase();
  return (cat.includes("cable") || cat.includes("conductor")) && (label.includes("dc") || label.includes("sq.mm"));
}

function isAcCable(product: Record<string, unknown>): boolean {
  const cat = categoryOf(product);
  const label = `${product.model || ""} ${product.name || ""}`.toLowerCase();
  return (cat.includes("cable") || cat.includes("conductor")) && label.includes("ac");
}

function productLabel(product: Record<string, unknown>): string {
  const brand = String(product.brand || "").trim();
  const model = String(product.model || product.name || product.id || "").trim();
  return [brand, model].filter(Boolean).join(" ");
}

function typedFallbackLabel(kw: AutoSizerPresetSizeKw): string {
  const p = AUTOSIZER_PRESETS[kw];
  return `Typed default — ${p.panel.brand} ${p.panel.wattage}W / ${p.inverter.brand} ${p.inverter.capacity} / ${p.battery.option}`;
}

export default function AutoSizerPresetsAdmin({
  settings,
  products,
  onSaved,
  syncing,
}: {
  settings: unknown;
  products: unknown[] | null | undefined;
  onSaved?: () => void | Promise<void>;
  syncing?: boolean;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const live = useMemo(() => getLiveCatalogProducts(products || []), [products]);
  const panels = useMemo(() => live.filter(isPanel), [live]);
  const inverters = useMemo(() => live.filter(isInverter), [live]);
  const batteries = useMemo(() => live.filter(isBattery), [live]);
  const dcCables = useMemo(() => live.filter(isDcCable), [live]);
  const acCables = useMemo(() => {
    const ac = live.filter(isAcCable);
    return ac.length ? ac : live.filter((p) => categoryOf(p).includes("cable"));
  }, [live]);

  const parsed = useMemo(() => parseCompanyAutoSizerPresets(settings), [settings]);
  const [draft, setDraft] = useState<Record<AutoSizerPresetSizeKw, SizeDraft>>(() => ({
    6: draftFromPreset(parsed[6] || parsed["6"]),
    8: draftFromPreset(parsed[8] || parsed["8"]),
    10: draftFromPreset(parsed[10] || parsed["10"]),
  }));

  const patchSize = (kw: AutoSizerPresetSizeKw, patch: Partial<SizeDraft>) => {
    setDraft((prev) => ({ ...prev, [kw]: { ...prev[kw], ...patch } }));
  };

  const handleSave = async () => {
    const cleaned: CompanyAutoSizerPresets = {};
    for (const kw of AUTOSIZER_PRESET_SIZES_KW) {
      const row = draft[kw] || emptyDraft();
      const size: CompanyAutoSizerSizePreset = {};
      if (row.panelProductId) {
        size.panelProductId = row.panelProductId;
        const product = findCatalogProduct(live as CatalogProductLike[], row.panelProductId);
        if (product) {
          size.panelBrand = String(product.brand || product.name || "").trim() || undefined;
          size.panelWattage = wattageFromCatalogProduct(product);
        }
      }
      if (row.inverterProductId) {
        size.inverterProductId = row.inverterProductId;
        const product = findCatalogProduct(live as CatalogProductLike[], row.inverterProductId);
        if (product) {
          size.inverterBrand = String(product.brand || product.name || "").trim() || undefined;
          size.inverterCapacity = capacityFromCatalogProduct(product);
        }
      }
      if (row.batteryProductId) {
        size.batteryProductId = row.batteryProductId;
        const product = findCatalogProduct(live as CatalogProductLike[], row.batteryProductId);
        if (product && !row.batteryOption) {
          size.batteryOption =
            `${product.brand || ""} ${product.model || product.name || ""}`.trim() ||
            String(product.wattageCapacity || "");
        }
      }
      if (row.batteryOption) size.batteryOption = row.batteryOption;
      if (row.dcCableProductId) {
        size.dcCableProductId = row.dcCableProductId;
        const product = findCatalogProduct(live as CatalogProductLike[], row.dcCableProductId);
        if (product) size.dcCableSize = String(product.model || product.name || "").trim() || undefined;
      }
      if (row.acCableProductId) {
        size.acCableProductId = row.acCableProductId;
        const product = findCatalogProduct(live as CatalogProductLike[], row.acCableProductId);
        if (product) size.acCableSize = String(product.model || product.name || "").trim() || undefined;
      }
      cleaned[kw] = size;
    }
    setSaving(true);
    try {
      const res = await authorizedFetch(`${API_BASE_URL}/api/admin/autosizer-presets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoSizerPresets: cleaned }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || "Could not save AutoSizer presets.");
      }
      toast.success("AutoSizer presets saved.");
      await onSaved?.();
    } catch (err: any) {
      toast.error(err?.message || "Could not save AutoSizer presets.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-sm space-y-5 text-left">
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 font-mono">AutoSizer Presets</h4>
        <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
          Owner defaults for everyday 6 / 8 / 10 kW Auto Size. Missing or invalid values fall back to typed package-library presets.
          Catalog product picks are stored as identity (catalogProductId) only — AutoSizer still uses company commercial quotation rates, not catalog price. Manual BOQ catalog picker continues to seed the line rate from product.price.
          On-grid Auto Size never auto-adds a hybrid battery. Structure kits stay quotation-only: {L3_STRUCTURE_CUSTOMER_NAME} and {L2_STRUCTURE_CUSTOMER_NAME}.
        </p>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-3 text-[11px] text-neutral-400">
        Standard structure is calculated from panel count. Example: 10 panels → 2 × L3 + 2 × L2. These kit lines are not the inventory SKU “Standard GI Structure L3”.
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {AUTOSIZER_PRESET_SIZES_KW.map((kw) => {
          const typed = AUTOSIZER_PRESETS[kw];
          const hydrated = hydrateCompanySizePreset(parsed[kw] || parsed[String(kw) as "6"], live as CatalogProductLike[]);
          const row = draft[kw];
          return (
            <div key={kw} className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h5 className="text-sm font-bold text-neutral-100 font-mono">{kw} kW</h5>
                <span className="text-[9px] text-neutral-500 font-mono">fallback: {typed.battery.option}</span>
              </div>
              <p className="text-[10px] text-neutral-500 leading-relaxed">{typedFallbackLabel(kw)}</p>

              <label className="block space-y-1">
                <span className="text-[9px] uppercase tracking-wider text-neutral-500 font-mono">Default panel</span>
                <select
                  value={row.panelProductId}
                  onChange={(e) => patchSize(kw, { panelProductId: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-2 py-1.5 text-xs text-neutral-100"
                >
                  <option value="">{`Typed default — ${typed.panel.brand} ${typed.panel.wattage}W`}</option>
                  {panels.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>
                      {productLabel(p)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[9px] uppercase tracking-wider text-neutral-500 font-mono">Default inverter</span>
                <select
                  value={row.inverterProductId}
                  onChange={(e) => patchSize(kw, { inverterProductId: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-2 py-1.5 text-xs text-neutral-100"
                >
                  <option value="">{`Typed default — ${typed.inverter.brand} ${typed.inverter.capacity}`}</option>
                  {inverters.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>
                      {productLabel(p)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[9px] uppercase tracking-wider text-neutral-500 font-mono">Default battery (Hybrid / Off-grid)</span>
                <select
                  value={batteryPresetSelectValue(row, live as CatalogProductLike[])}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!value) {
                      patchSize(kw, { batteryOption: "", batteryProductId: "" });
                      return;
                    }
                    if (value === "None") {
                      patchSize(kw, { batteryOption: "None", batteryProductId: "" });
                      return;
                    }
                    if (value.startsWith("product:")) {
                      patchSize(kw, { batteryProductId: value.slice("product:".length), batteryOption: "" });
                      return;
                    }
                    patchSize(kw, { batteryOption: value, batteryProductId: "" });
                  }}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-2 py-1.5 text-xs text-neutral-100"
                >
                  <option value="">{`Typed default — ${typed.battery.option}`}</option>
                  <option value="None">None</option>
                  <option value="Lithium Battery Pack 5.12kWh">Lithium Battery Pack 5.12kWh</option>
                  <option value="Lithium Battery Pack 10.24kWh">Lithium Battery Pack 10.24kWh</option>
                  <option value="Lithium Battery Pack 15.0kWh">Lithium Battery Pack 15.0kWh</option>
                  {batteries.map((p) => (
                    <option key={String(p.id)} value={`product:${p.id}`}>
                      Catalog — {productLabel(p)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[9px] uppercase tracking-wider text-neutral-500 font-mono">Default DC cable</span>
                <select
                  value={row.dcCableProductId}
                  onChange={(e) => patchSize(kw, { dcCableProductId: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-2 py-1.5 text-xs text-neutral-100"
                >
                  <option value="">Typed default — 6mm</option>
                  {dcCables.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>
                      {productLabel(p)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[9px] uppercase tracking-wider text-neutral-500 font-mono">Default AC cable</span>
                <select
                  value={row.acCableProductId}
                  onChange={(e) => patchSize(kw, { acCableProductId: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-2 py-1.5 text-xs text-neutral-100"
                >
                  <option value="">Typed default — 4-Core</option>
                  {acCables.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>
                      {productLabel(p)}
                    </option>
                  ))}
                </select>
              </label>

              {hydrated.panelBrand || hydrated.inverterBrand ? (
                <p className="text-[10px] text-neutral-500 font-mono">
                  Active overlay: {hydrated.panelBrand || typed.panel.brand} {hydrated.panelWattage || typed.panel.wattage}W
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={!!syncing || saving}
        onClick={() => void handleSave()}
        className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-950 font-bold text-xs py-2.5 px-4 rounded-xl"
      >
        {syncing || saving ? "Saving…" : "Save AutoSizer presets"}
      </button>
    </div>
  );
}
