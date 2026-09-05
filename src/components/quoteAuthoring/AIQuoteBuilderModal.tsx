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
  batteryKwhLabelFromProduct,
  buildCommercialDraftApply,
  catalogIdAfterBatteryCapacityChange,
  catalogIdAfterBrandChange,
  catalogIdAfterInverterCapacityChange,
  catalogIdAfterWattageChange,
  catalogProductMatchesBatteryIdentity,
  catalogProductMatchesInverterIdentity,
  catalogProductMatchesPanelIdentity,
  defaultBatteryEnabled,
  inverterKwLabelFromProduct,
  isQuickPanelWattage,
  L2_STRUCTURE_KIT_RATE,
  L3_STRUCTURE_KIT_RATE,
  QUICK_PANEL_WATTAGES,
  resolveStandardStructureSelection,
  standardStructureSummaryLabel,
  STRUCTURE_CAPACITY_WARNING,
  validateCommercialQuoteConfig,
  wattageLabelFromProduct,
  type CommercialQuoteDraftApply,
  type QuoteStructureKind,
  type QuoteStructureMode,
  type QuoteSystemType,
} from "../../lib/aiQuoteCommercialDraft";
import { productsForBrand, productsForType } from "../../lib/websiteCatalog/sync";
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
const STRUCTURE_OPTIONS: { id: QuoteStructureKind; label: string }[] = [
  { id: "standard", label: "Standard L2/L3" },
  { id: "elevated", label: "Elevated" },
  { id: "girder", label: "Girder" },
  { id: "custom", label: "Custom" },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{children}</label>;
}

function chipClass(active: boolean, tone: "amber" | "emerald" = "amber"): string {
  if (active && tone === "emerald") return "bg-emerald-600 text-white";
  if (active) return "bg-amber-500 text-slate-950";
  return "border border-slate-800 text-slate-300 hover:border-amber-500/40";
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
  const [customWattage, setCustomWattage] = useState(false);
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
  const [structureMode, setStructureMode] = useState<QuoteStructureMode>("auto");
  const [manualL3Quantity, setManualL3Quantity] = useState(0);
  const [manualL2Quantity, setManualL2Quantity] = useState(0);
  const [l3RatePerSection, setL3RatePerSection] = useState(L3_STRUCTURE_KIT_RATE);
  const [l2RatePerSection, setL2RatePerSection] = useState(L2_STRUCTURE_KIT_RATE);
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
  const panelChoices = useMemo(
    () => (resolvedPanelBrand ? productsForBrand(panelProducts, resolvedPanelBrand) : panelProducts),
    [panelProducts, resolvedPanelBrand]
  );
  const inverterChoices = useMemo(
    () => (resolvedInverterBrand ? productsForBrand(inverterProducts, resolvedInverterBrand) : inverterProducts),
    [inverterProducts, resolvedInverterBrand]
  );
  const batteryChoices = useMemo(
    () => (resolvedBatteryBrand ? productsForBrand(batteryProducts, resolvedBatteryBrand) : batteryProducts),
    [batteryProducts, resolvedBatteryBrand]
  );

  const commercialConfig = useMemo(
    () => ({
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
      structureMode,
      manualL3Quantity,
      manualL2Quantity,
      l3RatePerSection,
      l2RatePerSection,
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
      structureMode,
      manualL3Quantity,
      manualL2Quantity,
      l3RatePerSection,
      l2RatePerSection,
      installationRatePerWatt,
      elevatedRatePerWatt,
      girderAmount,
      customStructureName,
      customStructureDescription,
      customStructureAmount,
    ]
  );
  const validationErrors = useMemo(() => validateCommercialQuoteConfig(commercialConfig), [commercialConfig]);
  const applyPayload = useMemo(() => buildCommercialDraftApply(commercialConfig), [commercialConfig]);

  const arrayWatts = calculateArrayWatts(panelWattage, panelQuantity);
  const impliedPkrW = calculateImpliedPkrPerWatt(panelWebsitePrice, panelWattage);
  const panelUnit = calculatePanelUnitPrice(panelWattage, panelRatePerWatt);
  const panelTotal = calculatePanelTotal(panelWattage, panelQuantity, panelRatePerWatt);
  const installTotal = calculateInstallationTotal(panelWattage, panelQuantity, installationRatePerWatt);
  const elevatedTotal = calculateElevatedStructureTotal(panelWattage, panelQuantity, elevatedRatePerWatt);
  const standardSelection = resolveStandardStructureSelection(commercialConfig);
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
  const structureUnderCapacity = structureType === "standard" && structureMode === "manual" && standardSelection.underCapacity;

  const applyPanelWattage = (next: number, asCustom = false) => {
    setCustomWattage(asCustom || !isQuickPanelWattage(next));
    setPanelWattage(next);
    const selected = panelChoices.find((p) => p.id === panelProductId);
    setPanelProductId(catalogIdAfterWattageChange(panelProductId, selected, next));
  };

  const selectPanel = (product: Product | null) => {
    if (!product) {
      setPanelProductId("");
      return;
    }
    setPanelProductId(product.id);
    if (product.brand) setPanelBrand(panelBrands.includes(product.brand) ? product.brand : OTHER_CUSTOM_BRAND);
    if (product.brand && !panelBrands.includes(product.brand)) setCustomPanelBrand(product.brand);
    setPanelModel(product.model || product.name);
    const watts = wattageLabelFromProduct(product);
    if (watts) {
      setPanelWattage(watts);
      setCustomWattage(!isQuickPanelWattage(watts));
    }
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
    const cap = inverterKwLabelFromProduct(product);
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
    const kwh = batteryKwhLabelFromProduct(product);
    if (kwh) setBatteryCapacityKwh(kwh);
    setBatteryWebsitePrice(Number(product.price) || 0);
    if (!batteryPriceDirty) setBatteryUnitPrice(Number(product.price) || 0);
  };

  const enterManualStructure = () => {
    const recommended = recommendStructures(panelQuantity);
    setManualL3Quantity(recommended.l3);
    setManualL2Quantity(recommended.l2);
    setStructureMode("manual");
  };

  const handleApply = () => {
    if (validationErrors.length) return;
    onApplyDraft(applyPayload);
    onClose();
  };

  const structureSummary =
    structureType === "standard"
      ? standardStructureSummaryLabel(standardSelection)
      : structureType === "elevated"
        ? `Rs ${elevatedRatePerWatt}/W · ${elevatedTotal.toLocaleString()}`
        : structureType === "girder"
          ? `Girder · ${girderAmount.toLocaleString()}`
          : `${customStructureName || "Custom"} · ${customStructureAmount.toLocaleString()}`;

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
                  <FieldLabel>Use website package system size</FieldLabel>
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
                    <option value="">Does not load equipment — size only</option>
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
                    className={`rounded-xl px-3 py-2 text-xs font-bold ${chipClass(!customSize && systemSizeKw === kw)}`}
                  >
                    {kw} kW
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomSize(true)}
                  className={`rounded-xl px-3 py-2 text-xs font-bold ${chipClass(customSize)}`}
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
                    className={`rounded-xl px-3 py-2 text-xs font-bold ${chipClass(systemType === type, "emerald")}`}
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
                  <FieldLabel>Brand</FieldLabel>
                  <select
                    value={panelBrand}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === OTHER_CUSTOM_BRAND) setPanelProductId("");
                      else setPanelProductId(catalogIdAfterBrandChange(panelProductId, resolvedPanelBrand, next));
                      setPanelBrand(next);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    {panelBrands.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                  {panelBrand === OTHER_CUSTOM_BRAND && (
                    <input
                      value={customPanelBrand}
                      onChange={(e) => {
                        setPanelProductId(catalogIdAfterBrandChange(panelProductId, resolvedPanelBrand, e.target.value));
                        setCustomPanelBrand(e.target.value);
                      }}
                      placeholder="Custom brand"
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  )}
                </div>
                <div>
                  <FieldLabel>Product / Model</FieldLabel>
                  <CatalogProductPicker products={panelChoices} valueId={panelProductId} onSelect={selectPanel} />
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>Panel model</FieldLabel>
                  <input
                    value={panelModel}
                    onChange={(e) => {
                      const next = e.target.value;
                      setPanelModel(next);
                      const selected = panelChoices.find((p) => p.id === panelProductId);
                      if (
                        panelProductId &&
                        !catalogProductMatchesPanelIdentity(selected, resolvedPanelBrand, next, panelWattage)
                      ) {
                        setPanelProductId("");
                      }
                    }}
                    placeholder="Custom model is allowed"
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>Wattage</FieldLabel>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {QUICK_PANEL_WATTAGES.map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => applyPanelWattage(w)}
                        className={`rounded-xl px-3 py-2 text-xs font-bold ${chipClass(!customWattage && panelWattage === w)}`}
                      >
                        {w}W
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCustomWattage(true)}
                      className={`rounded-xl px-3 py-2 text-xs font-bold ${chipClass(customWattage || !isQuickPanelWattage(panelWattage))}`}
                    >
                      Custom
                    </button>
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={panelWattage}
                    onChange={(e) => applyPanelWattage(Number(e.target.value), true)}
                    className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">Any positive wattage is allowed. Chips are shortcuts only.</p>
                </div>
                <div>
                  <FieldLabel>Quantity</FieldLabel>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="number"
                      min={1}
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
                    min={0}
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
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === OTHER_CUSTOM_BRAND) setInverterProductId("");
                      else setInverterProductId(catalogIdAfterBrandChange(inverterProductId, resolvedInverterBrand, next));
                      setInverterBrand(next);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    {inverterBrands.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                  {inverterBrand === OTHER_CUSTOM_BRAND && (
                    <input
                      value={customInverterBrand}
                      onChange={(e) => {
                        setInverterProductId(catalogIdAfterBrandChange(inverterProductId, resolvedInverterBrand, e.target.value));
                        setCustomInverterBrand(e.target.value);
                      }}
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  )}
                </div>
                <div>
                  <FieldLabel>Product / Model</FieldLabel>
                  <CatalogProductPicker products={inverterChoices} valueId={inverterProductId} onSelect={selectInverter} />
                </div>
                <div>
                  <FieldLabel>Model</FieldLabel>
                  <input
                    value={inverterModel}
                    onChange={(e) => {
                      const next = e.target.value;
                      setInverterModel(next);
                      const selected = inverterChoices.find((p) => p.id === inverterProductId);
                      if (
                        inverterProductId &&
                        !catalogProductMatchesInverterIdentity(selected, resolvedInverterBrand, next, inverterCapacity)
                      ) {
                        setInverterProductId("");
                      }
                    }}
                    placeholder="Custom model is allowed"
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <FieldLabel>Capacity</FieldLabel>
                  <input
                    value={inverterCapacity}
                    onChange={(e) => {
                      const next = e.target.value;
                      setInverterCapacity(next);
                      const selected = inverterChoices.find((p) => p.id === inverterProductId);
                      setInverterProductId(catalogIdAfterInverterCapacityChange(inverterProductId, selected, next));
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <FieldLabel>Quantity</FieldLabel>
                  <input
                    type="number"
                    min={1}
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
                    min={0}
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
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Lithium battery</h3>
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
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === OTHER_CUSTOM_BRAND) setBatteryProductId("");
                        else setBatteryProductId(catalogIdAfterBrandChange(batteryProductId, resolvedBatteryBrand, next));
                        setBatteryBrand(next);
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    >
                      {batteryBrands.map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </select>
                    {batteryBrand === OTHER_CUSTOM_BRAND && (
                      <input
                        value={customBatteryBrand}
                        onChange={(e) => {
                          setBatteryProductId(catalogIdAfterBrandChange(batteryProductId, resolvedBatteryBrand, e.target.value));
                          setCustomBatteryBrand(e.target.value);
                        }}
                        className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                    )}
                  </div>
                  <div>
                    <FieldLabel>Product / Model</FieldLabel>
                    <CatalogProductPicker products={batteryChoices} valueId={batteryProductId} onSelect={selectBattery} />
                  </div>
                  <div>
                    <FieldLabel>Model</FieldLabel>
                    <input
                      value={batteryModel}
                      onChange={(e) => {
                        const next = e.target.value;
                        setBatteryModel(next);
                        const selected = batteryChoices.find((p) => p.id === batteryProductId);
                        if (
                          batteryProductId &&
                          !catalogProductMatchesBatteryIdentity(selected, resolvedBatteryBrand, next, batteryCapacityKwh)
                        ) {
                          setBatteryProductId("");
                        }
                      }}
                      placeholder="Custom model is allowed"
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <FieldLabel>Capacity kWh</FieldLabel>
                    <input
                      value={batteryCapacityKwh}
                      onChange={(e) => {
                        const next = e.target.value;
                        setBatteryCapacityKwh(next);
                        const selected = batteryChoices.find((p) => p.id === batteryProductId);
                        setBatteryProductId(catalogIdAfterBatteryCapacityChange(batteryProductId, selected, next));
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <FieldLabel>Quantity</FieldLabel>
                    <input
                      type="number"
                      min={1}
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
                      min={0}
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
                {STRUCTURE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setStructureType(option.id)}
                    className={`rounded-xl px-3 py-2 text-xs font-bold ${chipClass(structureType === option.id)}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {structureType === "standard" && (
                <div className="space-y-3">
                  <div>
                    <FieldLabel>Mode</FieldLabel>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setStructureMode("auto")}
                        className={`rounded-xl px-3 py-2 text-xs font-bold ${chipClass(structureMode === "auto")}`}
                      >
                        Auto Calculate
                      </button>
                      <button
                        type="button"
                        onClick={enterManualStructure}
                        className={`rounded-xl px-3 py-2 text-xs font-bold ${chipClass(structureMode === "manual")}`}
                      >
                        Manual
                      </button>
                    </div>
                  </div>
                  {structureMode === "auto" ? (
                    <p className="text-xs text-slate-400">
                      {panelQuantity} panels → {standardSelection.l3} × L3 + {standardSelection.l2} × L2
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <FieldLabel>L3 Quantity</FieldLabel>
                        <input
                          type="number"
                          min={0}
                          value={manualL3Quantity}
                          onChange={(e) => setManualL3Quantity(Number(e.target.value))}
                          className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                        />
                      </div>
                      <div>
                        <FieldLabel>L2 Quantity</FieldLabel>
                        <input
                          type="number"
                          min={0}
                          value={manualL2Quantity}
                          onChange={(e) => setManualL2Quantity(Number(e.target.value))}
                          className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                        />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>L3 rate / section</FieldLabel>
                      <input
                        type="number"
                        min={0}
                        value={l3RatePerSection}
                        onChange={(e) => setL3RatePerSection(Number(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                    </div>
                    <div>
                      <FieldLabel>L2 rate / section</FieldLabel>
                      <input
                        type="number"
                        min={0}
                        value={l2RatePerSection}
                        onChange={(e) => setL2RatePerSection(Number(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-300">
                    Panel quantity: {panelQuantity} · Structure capacity: {standardSelection.capacity} panels
                  </p>
                  <p className="text-xs text-slate-400">Structure subtotal: Rs. {structureTotal.toLocaleString()}</p>
                  {structureUnderCapacity && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      {STRUCTURE_CAPACITY_WARNING}
                    </div>
                  )}
                </div>
              )}
              {structureType === "elevated" && (
                <div>
                  <FieldLabel>Elevated PKR/W (default 16)</FieldLabel>
                  <input
                    type="number"
                    min={0}
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
                    min={0}
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
                    min={0}
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
                    min={0}
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
              <div className="flex justify-between gap-3">
                <dt>System</dt>
                <dd className="text-right text-white font-semibold">{systemSizeKw}kW {systemType}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Array</dt>
                <dd className="text-right text-white">
                  {panelQuantity} × {panelWattage}W
                  <div className="text-[10px] font-normal text-slate-400">{arrayKilowattsPeak(panelWattage, panelQuantity).toFixed(3)} kWp actual array</div>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Panel</dt>
                <dd className="text-right">
                  {panelWattage}W · Rs. {panelRatePerWatt}/W
                  <div className="text-white">{panelTotal.toLocaleString()}</div>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Inverter</dt>
                <dd className="text-right">
                  {[resolvedInverterBrand, inverterModel, inverterCapacity].filter(Boolean).join(" ")} × {inverterQuantity}
                  <div className="text-white">{inverterTotal.toLocaleString()}</div>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Battery</dt>
                <dd className="text-right">
                  {batteryEnabled && systemType !== "On-grid"
                    ? `${[resolvedBatteryBrand, batteryModel, batteryCapacityKwh].filter(Boolean).join(" ")} × ${batteryQuantity}`
                    : "None"}
                  <div className="text-white">{batteryEnabled && systemType !== "On-grid" ? batteryTotal.toLocaleString() : "—"}</div>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Structure</dt>
                <dd className="text-right text-white">{structureSummary}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Installation</dt>
                <dd className="text-right">
                  Rs. {installationRatePerWatt}/W
                  <div className="text-white">{installTotal.toLocaleString()}</div>
                </dd>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-2 text-sm text-white font-bold">
                <dt>Estimated subtotal</dt>
                <dd>Rs. {subtotal.toLocaleString()}</dd>
              </div>
            </dl>
            {systemType === "On-grid" && batteryEnabled && (
              <div className="flex items-center gap-2 text-[11px] text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5" />
                On-grid draft will not add a battery row.
              </div>
            )}
            {structureUnderCapacity && (
              <div className="flex items-start gap-2 text-[11px] text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {STRUCTURE_CAPACITY_WARNING}
              </div>
            )}
            {validationErrors.length > 0 && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300 mb-1">Fix before apply</p>
                <ul className="text-[11px] text-rose-100/90 space-y-1 list-disc pl-4">
                  {validationErrors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
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
              disabled={validationErrors.length > 0}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
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
