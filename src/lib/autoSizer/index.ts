export {
  recommendStructures,
  normalizeStructureBreakdown,
  structureKitTotal,
  L3_PANEL_POSITIONS,
  L2_PANEL_POSITIONS,
  STANDARD_STRUCTURE_PER_PANEL_RATE,
  L3_STRUCTURE_KIT_RATE,
  L2_STRUCTURE_KIT_RATE,
  type StructureBreakdown,
  type StructureKitLine,
  type StructureKitCode,
} from "./structureRecommendation";

export {
  AUTOSIZER_PRESETS,
  AUTOSIZER_PRESET_SIZES_KW,
  resolveAutoSizerPreset,
  nearestAutoSizerPresetSize,
  isAutoSizerPresetSize,
  dcCableQuantityMeters,
  type AutoSizerPreset,
  type AutoSizerCablePreset,
  type AutoSizerPresetSizeKw,
  type AutoSizerSystemType,
} from "./presets";

export {
  generateRecommendedBoq,
  readStructureBreakdownFromRows,
  AUTO_SIZER_BOQ_IDS,
  STRUCTURE_L3_ROW_ID,
  STRUCTURE_L2_ROW_ID,
  STRUCTURE_JOB_ROW_ID,
  type GenerateRecommendedBoqInput,
  type RecommendedBoqResult,
} from "./generateRecommendedBoq";

export {
  markOverride,
  isOverridden,
  shouldRegenerateField,
  applyStructureKitOverride,
  applyNamedRowQty,
  applyNamedRowFields,
  snapshotHasItems,
  EMPTY_MANUAL_OVERRIDES,
  type QuoteManualOverrides,
  type QuoteManualOverrideField,
} from "./overrides";

export const STANDARD_QUOTATION_PAGES = ["cover", "boq", "terms"] as const;
export type StandardQuotationPage = (typeof STANDARD_QUOTATION_PAGES)[number];
