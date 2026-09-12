import { finiteNumber } from "../quoteCommercialMath";
import type {
  AcCableRunDetail,
  AcPanelDetail,
  CableTrayDetail,
  DcCableRunDetail,
  DcCombinerDetail,
  EarthingConductorDetail,
  LightningDetail,
} from "./electricalTypes";
import { emptyLightningDetail } from "./electricalTypes";
import type { CivilFoundationDetail } from "./civilTypes";
import { emptyCivilFoundation } from "./civilTypes";
import type { ProjectScopeState, ScopeLine } from "./types";

function withQtyRate(line: ScopeLine, qty: number, rate: number, extra?: Partial<ScopeLine>): ScopeLine {
  return {
    ...line,
    qty: finiteNumber(qty, 0),
    rate: finiteNumber(rate, 0),
    ...extra,
  };
}

export function dcLineQty(detail: DcCableRunDetail): number {
  return finiteNumber(detail.lengthM, 0) * Math.max(0, finiteNumber(detail.runCount, 0));
}

export function acLineQty(detail: AcCableRunDetail): number {
  return finiteNumber(detail.lengthM, 0) * Math.max(0, finiteNumber(detail.runs, 0));
}

export function applyDcCableDetail(scope: ProjectScopeState, id: string, detail: DcCableRunDetail): ProjectScopeState {
  const next = { ...detail, lineId: id };
  return {
    ...scope,
    dcCables: { ...(scope.dcCables || {}), [id]: next },
    lines: scope.lines.map((line) =>
      line.id === id
        ? withQtyRate(line, dcLineQty(next), next.ratePerMeter, { catalogProductId: next.catalogProductId || "" })
        : line
    ),
  };
}

export function applyAcCableDetail(scope: ProjectScopeState, id: string, detail: AcCableRunDetail): ProjectScopeState {
  const next = { ...detail, lineId: id };
  return {
    ...scope,
    acCables: { ...(scope.acCables || {}), [id]: next },
    lines: scope.lines.map((line) =>
      line.id === id
        ? withQtyRate(line, acLineQty(next), next.ratePerMeter, { catalogProductId: next.catalogProductId || "" })
        : line
    ),
  };
}

export function applyEarthConductorDetail(
  scope: ProjectScopeState,
  id: string,
  detail: EarthingConductorDetail
): ProjectScopeState {
  const next = { ...detail, lineId: id };
  return {
    ...scope,
    earthConductors: { ...(scope.earthConductors || {}), [id]: next },
    lines: scope.lines.map((line) =>
      line.id === id ? withQtyRate(line, next.lengthM, next.ratePerMeter) : line
    ),
  };
}

export function applyDcCombinerDetail(scope: ProjectScopeState, detail: DcCombinerDetail): ProjectScopeState {
  return {
    ...scope,
    dcCombiner: detail,
    lines: scope.lines.map((line) =>
      line.id === "dc_combiner"
        ? withQtyRate(line, detail.qty, detail.unitPrice, { catalogProductId: detail.catalogProductId || "" })
        : line
    ),
  };
}

export function applyAcPanelDetail(scope: ProjectScopeState, id: string, detail: AcPanelDetail): ProjectScopeState {
  const next = { ...detail, lineId: id };
  return {
    ...scope,
    acPanels: { ...(scope.acPanels || {}), [id]: next },
    lines: scope.lines.map((line) =>
      line.id === id
        ? withQtyRate(line, next.qty, next.panelCost, { catalogProductId: next.catalogProductId || "" })
        : line
    ),
  };
}

export function applyCableTrayDetail(scope: ProjectScopeState, detail: CableTrayDetail): ProjectScopeState {
  return {
    ...scope,
    cableTray: detail,
    lines: scope.lines.map((line) => (line.id === "cm_tray" ? withQtyRate(line, detail.lengthM, detail.rate) : line)),
  };
}

const LIGHTNING_QTY_IDS = ["lp_air", "lp_mast", "lp_down", "lp_test", "lp_earth", "earth_lp_down"] as const;

export function lightningQtyForLine(detail: LightningDetail | undefined, lineId: string): number | undefined {
  const d = detail || emptyLightningDetail();
  if (lineId === "lp_air") return finiteNumber(d.airTerminalQty, 0);
  if (lineId === "lp_mast") return finiteNumber(d.mastQty, 0);
  if (lineId === "lp_down" || lineId === "earth_lp_down") return finiteNumber(d.downConductorLength, 0);
  if (lineId === "lp_test") return finiteNumber(d.testJointQty, 0);
  if (lineId === "lp_earth") return finiteNumber(d.earthPitQty, 0);
  return undefined;
}

export function applyLightningQuantities(scope: ProjectScopeState): ProjectScopeState {
  if (!scope.lightningEnabled) return scope;
  const detail = scope.lightningDetail || emptyLightningDetail();
  return {
    ...scope,
    lines: scope.lines.map((line) => {
      if (!(LIGHTNING_QTY_IDS as readonly string[]).includes(line.id)) return line;
      const qty = lightningQtyForLine(detail, line.id);
      return qty == null ? line : { ...line, qty };
    }),
  };
}

export function applyLightningDetail(scope: ProjectScopeState, detail: LightningDetail): ProjectScopeState {
  return applyLightningQuantities({ ...scope, lightningDetail: detail });
}

const CIVIL_QTY: Record<string, (d: CivilFoundationDetail) => number> = {
  cv_pads: (d) => finiteNumber(d.foundationPadQty, 0),
  cv_excavation: (d) => finiteNumber(d.excavationQty, 0),
  cv_pcc: (d) => finiteNumber(d.pccQty, 0),
  cv_rcc: (d) => finiteNumber(d.rccQty, 0),
  cv_rebar: (d) => finiteNumber(d.rebarKg, 0),
  cv_formwork: (d) => finiteNumber(d.formworkArea, 0),
  cv_anchors: (d) => finiteNumber(d.anchorBoltQty, 0),
};

export function applyCivilQuantities(scope: ProjectScopeState): ProjectScopeState {
  const detail = scope.civilFoundation || emptyCivilFoundation();
  return {
    ...scope,
    lines: scope.lines.map((line) => {
      const read = CIVIL_QTY[line.id];
      return read ? { ...line, qty: read(detail) } : line;
    }),
  };
}

export function applyCivilFoundation(scope: ProjectScopeState, detail: CivilFoundationDetail): ProjectScopeState {
  return applyCivilQuantities({ ...scope, civilFoundation: detail });
}
