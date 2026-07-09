/**
 * Solar Quote Planner — draft models only. No CRM persistence types.
 */

export type SolarSystemType = "on-grid" | "hybrid" | "off-grid";

export interface SolarQuotePlannerInput {
  /** Accepted for sizing context only — never echoed in draft output. */
  customerName?: string;
  systemSizeKw: number;
  systemType: SolarSystemType;
  location?: string;
  monthlyBill?: number;
  backupRequirement?: string;
}

export interface SolarBoqDraftLine {
  id: string;
  category: string;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  indicativeRate: number;
}

export interface SolarQuoteDraft {
  valid: boolean;
  errors: string[];
  draftOnly: true;
  recommendedSystemSummary: string;
  systemSizeKw: number;
  systemType: SolarSystemType;
  panelCountEstimate: number;
  panelWattage: number;
  panelBrandSuggestion: string;
  inverterSuggestion: string;
  batterySuggestion: string | null;
  structureProtectionNotes: string[];
  boqDraft: SolarBoqDraftLine[];
  assumptions: string[];
  warnings: string[];
  nextSteps: string[];
  locationLabel: string;
  backupLabel: string;
}
