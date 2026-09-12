import React from "react";
import type { Product } from "../../types";
import type { ProjectScopeState, ScopeContext, ScopeLine } from "../../lib/quoteProjectScope";
import {
  DC_POLARITY_FOR_LINE,
  PENDING_EARTH_TEST,
  emptyAcCableRun,
  emptyAcPanel,
  emptyDcCableRun,
  emptyEarthConductor,
} from "../../lib/quoteProjectScope";
import { productsForType } from "../../lib/websiteCatalog/sync";
import CatalogProductPicker from "./CatalogProductPicker";
import { ScopeDetails, ScopeLineTable, TextField, ToggleRow } from "./ScopeLineTable";
import { patchLine, ScopeFieldLabel } from "./quoteScopeUi";
import {
  AcCableDetailEditor,
  AcPanelEditor,
  CableTrayEditor,
  DcCableDetailEditor,
  DcCombinerEditor,
  EarthConductorEditor,
  LightningDetailEditor,
} from "./ScopeTechnicalEditors";

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
  const visibleDc = bySection("dc_cabling").filter((l) => l.inclusionState !== "excluded");
  const visibleAc = bySection("ac_cabling").filter((l) => l.inclusionState !== "excluded");
  const visibleEarth = bySection("earthing").filter((l) => l.inclusionState !== "excluded");
  const visibleAcPanels = bySection("ac_protection").filter((l) => l.inclusionState !== "excluded");

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

  const patchDc = (id: string, next: typeof scope.dcCables[string]) => {
    const line = scope.lines.find((l) => l.id === id);
    onChange({
      dcCables: { ...scope.dcCables, [id]: next },
      lines: line
        ? scope.lines.map((l) =>
            l.id === id
              ? patchLine(l, {
                  qty: next.lengthM > 0 ? next.lengthM * Math.max(1, next.runCount || 1) : l.qty,
                  rate: next.ratePerMeter > 0 ? next.ratePerMeter : l.rate,
                  catalogProductId: next.catalogProductId || l.catalogProductId,
                })
              : l
          )
        : scope.lines,
    });
  };

  const patchAc = (id: string, next: typeof scope.acCables[string]) => {
    const line = scope.lines.find((l) => l.id === id);
    onChange({
      acCables: { ...scope.acCables, [id]: next },
      lines: line
        ? scope.lines.map((l) =>
            l.id === id
              ? patchLine(l, {
                  qty: next.lengthM > 0 ? next.lengthM * Math.max(1, next.runs || 1) : l.qty,
                  rate: next.ratePerMeter > 0 ? next.ratePerMeter : l.rate,
                })
              : l
          )
        : scope.lines,
    });
  };

  return (
    <div className="space-y-3">
      <ScopeDetails title="DC cabling" defaultOpen>
        <ToggleRow
          label="Replace standard DC cable allowance with detailed schedule"
          checked={scope.replaceGenericDc}
          onChange={(next) => onChange({ replaceGenericDc: next })}
          hint="Off keeps the generic DC allowance. On requires complete positive and negative runs before Apply."
        />
        <ScopeLineTable lines={bySection("dc_cabling")} onChangeLine={onChangeLine} />
        {visibleDc.map((line) => (
          <DcCableDetailEditor
            key={line.id}
            title={line.name}
            detail={scope.dcCables[line.id] || emptyDcCableRun(line.id, DC_POLARITY_FOR_LINE[line.id] || "")}
            onChange={(next) => patchDc(line.id, next)}
          />
        ))}
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
        <ToggleRow
          label="Replace standard AC cable allowance with detailed schedule"
          checked={scope.replaceGenericAc}
          onChange={(next) => onChange({ replaceGenericAc: next })}
          hint="Off keeps the generic AC allowance. On requires the inverter → AC DB route and any other selected AC runs."
        />
        <ScopeLineTable lines={bySection("ac_cabling")} onChangeLine={onChangeLine} />
        {visibleAc.map((line) => (
          <AcCableDetailEditor
            key={line.id}
            title={line.name}
            detail={scope.acCables[line.id] || emptyAcCableRun(line.id)}
            onChange={(next) => patchAc(line.id, next)}
          />
        ))}
      </ScopeDetails>

      <ScopeDetails title="Earthing / grounding">
        <ToggleRow
          label="Replace standard earthing allowance with detailed schedule"
          checked={scope.replaceGenericEarth}
          onChange={(next) => onChange({ replaceGenericEarth: next })}
          hint="Off keeps the generic earth-wire allowance. On requires PV structure + inverter earth runs."
        />
        <ScopeLineTable lines={bySection("earthing")} onChangeLine={onChangeLine} />
        {visibleEarth.map((line) => (
          <EarthConductorEditor
            key={line.id}
            title={line.name}
            detail={scope.earthConductors[line.id] || emptyEarthConductor(line.id)}
            onChange={(next) =>
              onChange({
                earthConductors: { ...scope.earthConductors, [line.id]: next },
                lines: scope.lines.map((l) =>
                  l.id === line.id
                    ? patchLine(l, {
                        qty: next.lengthM > 0 ? next.lengthM : l.qty,
                        rate: next.ratePerMeter > 0 ? next.ratePerMeter : l.rate,
                      })
                    : l
                ),
              })
            }
          />
        ))}
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
        {bySection("dc_protection").some((l) => l.inclusionState !== "excluded") && (
          <DcCombinerEditor
            detail={scope.dcCombiner}
            onChange={(next) =>
              onChange({
                dcCombiner: next,
                lines: scope.lines.map((l) =>
                  l.id === "dc_combiner"
                    ? patchLine(l, {
                        qty: next.qty > 0 ? next.qty : l.qty,
                        rate: next.unitPrice > 0 ? next.unitPrice : l.rate,
                        catalogProductId: next.catalogProductId || l.catalogProductId,
                      })
                    : l
                ),
              })
            }
          />
        )}
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
        {visibleAcPanels.map((line) => (
          <div key={line.id} className="rounded-xl border border-slate-800/80 p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{line.name}</p>
            <AcPanelEditor
              detail={scope.acPanels[line.id] || emptyAcPanel(line.id)}
              onChange={(next) =>
                onChange({
                  acPanels: { ...scope.acPanels, [line.id]: next },
                  lines: scope.lines.map((l) =>
                    l.id === line.id
                      ? patchLine(l, {
                          qty: next.qty > 0 ? next.qty : l.qty,
                          rate: next.panelCost > 0 ? next.panelCost : l.rate,
                        })
                      : l
                  ),
                })
              }
            />
          </div>
        ))}
      </ScopeDetails>

      <ScopeDetails title="Lightning protection" defaultOpen={scope.lightningEnabled}>
        <ToggleRow
          label="Lightning protection system"
          checked={scope.lightningEnabled}
          onChange={(next) => onChange({ lightningEnabled: next })}
          hint="Enabling requires air terminal, down conductor, test joint and earth path."
        />
        {scope.lightningEnabled && (
          <>
            <LightningDetailEditor detail={scope.lightningDetail} onChange={(next) => onChange({ lightningDetail: next })} />
            <ScopeLineTable lines={bySection("lightning")} onChangeLine={onChangeLine} />
          </>
        )}
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
        {bySection("cable_management").some((l) => l.id === "cm_tray" && l.inclusionState !== "excluded") && (
          <CableTrayEditor
            detail={scope.cableTray}
            onChange={(next) =>
              onChange({
                cableTray: next,
                lines: scope.lines.map((l) =>
                  l.id === "cm_tray"
                    ? patchLine(l, {
                        qty: next.lengthM > 0 ? next.lengthM : l.qty,
                        rate: next.rate > 0 ? next.rate : l.rate,
                      })
                    : l
                ),
              })
            }
          />
        )}
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
