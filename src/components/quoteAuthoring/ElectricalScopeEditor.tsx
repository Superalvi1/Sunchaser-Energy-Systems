import React from "react";
import type { Product } from "../../types";
import type { ProjectScopeState, ScopeContext, ScopeLine } from "../../lib/quoteProjectScope";
import { PENDING_EARTH_TEST } from "../../lib/quoteProjectScope";
import { productsForType } from "../../lib/websiteCatalog/sync";
import CatalogProductPicker from "./CatalogProductPicker";
import { ScopeDetails, ScopeLineTable, TextField, ToggleRow } from "./ScopeLineTable";
import { patchLine, ScopeFieldLabel } from "./quoteScopeUi";

export default function ElectricalScopeEditor({
  scope,
  ctx,
  products,
  onChange,
  onChangeLine,
}: {
  scope: ProjectScopeState;
  ctx: ScopeContext;
  products: Product[];
  onChange: (patch: Partial<ProjectScopeState>) => void;
  onChangeLine: (id: string, next: ScopeLine) => void;
}) {
  const bySection = (section: ScopeLine["section"]) => scope.lines.filter((l) => l.section === section);
  const cableProducts = productsForType(products, "cable");
  const protectionProducts = productsForType(products, "protection");
  const accessoryProducts = productsForType(products, "accessory");
  const bore = scope.earthingBore;

  const attachCatalog = (line: ScopeLine, product: Product | null) => {
    if (!product) {
      onChangeLine(line.id, patchLine(line, { catalogProductId: "", rateSource: line.rateSource === "catalog" || line.rateSource === "website" ? "none" : line.rateSource }));
      return;
    }
    const price = Number(product.price);
    const hasPrice = Number.isFinite(price) && price > 0;
    onChangeLine(
      line.id,
      patchLine(line, {
        catalogProductId: product.id,
        specification: [product.brand, product.model, product.name].filter(Boolean).join(" ") || line.specification,
        rate: hasPrice ? price : line.rate,
        rateSource: hasPrice ? (product.source ? "website" : "catalog") : line.rateSource,
      })
    );
  };

  return (
    <div className="space-y-3">
      <ScopeDetails title="DC cabling" defaultOpen>
        <p className="text-[11px] text-slate-500">
          Replaces the generic DC cable job when any detailed run is included. Company default 280 PKR/m is editable; do not assume 4 mm².
        </p>
        <ScopeLineTable lines={bySection("dc_cabling")} onChangeLine={onChangeLine} />
        {cableProducts.length > 0 && (
          <div>
            <ScopeFieldLabel>Attach catalog cable to first included DC run</ScopeFieldLabel>
            <CatalogProductPicker
              products={cableProducts}
              valueId={bySection("dc_cabling").find((l) => l.inclusionState === "included")?.catalogProductId || ""}
              onSelect={(p) => {
                const target = bySection("dc_cabling").find((l) => l.inclusionState === "included") || bySection("dc_cabling")[0];
                if (target) attachCatalog(target, p);
              }}
            />
          </div>
        )}
      </ScopeDetails>

      <ScopeDetails title="AC cabling">
        <p className="text-[11px] text-slate-500">
          Company default 250 PKR/m. Exact cable selection overrides the generic rate.
        </p>
        <ScopeLineTable lines={bySection("ac_cabling")} onChangeLine={onChangeLine} />
      </ScopeDetails>

      <ScopeDetails title="Earthing / grounding">
        <p className="text-[11px] text-slate-500">Company default earth wire 380 PKR/m where a company preset exists.</p>
        <ScopeLineTable lines={bySection("earthing")} onChangeLine={onChangeLine} />
      </ScopeDetails>

      <ScopeDetails title="Earthing system / chemical bore notes">
        <p className="text-[11px] text-slate-500">
          Bore pricing stays on the existing Chemical Earthing Bores charge. Measured resistance is never invented.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TextField label="Depth" value={bore.depth} onChange={(v) => onChange({ earthingBore: { ...bore, depth: v } })} />
          <TextField label="Copper rod size" value={bore.copperRodSize} onChange={(v) => onChange({ earthingBore: { ...bore, copperRodSize: v } })} />
          <TextField label="Copper rod length" value={bore.copperRodLength} onChange={(v) => onChange({ earthingBore: { ...bore, copperRodLength: v } })} />
          <TextField label="Chemical compound" value={bore.chemicalCompound} onChange={(v) => onChange({ earthingBore: { ...bore, chemicalCompound: v } })} />
          <TextField label="Inspection chamber" value={bore.inspectionChamber} onChange={(v) => onChange({ earthingBore: { ...bore, inspectionChamber: v } })} />
          <TextField label="Earth resistance target" value={bore.earthResistanceTarget} onChange={(v) => onChange({ earthingBore: { ...bore, earthResistanceTarget: v } })} />
          <TextField label="Test link" value={bore.testLink} onChange={(v) => onChange({ earthingBore: { ...bore, testLink: v } })} />
          <TextField label="Earth busbar" value={bore.earthBusbar} onChange={(v) => onChange({ earthingBore: { ...bore, earthBusbar: v } })} />
          <div>
            <ScopeFieldLabel>Measured resistance</ScopeFieldLabel>
            <p className="mt-1 text-xs text-amber-200">{bore.measuredResistance.trim() || PENDING_EARTH_TEST}</p>
          </div>
        </div>
      </ScopeDetails>

      {ctx.batteryEnabled && (
        <ScopeDetails title="Battery accessories" defaultOpen>
          <ScopeLineTable lines={bySection("battery_accessories")} onChangeLine={onChangeLine} />
        </ScopeDetails>
      )}

      <ScopeDetails title="DC distribution / combiner">
        <ScopeLineTable lines={bySection("dc_protection")} onChangeLine={onChangeLine} />
        {protectionProducts.length > 0 && (
          <div>
            <ScopeFieldLabel>CRM protection product</ScopeFieldLabel>
            <CatalogProductPicker
              products={protectionProducts}
              valueId={bySection("dc_protection")[0]?.catalogProductId || ""}
              onSelect={(p) => {
                const target = bySection("dc_protection")[0];
                if (target) attachCatalog(target, p);
              }}
            />
          </div>
        )}
      </ScopeDetails>

      <ScopeDetails title="AC distribution / protection">
        <ScopeLineTable lines={bySection("ac_protection")} onChangeLine={onChangeLine} />
      </ScopeDetails>

      <ScopeDetails title="Lightning protection" defaultOpen={scope.lightningEnabled}>
        <ToggleRow
          label="Lightning protection system"
          checked={scope.lightningEnabled}
          onChange={(next) => onChange({ lightningEnabled: next })}
          hint="Enabling exposes air terminal, down conductor, test joint and earth path. A lone arrester is not allowed."
        />
        {scope.lightningEnabled && <ScopeLineTable lines={bySection("lightning")} onChangeLine={onChangeLine} />}
      </ScopeDetails>

      <ScopeDetails title="Cable management">
        <ScopeLineTable
          lines={
            scope.projectClass === "residential"
              ? bySection("cable_management").filter((l) => l.groupedResidential)
              : bySection("cable_management").filter((l) => !l.groupedResidential)
          }
          onChangeLine={onChangeLine}
        />
      </ScopeDetails>

      <ScopeDetails title="Monitoring / SCADA" defaultOpen={scope.scadaEnabled || scope.projectClass === "industrial"}>
        <ToggleRow
          label="SCADA / plant controller in scope"
          checked={scope.scadaEnabled}
          onChange={(next) => onChange({ scadaEnabled: next })}
        />
        <ScopeLineTable lines={bySection("monitoring")} onChangeLine={onChangeLine} />
        {accessoryProducts.length > 0 && (
          <div>
            <ScopeFieldLabel>CRM accessory / meter</ScopeFieldLabel>
            <CatalogProductPicker
              products={accessoryProducts}
              valueId={bySection("monitoring").find((l) => l.catalogProductId)?.catalogProductId || ""}
              onSelect={(p) => {
                const target = bySection("monitoring").find((l) => l.inclusionState !== "excluded") || bySection("monitoring")[0];
                if (target) attachCatalog(target, p);
              }}
            />
          </div>
        )}
      </ScopeDetails>
    </div>
  );
}
