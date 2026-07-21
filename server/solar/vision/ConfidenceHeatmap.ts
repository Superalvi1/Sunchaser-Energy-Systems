/**
 * Confidence heatmap — a deterministic grid over the image where each cell's
 * value is the confidence of the highest-confidence extracted polygon covering
 * that cell's center. Cell coverage uses the geometry engine's pointInPolygon
 * (no duplicate point-in-polygon math).
 */

import { pointInPolygon } from "../roof/RoofPolygon.ts";
import {
  clampUnit,
  round4,
  VisionPipelineError,
  type ConfidenceHeatmap,
  type ConfidenceHeatmapCell,
  type ExtractedPolygon,
} from "./VisionModels.ts";

export interface HeatmapOptions {
  /** Grid cell size in pixels. Default 32. */
  cellSizePx?: number;
}

export function buildConfidenceHeatmap(
  widthPx: number,
  heightPx: number,
  polygons: ExtractedPolygon[],
  options: HeatmapOptions = {}
): ConfidenceHeatmap {
  const cellSizePx = options.cellSizePx ?? 32;
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    throw new VisionPipelineError("INVALID_HEATMAP_WIDTH", "widthPx must be a positive number.");
  }
  if (!Number.isFinite(heightPx) || heightPx <= 0) {
    throw new VisionPipelineError("INVALID_HEATMAP_HEIGHT", "heightPx must be a positive number.");
  }
  if (!Number.isFinite(cellSizePx) || cellSizePx <= 0) {
    throw new VisionPipelineError("INVALID_HEATMAP_CELL", "cellSizePx must be a positive number.");
  }

  const cols = Math.ceil(widthPx / cellSizePx);
  const rows = Math.ceil(heightPx / cellSizePx);
  const cells: ConfidenceHeatmapCell[] = [];

  let coveredSum = 0;
  let coveredCount = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cellSizePx;
      const y = row * cellSizePx;
      const width = Math.min(cellSizePx, widthPx - x);
      const height = Math.min(cellSizePx, heightPx - y);
      const center = { x: x + width / 2, y: y + height / 2 };

      let value = 0;
      for (const polygon of polygons) {
        if (pointInPolygon(center, polygon.verticesPx)) {
          value = Math.max(value, polygon.confidence);
        }
      }
      value = clampUnit(round4(value));
      if (value > 0) {
        coveredSum += value;
        coveredCount += 1;
      }
      cells.push({ col, row, x, y, width, height, value });
    }
  }

  const meanConfidence = coveredCount > 0 ? round4(coveredSum / coveredCount) : 0;

  return { cellSizePx, cols, rows, cells, meanConfidence };
}
