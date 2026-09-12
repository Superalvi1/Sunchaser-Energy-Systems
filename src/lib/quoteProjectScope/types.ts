export type ProjectClass = "residential" | "commercial" | "industrial" | "custom";
export type ScopeMode = "standard" | "advanced";
export type ScopePreset = "residential_standard" | "commercial_standard" | "industrial_standard" | "custom";
export type InclusionState = "included" | "excluded" | "pending";
export type ScopeStatus = "mandatory" | "conditional" | "optional";
export type IncludeChoice = "yes" | "no" | "conditional";
export type RateSource = "catalog" | "website" | "company_preset" | "manual" | "none";

export type CostGroup =
  | "pv_modules"
  | "inverter"
  | "battery"
  | "mounting_structure"
  | "dc_bos"
  | "ac_bos"
  | "earthing"
  | "protection"
  | "lightning"
  | "monitoring"
  | "civil"
  | "transport"
  | "installation"
  | "engineering"
  | "documentation"
  | "net_metering"
  | "other";

export type ScopeSection =
  | "hardware"
  | "finish"
  | "dc_cabling"
  | "ac_cabling"
  | "earthing"
  | "earthing_system"
  | "battery_accessories"
  | "dc_protection"
  | "ac_protection"
  | "lightning"
  | "cable_management"
  | "monitoring"
  | "survey"
  | "logistics"
  | "installation"
  | "civil"
  | "documentation"
  | "net_metering";

export interface ScopeLine {
  id: string;
  section: ScopeSection;
  name: string;
  specification: string;
  include: IncludeChoice;
  inclusionState: InclusionState;
  scopeStatus: ScopeStatus;
  qty: number;
  unit: string;
  rate: number;
  notes: string;
  catalogProductId: string;
  costGroup: CostGroup;
  groupedResidential: boolean;
  rateSource: RateSource;
  replacesGenericId?: string;
}

export interface GirderDetails {
  girderType: "mughal" | "custom_fabricated";
  mainSection: "" | "4x2" | "6x3" | "8x4" | "custom";
  mainSectionCustom: string;
  wallThickness: string;
  material: "" | "ms" | "gi" | "other";
  steelGrade: string;
  span: string;
  columnCount: number;
  columnSection: string;
  designLoadStatus: "pending_structural_design" | "provided";
  designLoadNote: string;
  windLoadDesign: "yes" | "no" | "pending";
  basePlateLength: string;
  basePlateWidth: string;
  basePlateThickness: string;
  anchorBoltDiameter: string;
  anchorBoltGrade: string;
  anchorBoltQty: number;
  girderLengthFt: number;
  weight: string;
  jobAmount: number;
}

export interface ElevatedDetails {
  height: string;
  columnSpacing: string;
  mainGirder: string;
  secondaryMember: string;
  steelSection: string;
  materialGrade: string;
  basePlate: string;
  anchorBolt: string;
  finish: "" | "hot_dip" | "primer_paint" | "other";
  civilFoundation: "yes" | "no" | "auto";
}

export interface StructureFinish {
  finish: "" | "hot_dip" | "zinc_primer" | "anti_rust" | "epoxy" | "powder" | "client" | "none";
  surfaceArea: number;
  coatSystem: string;
  coats: number;
  rate: number;
  amount: number;
}

export interface EarthingBoreDetails {
  depth: string;
  copperRodSize: string;
  copperRodLength: string;
  chemicalCompound: string;
  inspectionChamber: string;
  earthResistanceTarget: string;
  testLink: string;
  earthBusbar: string;
  /** Never fabricate a measured value before installation. */
  measuredResistance: string;
}

export interface ProjectScopeState {
  projectClass: ProjectClass;
  scopeMode: ScopeMode;
  preset: ScopePreset;
  lines: ScopeLine[];
  girder: GirderDetails;
  elevated: ElevatedDetails;
  finish: StructureFinish;
  earthingBore: EarthingBoreDetails;
  lightningEnabled: boolean;
  craneEnabled: boolean;
  rccFoundationRequired: boolean;
  scadaEnabled: boolean;
}

export interface ScopeContext {
  systemType: "On-grid" | "Hybrid" | "Off-grid";
  structureType: "standard" | "elevated" | "girder" | "custom";
  batteryEnabled: boolean;
  panelQuantity: number;
}

export interface ScopeMatrixGroup {
  included: string[];
  excluded: string[];
  pending: string[];
}

export interface CostGroupTotal {
  group: CostGroup;
  label: string;
  amount: number;
}

export const UNAVAILABLE_SPEC = "Not available in catalog";
export const PENDING_STRUCTURAL_DESIGN = "Pending structural design";
export const PENDING_SITE_SURVEY = "Pending Site Survey";
export const PENDING_EARTH_TEST = "Pending test";

export const COST_GROUP_LABELS: Record<CostGroup, string> = {
  pv_modules: "PV Modules",
  inverter: "Inverter",
  battery: "Battery",
  mounting_structure: "Mounting Structure",
  dc_bos: "DC BOS",
  ac_bos: "AC BOS",
  earthing: "Earthing",
  protection: "Protection",
  lightning: "Lightning Protection",
  monitoring: "Monitoring / SCADA",
  civil: "Civil Works",
  transport: "Transportation",
  installation: "Installation",
  engineering: "Engineering",
  documentation: "Documentation",
  net_metering: "Net Metering",
  other: "Other",
};

export const SECTION_LABELS: Record<ScopeSection, string> = {
  hardware: "Structural Hardware",
  finish: "Structure Finish",
  dc_cabling: "DC Cabling",
  ac_cabling: "AC Cabling",
  earthing: "Earthing / Grounding",
  earthing_system: "Earthing System",
  battery_accessories: "Battery Accessories",
  dc_protection: "DC Distribution / Combiner",
  ac_protection: "AC Distribution / Protection",
  lightning: "Lightning Protection",
  cable_management: "Cable Management",
  monitoring: "Monitoring / SCADA",
  survey: "Site Survey / Engineering",
  logistics: "Transport / Logistics",
  installation: "Installation / Commissioning extras",
  civil: "Civil Works",
  documentation: "Documentation & Handover",
  net_metering: "Net Metering extras",
};

export const COST_GROUP_ORDER: CostGroup[] = [
  "pv_modules",
  "inverter",
  "battery",
  "mounting_structure",
  "dc_bos",
  "ac_bos",
  "earthing",
  "protection",
  "lightning",
  "monitoring",
  "civil",
  "transport",
  "installation",
  "engineering",
  "documentation",
  "net_metering",
  "other",
];
