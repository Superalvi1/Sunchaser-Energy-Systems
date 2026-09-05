import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, Sparkles } from "lucide-react";
import AppModal from "../ui/AppModal";
import CatalogProductPicker from "./CatalogProductPicker";
import type { Product } from "../../types";
import { mergeEquipmentBrands, OTHER_CUSTOM_BRAND } from "../../lib/solarEquipmentBrands";
import {
  arrayKilowattsPeak,
  calculateArrayWatts,
  calculateElevatedStructureTotal,
  calculateImpliedPkrPerWatt,
  calculateInstallationTotal,
  calculatePanelTotal,
  calculatePanelUnitPrice,
  DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT,
  DEFAULT_GIRDER_STRUCTURE_AMOUNT,
  DEFAULT_INSTALLATION_RATE_PER_WATT,
  recommendedPanelQuantity,
} from "../../lib/quoteCommercialMath";
import {
  buildCommercialDraftApply,
  defaultBatteryEnabled,
  type CommercialQuoteDraftApply,
  type QuoteStructureKind,
  type QuoteSystemType,
} from "../../lib/aiQuoteCommercialDraft";
import { productsForType } from "../../lib/websiteCatalog/sync";
import { liftWebsiteSourceFields } from "../../lib/websiteCatalog/normalize";
import { recommendStructures } from "../../lib/autoSizer/structureRecommendation";

export interface AIQuoteBuilderModalProps {
  open: boolean;
  onClose: () => void;
  /** Applies draft into BOQ builder state only — does not save to CRM. */
  onApplyDraft: (draft: CommercialQuoteDraftApply) => void;
  products?: Product[];
}

const SYSTEM_SIZES = [6, 8, 10, 12, 15, 20];
const SYSTEM_TYPE_OPTIONS: QuoteSystemType[] = ["On-grid", "Hybrid", "Off-grid"];

function specNumber(product: Product | null, keys: string[]): number {
  if (!product) return 0;
  const specs = product.specifications || {};
  for (const key of keys) {
    const n = Number((specs as Record<string, string>)[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function wattageFromProduct(product: Product | null): number {
  const fromSpec = specNumber(product, ["panelWattage", "wattage"]);
  if (fromSpec) return fromSpec;
  const match = `${product?.name || ""} ${product?.model || ""}`.match(/(\d+(?:\.\d+)?)\s*w\b/i);
  return match ? Number(match[1]) : 0;
}

function inverterKwFromProduct(product: Product | null): string {
  const fromSpec = specNumber(product, ["inverterKw"]);
  if (fromSpec) return `${fromSpec}kW`;
  const match = `${product?.name || ""} ${product?.model || ""}`.match(/(\d+(?:\.\d+)?)\s*kw\b/i);
  return match ? `${match[1]}kW` : "";
}

function batteryKwhFromProduct(product: Product | null): string {
  const fromSpec = specNumber(product, ["batteryKwh"]);
  if (fromSpec) return `${fromSpec}kWh`;
  const match = `${product?.name || ""} ${product?.model || ""}`.match(/(\d+(?:\.\d+)?)\s*kwh\b/i);
  return match ? `${match[1]}kWh` : "";
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{children}</label>;
}

export default function AIQuoteBuilderModal({
  open,
  onClose,
  onApplyDraft,
  products = [],
}: AIQuoteBuilderModalProps) {
  const catalog = useMemo(() => products.map((p) => liftWebsiteSourceFields(p)), [products]);
  const panelProducts = useMemo(() => productsForType(catalog, "panel"), [catalog]);
  const inverterProducts = useMemo(() => productsForType(catalog, "inverter"), [catalog]);
  const batteryProducts = useMemo(() => productsForType(catalog, "battery"), [catalog]);
  const packageProducts = useMemo(() => productsForType(catalog, "package"), [catalog]);

  const panelBrands = useMemo(
    () => mergeEquipmentBrands("panel", panelProducts.map((p) => p.brand)),
    [panelProducts]
  );
  const inverterBrands = useMemo(
    () => mergeEquipmentBrands("inverter", inverterProducts.map((p) => p.brand)),
    [inverterProducts]
  );
  const batteryBrands = useMemo(
    () => mergeEquipmentBrands("battery", batteryProducts.map((p) => p.brand)),
    [batteryProducts]
  );

  const [systemSizeKw, setSystemSizeKw] = useState(10);
  const [customSize, setCustomSize] = useState(false);
  const [systemType, setSystemType] = useState<QuoteSystemType>("On-grid");
  const [packageId, setPackageId] = useState("");

  const [panelBrand, setPanelBrand] = useState(panelBrands[0] || "LONGi");
  const [customPanelBrand, setCustomPanelBrand] = useState("");
  const [panelProductId, setPanelProductId] = useState("");
  const [panelModel, setPanelModel] = useState("");
  const [panelWattage, setPanelWattage] = useState(580);
  const [panelQuantity, setPanelQuantity] = useState(recommendedPanelQuantity(10, 580));
  const [qtyDirty, setQtyDirty] = useState(false);
  const [panelRatePerWatt, setPanelRatePerWatt] = useState(0);
  const [panelRateDirty, setPanelRateDirty] = useState(false);
  const [panelWebsitePrice, setPanelWebsitePrice] = useState(0);

  const [inverterBrand, setInverterBrand] = useState(inverterBrands[0] || "Knox");
  const [customInverterBrand, setCustomInverterBrand] = useState("");
  const [inverterProductId, setInverterProductId] = useState("");
  const [inverterModel, setInverterModel] = useState("");
  const [inverterCapacity, setInverterCapacity] = useState("10kW");
  const [inverterQuantity, setInverterQuantity] = useState(1);
  const [inverterUnitPrice, setInverterUnitPrice] = useState(0);
  const [inverterPriceDirty, setInverterPriceDirty] = useState(false);
  const [inverterWebsitePrice, setInverterWebsitePrice] = useState(0);

  const [batteryEnabled, setBatteryEnabled] = useState(false);
  const [batteryBrand, setBatteryBrand] = useState(batteryBrands[0] || "Soluna");
  const [customBatteryBrand, setCustomBatteryBrand] = useState("");
  const [batteryProductId, setBatteryProductId] = useState("");
  const [batteryModel, setBatteryModel] = useState("");
  const [batteryCapacityKwh, setBatteryCapacityKwh] = useState("");
  const [batteryQuantity, setBatteryQuantity] = useState(1);
  const [batteryUnitPrice, setBatteryUnitPrice] = useState(0);
  const [batteryPriceDirty, setBatteryPriceDirty] = useState(false);
  const [batteryWebsitePrice, setBatteryWebsitePrice] = useState(0);

  const [structureType, setStructureType] = useState<QuoteStructureKind>("standard");
  const [installationRatePerWatt, setInstallationRatePerWatt] = useState(DEFAULT_INSTALLATION_RATE_PER_WATT);
  const [elevatedRatePerWatt, setElevatedRatePerWatt] = useState(DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT);
  const [girderAmount, setGirderAmount] = useState(DEFAULT_GIRDER_STRUCTURE_AMOUNT);
  const [customStructureName, setCustomStructureName] = useState("Custom Mounting Structure");
  const [customStructureDescription, setCustomStructureDescription] = useState("");
  const [customStructureAmount, setCustomStructureAmount] = useState(0);

  useEffect(() => {
    if (!qtyDirty) setPanelQuantity(recommendedPanelQuantity(systemSizeKw, panelWattage));
  }, [systemSizeKw, panelWattage, qtyDirty]);

  useEffect(() => {
    setBatteryEnabled(defaultBatteryEnabled(systemType));
  }, [systemType]);

  const resolvedPanelBrand = panelBrand === OTHER_CUSTOM_BRAND ? customPanelBrand : panelBrand;
  const resolvedInverterBrand = inverterBrand === OTHER_CUSTOM_BRAND ? customInverterBrand : inverterBrand;
  const resolvedBatteryBrand = batteryBrand === OTHER_CUSTOM_BRAND ? customBatteryBrand : batteryBrand;

  const applyPayload = useMemo(
    () =>
      buildCommercialDraftApply({
        systemSizeKw,
        systemType,
        panelBrand: resolvedPanelBrand,
        panelModel,
        panelWattage,
        panelQuantity,
        panelRatePerWatt,
        panelCatalogProductId: panelProductId,
        panelWebsitePrice,
        inverterBrand: resolvedInverterBrand,
        inverterModel,
        inverterCapacity,
        inverterQuantity,
        inverterUnitPrice,
        inverterCatalogProductId: inverterProductId,
        inverterWebsitePrice,
        batteryEnabled,
        batteryBrand: resolvedBatteryBrand,
        batteryModel,
        batteryCapacityKwh,
        batteryQuantity,
        batteryUnitPrice,
        batteryCatalogProductId: batteryProductId,
        batteryWebsitePrice,
        structureType,
        installationRatePerWatt,
        elevatedStructureRatePerWatt: elevatedRatePerWatt,
        girderAmount,
        customStructureName,
        customStructureDescription,
        customStructureAmount,
      }),
    [
      systemSizeKw,
      systemType,
      resolvedPanelBrand,
      panelModel,
      panelWattage,
      panelQuantity,
      panelRatePerWatt,
      panelProductId,
      panelWebsitePrice,
      resolvedInverterBrand,
      inverterModel,
      inverterCapacity,
      inverterQuantity,
      inverterUnitPrice,
      inverterProductId,
      inverterWebsitePrice,
      batteryEnabled,
      resolvedBatteryBrand,
      batteryModel,
      batteryCapacityKwh,
      batteryQuantity,
      batteryUnitPrice,
      batteryProductId,
      batteryWebsitePrice,
      structureType,
      installationRatePerWatt,
      elevatedRatePerWatt,
      girderAmount,
      customStructureName,
      customStructureDescription,
      customStructureAmount,
    ]
  );

  const arrayWatts = calculateArrayWatts(panelWattage, panelQuantity);
  const structure = recommendStructures(panelQuantity);
  const impliedPkrW = calculateImpliedPkrPerWatt(panelWebsitePrice, panelWattage);
  const panelUnit = calculatePanelUnitPrice(panelWattage, panelRatePerWatt);
  const panelTotal = calculatePanelTotal(panelWattage, panelQuantity, panelRatePerWatt);
  const installTotal = calculateInstallationTotal(panelWattage, panelQuantity, installationRatePerWatt);
  const elevatedTotal = calculateElevatedStructureTotal(panelWattage, panelQuantity, elevatedRatePerWatt);
  const structureTotal =
    structureType === "elevated"
      ? elevatedTotal
      : structureType === "girder"
        ? girderAmount
        : structureType === "custom"
          ? customStructureAmount
          : applyPayload.boqRows
              .filter((r) => r.id === "structure_l3_row" || r.id === "structure_l2_row")
              .reduce((s, r) => s + (Number(r.total) || 0), 0);
  const inverterTotal = inverterQuantity * inverterUnitPrice;
  const batteryTotal = batteryEnabled && systemType !== "On-grid" ? batteryQuantity * batteryUnitPrice : 0;
  const subtotal = panelTotal + inverterTotal + batteryTotal + installTotal + structureTotal;

  const selectPanel = (product: Product | null) => {
    if (!product) {
      setPanelProductId("");
      return;
    }
    setPanelProductId(product.id);
    if (product.brand) setPanelBrand(panelBrands.includes(product.brand) ? product.brand : OTHER_CUSTOM_BRAND);
    if (product.brand && !panelBrands.includes(product.brand)) setCustomPanelBrand(product.brand);
    setPanelModel(product.model || product.name);
    const watts = wattageFromProduct(product);
    if (watts) setPanelWattage(watts);
    setPanelWebsitePrice(Number(product.price) || 0);
    if (!panelRateDirty && watts) setPanelRatePerWatt(Number(calculateImpliedPkrPerWatt(Number(product.price) || 0, watts).toFixed(4)));
  };

  const selectInverter = (product: Product | null) => {
    if (!product) {
      setInverterProductId("");
      return;
    }
    setInverterProductId(product.id);
    if (product.brand) setInverterBrand(inverterBrands.includes(product.brand) ? product.brand : OTHER_CUSTOM_BRAND);
    if (product.brand && !inverterBrands.includes(product.brand)) setCustomInverterBrand(product.brand);
    setInverterModel(product.model || product.name);
    const cap = inverterKwFromProduct(product);
    if (cap) setInverterCapacity(cap);
    setInverterWebsitePrice(Number(product.price) || 0);
    if (!inverterPriceDirty) setInverterUnitPrice(Number(product.price) || 0);
  };

  const selectBattery = (product: Product | null) => {
    if (!product) {
      setBatteryProductId("");
      return;
    }
    setBatteryProductId(product.id);
    setBatteryEnabled(true);
    if (product.brand) setBatteryBrand(batteryBrands.includes(product.brand) ? product.brand : OTHER_CUSTOM_BRAND);
    if (product.brand && !batteryBrands.includes(product.brand)) setCustomBatteryBrand(product.brand);
    setBatteryModel(product.model || product.name);
    const kwh = batteryKwhFromProduct(product);
    if (kwh) setBatteryCapacityKwh(kwh);
    setBatteryWebsitePrice(Number(product.price) || 0);
    if (!batteryPriceDirty) setBatteryUnitPrice(Number(product.price) || 0);
  };

  const handleApply = () => {
    onApplyDraft(applyPayload);
    onClose();
  };

  return (
    <AppModal open={open} onClose={onClose} panelClassName="max-w-6xl">
      <div className="bg-slate-950 border border-slate-850 rounded-3xl p-5 md:p-6 text-left max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Draft only</p>
              <h2 className="text-lg font-bold text-white">AI Quote Builder</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Deterministic configurator — no auto-save, no CRM mutation, no messaging.
              </p>
            </div>
          </div>
          <Bot className="h-5 w-5 text-slate-600 shrink-0" />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">System</h3>
              {packageProducts.length > 0 && (
                <div>
                  <FieldLabel>Start from website package (optional, editable)</FieldLabel>
                  <select
                    value={packageId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPackageId(id);
                      const pkg = packageProducts.find((p) => p.id === id);
                      if (!pkg) return;
                      const kw = `${pkg.name} ${pkg.model}`.match(/(\d+(?:\.\d+)?)\s*kw/i);
                      if (kw) {
                        setSystemSizeKw(Number(kw[1]));
                        setCustomSize(!SYSTEM_SIZES.includes(Number(kw[1])));
                      }
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    <option value="">Equipment remains editable</option>
                    {packageProducts.slice(0, 40).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {SYSTEM_SIZES.map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => {
                      setCustomSize(false);
                      setSystemSizeKw(kw);
                    }}
                    className={`rounded-xl px-3 py-2 text-xs font-bold ${
                      !customSize && systemSizeKw === kw
                        ? "bg-amber-500 text-slate-950"
                        : "border border-slate-800 text-slate-300 hover:border-amber-500/40"
                    }`}
                  >
                    {kw} kW
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomSize(true)}
                  className={`rounded-xl px-3 py-2 text-xs font-bold ${
                    customSize ? "bg-amber-500 text-slate-950" : "border border-slate-800 text-slate-300"
                  }`}
                >
                  Custom
                </button>
              </div>
              {customSize && (
                <input
                  type="number"
                  min={1}
                  step={0.1}
                  value={systemSizeKw}
                  onChange={(e) => setSystemSizeKw(Number(e.target.value))}
                  className="w-40 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              )}
              <div className="flex flex-wrap gap-2">
                {SYSTEM_TYPE_OPTIONS.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSystemType(type)}
                    className={`rounded-xl px-3 py-2 text-xs font-bold ${
                      systemType === type ? "bg-emerald-600 text-white" : "border border-slate-800 text-slate-300"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Panels</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Panel brand</FieldLabel>
                  <select
                    value={panelBrand}
                    onChange={(e) => setPanelBrand(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    {panelBrands.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                  {panelBrand === OTHER_CUSTOM_BRAND && (
                    <input
                      value={customPanelBrand}
                      onChange={(e) => setCustomPanelBrand(e.target.value)}
                      placeholder="Custom brand"
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  )}
                </div>
                <div>
                  <FieldLabel>Panel product / model</FieldLabel>
                  <CatalogProductPicker products={panelProducts} valueId={panelProductId} onSelect={selectPanel} />
                </div>
                <div>
                  <FieldLabel>Wattage</FieldLabel>
                  <input
                    type="number"
                    value={panelWattage}
                    onChange={(e) => setPanelWattage(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <FieldLabel>Quantity</FieldLabel>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="number"
                      value={panelQuantity}
                      onChange={(e) => {
                        setQtyDirty(true);
                        setPanelQuantity(Number(e.target.value));
                      }}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setQtyDirty(false);
                        setPanelQuantity(recommendedPanelQuantity(systemSizeKw, panelWattage));
                      }}
                      className="shrink-0 rounded-xl border border-slate-700 px-2 text-[10px] font-bold text-slate-300"
                    >
                      Recalculate Panels
                    </button>
                  </div>
                </div>
                <div>
                  <FieldLabel>Website price / implied PKR/W</FieldLabel>
                  <p className="mt-1 text-xs text-slate-400">
                    Website Price Rs. {Number(panelWebsitePrice || 0).toLocaleString()} · implied {impliedPkrW ? impliedPkrW.toFixed(2) : "—"} /W
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (impliedPkrW) {
                        setPanelRatePerWatt(Number(impliedPkrW.toFixed(4)));
                        setPanelRateDirty(false);
                      }
                    }}
                    className="mt-1 text-[10px] font-bold uppercase tracking-wider text-amber-400"
                  >
                    Use Website Rate
                  </button>
                </div>
                <div>
                  <FieldLabel>Quote PKR/W</FieldLabel>
                  <input
                    type="number"
                    step="0.01"
                    value={panelRatePerWatt}
                    onChange={(e) => {
                      setPanelRateDirty(true);
                      setPanelRatePerWatt(Number(e.target.value));
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Inverter</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Brand</FieldLabel>
                  <select
                    value={inverterBrand}
                    onChange={(e) => setInverterBrand(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    {inverterBrands.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                  {inverterBrand === OTHER_CUSTOM_BRAND && (
                    <input
                      value={customInverterBrand}
                      onChange={(e) => setCustomInverterBrand(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  )}
                </div>
                <div>
                  <FieldLabel>Product / model</FieldLabel>
                  <CatalogProductPicker products={inverterProducts} valueId={inverterProductId} onSelect={selectInverter} />
                </div>
                <div>
                  <FieldLabel>Capacity</FieldLabel>
                  <input
                    value={inverterCapacity}
                    onChange={(e) => setInverterCapacity(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <FieldLabel>Quantity</FieldLabel>
                  <input
                    type="number"
                    value={inverterQuantity}
                    onChange={(e) => setInverterQuantity(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <FieldLabel>Website Price</FieldLabel>
                  <p className="mt-1 text-xs text-slate-400">Rs. {Number(inverterWebsitePrice || 0).toLocaleString()}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setInverterUnitPrice(inverterWebsitePrice);
                      setInverterPriceDirty(false);
                    }}
                    className="mt-1 text-[10px] font-bold uppercase tracking-wider text-amber-400"
                  >
                    Use Website Price
                  </button>
                </div>
                <div>
                  <FieldLabel>Quote unit price</FieldLabel>
                  <input
                    type="number"
                    value={inverterUnitPrice}
                    onChange={(e) => {
                      setInverterPriceDirty(true);
                      setInverterUnitPrice(Number(e.target.value));
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Battery</h3>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={batteryEnabled && systemType !== "On-grid"}
                  disabled={systemType === "On-grid"}
                  onChange={(e) => setBatteryEnabled(e.target.checked)}
                />
                {systemType === "On-grid" ? "On-grid defaults to None" : "Battery enabled"}
              </label>
              {batteryEnabled && systemType !== "On-grid" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Brand</FieldLabel>
                    <select
                      value={batteryBrand}
                      onChange={(e) => setBatteryBrand(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    >
                      {batteryBrands.map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </select>
                    {batteryBrand === OTHER_CUSTOM_BRAND && (
                      <input
                        value={customBatteryBrand}
                        onChange={(e) => setCustomBatteryBrand(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                    )}
                  </div>
                  <div>
                    <FieldLabel>Product / model</FieldLabel>
                    <CatalogProductPicker products={batteryProducts} valueId={batteryProductId} onSelect={selectBattery} />
                  </div>
                  <div>
                    <FieldLabel>Capacity kWh</FieldLabel>
                    <input
                      value={batteryCapacityKwh}
                      onChange={(e) => setBatteryCapacityKwh(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <FieldLabel>Quantity</FieldLabel>
                    <input
                      type="number"
                      value={batteryQuantity}
                      onChange={(e) => setBatteryQuantity(Number(e.target.value))}
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <FieldLabel>Website Price</FieldLabel>
                    <p className="mt-1 text-xs text-slate-400">Rs. {Number(batteryWebsitePrice || 0).toLocaleString()}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setBatteryUnitPrice(batteryWebsitePrice);
                        setBatteryPriceDirty(false);
                      }}
                      className="mt-1 text-[10px] font-bold uppercase tracking-wider text-amber-400"
                    >
                      Use Website Price
                    </button>
                  </div>
                  <div>
                    <FieldLabel>Quote unit price</FieldLabel>
                    <input
                      type="number"
                      value={batteryUnitPrice}
                      onChange={(e) => {
                        setBatteryPriceDirty(true);
                        setBatteryUnitPrice(Number(e.target.value));
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Structure</h3>
              <div className="flex flex-wrap gap-2">
                {(["standard", "elevated", "girder", "custom"] as QuoteStructureKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setStructureType(kind)}
                    className={`rounded-xl px-3 py-2 text-xs font-bold capitalize ${
                      structureType === kind ? "bg-amber-500 text-slate-950" : "border border-slate-800 text-slate-300"
                    }`}
                  >
                    {kind}
                  </button>
                ))}
              </div>
              {structureType === "standard" && (
                <p className="text-xs text-slate-400">
                  Standard uses L2/L3 kits. {panelQuantity} panels → {structure.l3} × L3 + {structure.l2} × L2.
                </p>
              )}
              {structureType === "elevated" && (
                <div>
                  <FieldLabel>Elevated PKR/W (default 16)</FieldLabel>
                  <input
                    type="number"
                    value={elevatedRatePerWatt}
                    onChange={(e) => setElevatedRatePerWatt(Number(e.target.value))}
                    className="mt-1 w-40 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
              )}
              {structureType === "girder" && (
                <div>
                  <FieldLabel>Girder amount (existing commercial job rate)</FieldLabel>
                  <input
                    type="number"
                    value={girderAmount}
                    onChange={(e) => setGirderAmount(Number(e.target.value))}
                    className="mt-1 w-40 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
              )}
              {structureType === "custom" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    value={customStructureName}
                    onChange={(e) => setCustomStructureName(e.target.value)}
                    placeholder="Custom structure name"
                    className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                  <input
                    type="number"
                    value={customStructureAmount}
                    onChange={(e) => setCustomStructureAmount(Number(e.target.value))}
                    placeholder="Amount"
                    className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                  <textarea
                    value={customStructureDescription}
                    onChange={(e) => setCustomStructureDescription(e.target.value)}
                    placeholder="Description"
                    className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Commercial rates</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Installation PKR/W (default 4)</FieldLabel>
                  <input
                    type="number"
                    value={installationRatePerWatt}
                    onChange={(e) => setInstallationRatePerWatt(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div className="text-xs text-slate-400 pt-5">
                  Per-watt charges use actual array watts ({arrayWatts.toLocaleString()} W), not nominal kW.
                </div>
              </div>
            </section>
          </div>

          <aside className="rounded-2xl border border-amber-500/20 bg-slate-900/70 p-4 space-y-3 h-fit xl:sticky xl:top-0">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Live summary</h3>
            <dl className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between"><dt>System</dt><dd className="text-white font-semibold">{systemSizeKw} kW {systemType}</dd></div>
              <div className="flex justify-between"><dt>Structure</dt><dd className="text-white font-semibold capitalize">{structureType}</dd></div>
              <div className="flex justify-between gap-3"><dt>Array</dt><dd className="text-right text-white">{panelQuantity} × {panelWattage}W = {arrayKilowattsPeak(panelWattage, panelQuantity).toFixed(3)} kWp</dd></div>
              <div className="flex justify-between gap-3"><dt>Panel</dt><dd className="text-right">Rs. {panelRatePerWatt}/W · {panelUnit.toLocaleString()} /pc · {panelTotal.toLocaleString()}</dd></div>
              <div className="flex justify-between gap-3"><dt>Inverter</dt><dd className="text-right">{inverterModel || inverterCapacity} × {inverterQuantity} · {inverterTotal.toLocaleString()}</dd></div>
              <div className="flex justify-between gap-3"><dt>Battery</dt><dd className="text-right">{batteryEnabled && systemType !== "On-grid" ? `${batteryModel || "Battery"} × ${batteryQuantity} · ${batteryTotal.toLocaleString()}` : "None"}</dd></div>
              <div className="flex justify-between"><dt>Installation</dt><dd>Rs. {installationRatePerWatt}/W · {installTotal.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt>Structure total</dt><dd>{structureTotal.toLocaleString()}</dd></div>
              <div className="flex justify-between border-t border-slate-800 pt-2 text-sm text-white font-bold"><dt>Estimated subtotal</dt><dd>Rs. {subtotal.toLocaleString()}</dd></div>
            </dl>
            {systemType === "On-grid" && batteryEnabled && (
              <div className="flex items-center gap-2 text-[11px] text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5" />
                On-grid draft will not add a battery row.
              </div>
            )}
          </aside>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
          <p className="text-[10px] text-slate-500">
            Draft only · apply fills BOQ builder · you must save manually
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-900"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
            >
              Apply draft to BOQ
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </AppModal>
  );
}
