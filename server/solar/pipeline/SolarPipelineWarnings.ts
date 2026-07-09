/**
 * Solar Design Pipeline — warning aggregation from stage outputs.
 */

import type { PanelLayoutResult } from "../proposal/PanelLayoutEngine.ts";
import type { RoofSiteMetrics } from "../roof/RoofModels.ts";
import type { SolarSimulationResult } from "../simulation/SolarSimulationModels.ts";

export function mergePipelineWarnings(
  sources: Array<string[] | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of sources) {
    if (!list) continue;
    for (const w of list) {
      const t = w.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function roofStageWarnings(roof: RoofSiteMetrics | null): string[] {
  if (!roof) return ["Roof geometry stage skipped — using canvas/default boundary."];
  const warnings = [...roof.warnings];
  if (roof.totalNetUsableAreaM2 < 10) {
    warnings.push(`Low net usable roof area: ${roof.totalNetUsableAreaM2} m².`);
  }
  return warnings;
}

export function layoutStageWarnings(layout: PanelLayoutResult): string[] {
  return [...layout.warnings];
}

export function simulationStageWarnings(simulation: SolarSimulationResult): string[] {
  return [...simulation.warnings];
}

export function layoutValidationMessages(layout: PanelLayoutResult): string[] {
  const msgs: string[] = [];
  if (!layout.fitsOnRoof) {
    msgs.push(`${layout.unplacedPanels} panel(s) could not be placed on roof.`);
  }
  if (layout.placedPanels.length === 0) {
    msgs.push("No panels placed on roof boundary.");
  }
  return msgs;
}
