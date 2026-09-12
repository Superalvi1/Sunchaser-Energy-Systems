import { BATTERY_ACCESSORY_IDS, CIVIL_FOUNDATION_IDS, LIGHTNING_PATH_IDS, setLineState } from "./lines";
import type { ProjectScopeState, ScopeContext, ScopeLine } from "./types";

function patch(lines: ScopeLine[], ids: readonly string[], include: ScopeLine["include"], state: ScopeLine["inclusionState"], qty?: number) {
  const set = new Set(ids);
  return lines.map((line) => (set.has(line.id) ? setLineState(line, include, state, qty) : line));
}

export function applyScopeDependencies(scope: ProjectScopeState, ctx: ScopeContext): ProjectScopeState {
  let lines = scope.lines.map((l) => ({ ...l }));
  const batteryOn = Boolean(ctx.batteryEnabled) && ctx.systemType !== "On-grid";

  lines = lines.map((line) => {
    if (
      !BATTERY_ACCESSORY_IDS.includes(line.id) &&
      line.id !== "earth_battery" &&
      line.id !== "batt_earth" &&
      line.id !== "ins_battery" &&
      line.id !== "log_battery" &&
      line.id !== "ac_backup"
    ) {
      return line;
    }
    if (!batteryOn) return setLineState(line, "no", "excluded", 0);
    return line;
  });

  if (scope.lightningEnabled) {
    lines = patch(lines, LIGHTNING_PATH_IDS, "yes", "included", 1);
    lines = lines.map((line) =>
      line.id === "lp_mast" || line.id === "lp_bonding" || line.id === "earth_lp_down"
        ? line.inclusionState === "excluded"
          ? setLineState(line, "conditional", "pending", 0)
          : line
        : line
    );
  } else {
    lines = lines.map((line) =>
      line.section === "lightning" || line.id === "earth_lp_down"
        ? setLineState(line, "no", "excluded", 0)
        : line
    );
  }

  const foundationNeeded =
    scope.rccFoundationRequired ||
    (ctx.structureType === "elevated" && scope.elevated.civilFoundation === "yes") ||
    (ctx.structureType === "girder" && scope.rccFoundationRequired);
  if (foundationNeeded) {
    lines = patch(lines, CIVIL_FOUNDATION_IDS, "yes", "included", 1);
  } else if (!scope.rccFoundationRequired) {
    // Leave preset pending civil lines as pending; do not auto-include.
  }

  if (scope.craneEnabled) {
    lines = patch(lines, ["log_crane"], "yes", "included", 1);
  } else {
    lines = lines.map((line) => (line.id === "log_crane" ? setLineState(line, "no", "excluded", 0) : line));
  }

  if (ctx.structureType === "girder") {
    lines = lines.map((line) =>
      line.id === "log_steel" && line.inclusionState === "excluded"
        ? setLineState(line, "conditional", "pending", 0)
        : line
    );
  }

  if (ctx.structureType === "standard") {
    lines = lines.map((line) =>
      line.id === "log_steel" && line.inclusionState === "included" ? setLineState(line, "no", "excluded", 0) : line
    );
  }

  if (scope.scadaEnabled) {
    lines = lines.map((line) =>
      line.id === "mon_scada_gw" && line.inclusionState === "excluded"
        ? setLineState(line, "conditional", "pending", 0)
        : line
    );
  }

  if (ctx.systemType === "Off-grid") {
    lines = lines.map((line) =>
      line.section === "net_metering" || line.id === "doc_utility"
        ? line.include === "yes"
          ? line
          : setLineState(line, "no", "excluded", 0)
        : line
    );
  }

  return { ...scope, lines };
}

export function isMsStructure(scope: ProjectScopeState, ctx: ScopeContext): boolean {
  if (ctx.structureType === "girder" && scope.girder.material === "ms") return true;
  if (ctx.structureType === "elevated" && scope.elevated.finish === "primer_paint") return true;
  return false;
}

export function scopeContextFromParts(parts: {
  systemType: ScopeContext["systemType"];
  structureType: ScopeContext["structureType"];
  batteryEnabled: boolean;
  panelQuantity: number;
}): ScopeContext {
  return {
    systemType: parts.systemType,
    structureType: parts.structureType,
    batteryEnabled: Boolean(parts.batteryEnabled) && parts.systemType !== "On-grid",
    panelQuantity: parts.panelQuantity,
  };
}
