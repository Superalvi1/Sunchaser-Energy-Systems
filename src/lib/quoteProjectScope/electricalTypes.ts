export type DcConductor = "" | "copper" | "tinned_copper" | "other";
export type DcAreaMm2 = "" | "4" | "6" | "10" | "16" | "custom";
export type DcVoltageRating = "" | "1000v" | "1500v" | "custom";
export type DcPolarity = "" | "positive" | "negative" | "both";

export type AcPhase = "" | "single" | "three";
export type AcConductor = "" | "copper" | "aluminium";
export type AcCores = "" | "2c" | "3c" | "4c" | "4c_e" | "custom";
export type AcAreaMm2 =
  | ""
  | "6"
  | "10"
  | "16"
  | "25"
  | "35"
  | "50"
  | "70"
  | "95"
  | "120"
  | "150"
  | "185"
  | "240"
  | "custom";
export type AcConstruction = "" | "pvc" | "xlpe" | "xlpe_swa_pvc" | "flexible" | "custom";
export type AcVoltageRating = "" | "0.6_1kv" | "custom";

export type SpdType = "" | "type_ii" | "type_i_ii" | "none";
export type EnclosureIp = "" | "ip40" | "ip54" | "ip65" | "ip66" | "custom";
export type CombinerMonitoring = "" | "none" | "string" | "smart";
export type YesNoPending = "" | "yes" | "no" | "pending";
export type EarthConductorType = "" | "bare_copper" | "insulated_copper" | "gi_strip" | "copper_strip" | "custom";
export type BusbarMaterial = "" | "copper" | "aluminium";

export interface DcCableRunDetail {
  lineId: string;
  brand: string;
  cableType: string;
  conductor: DcConductor;
  areaMm2: DcAreaMm2;
  customArea: string;
  voltageRating: DcVoltageRating;
  customVoltage: string;
  lengthM: number;
  runCount: number;
  polarity: DcPolarity;
  ratePerMeter: number;
  catalogProductId: string;
}

export interface AcCableRunDetail {
  lineId: string;
  phase: AcPhase;
  conductor: AcConductor;
  cores: AcCores;
  customCores: string;
  areaMm2: AcAreaMm2;
  customArea: string;
  construction: AcConstruction;
  customConstruction: string;
  voltageRating: AcVoltageRating;
  customVoltage: string;
  lengthM: number;
  runs: number;
  ratePerMeter: number;
  catalogProductId: string;
}

export interface DcCombinerDetail {
  numberOfStrings: number;
  inputs: number;
  outputs: number;
  stringFuseCurrentA: string;
  stringFuseVoltageV: string;
  dcBreakerType: string;
  dcBreakerCurrentA: string;
  dcBreakerVoltageV: string;
  dcIsolator: YesNoPending;
  spdType: SpdType;
  spdVoltageRating: string;
  monitoring: CombinerMonitoring;
  enclosureIp: EnclosureIp;
  customEnclosureIp: string;
  qty: number;
  unitPrice: number;
  catalogProductId: string;
}

export interface AcPanelDetail {
  lineId: string;
  panelType: string;
  incomingBreakerType: string;
  incomingPoles: string;
  incomingCurrentA: string;
  incomingBreakingCapacityKa: string;
  outgoingBreakerType: string;
  outgoingPoles: string;
  outgoingCurrentA: string;
  outgoingBreakingCapacityKa: string;
  acSpd: SpdType;
  rccbRcboType: string;
  residualCurrentMa: string;
  voltageProtectionRelay: YesNoPending;
  phaseFailureRelay: YesNoPending;
  phaseSequenceRelay: YesNoPending;
  contactor: string;
  isolator: string;
  energyMeter: string;
  ctRatio: string;
  enclosureIp: EnclosureIp;
  customEnclosureIp: string;
  busbarMaterial: BusbarMaterial;
  busbarRatingA: string;
  neutralBus: YesNoPending;
  earthBus: YesNoPending;
  qty: number;
  panelCost: number;
  catalogProductId: string;
}

export interface LightningDetail {
  airTerminalType: string;
  airTerminalQty: number;
  mastHeight: string;
  mastQty: number;
  downConductorType: string;
  downConductorArea: string;
  downConductorLength: number;
  testJointQty: number;
  earthPitQty: number;
  bondingAccessories: string;
  spdCoordinationRequired: YesNoPending;
}

export interface CableTrayDetail {
  trayType: string;
  widthMm: string;
  heightMm: string;
  thicknessMm: string;
  lengthM: number;
  coverRequired: YesNoPending;
  bendQty: number;
  teeQty: number;
  reducerQty: number;
  supportQty: number;
  hangerQty: number;
  rate: number;
}

export interface EarthingConductorDetail {
  lineId: string;
  conductorType: EarthConductorType;
  customType: string;
  areaMm2: string;
  stripSize: string;
  lengthM: number;
  ratePerMeter: number;
}

export function emptyDcCableRun(lineId: string, polarity: DcPolarity = ""): DcCableRunDetail {
  return {
    lineId,
    brand: "",
    cableType: "",
    conductor: "",
    areaMm2: "",
    customArea: "",
    voltageRating: "",
    customVoltage: "",
    lengthM: 0,
    runCount: 1,
    polarity,
    ratePerMeter: 0,
    catalogProductId: "",
  };
}

export function emptyAcCableRun(lineId: string): AcCableRunDetail {
  return {
    lineId,
    phase: "",
    conductor: "",
    cores: "",
    customCores: "",
    areaMm2: "",
    customArea: "",
    construction: "",
    customConstruction: "",
    voltageRating: "",
    customVoltage: "",
    lengthM: 0,
    runs: 1,
    ratePerMeter: 0,
    catalogProductId: "",
  };
}

export function emptyDcCombiner(): DcCombinerDetail {
  return {
    numberOfStrings: 0,
    inputs: 0,
    outputs: 0,
    stringFuseCurrentA: "",
    stringFuseVoltageV: "",
    dcBreakerType: "",
    dcBreakerCurrentA: "",
    dcBreakerVoltageV: "",
    dcIsolator: "",
    spdType: "",
    spdVoltageRating: "",
    monitoring: "",
    enclosureIp: "",
    customEnclosureIp: "",
    qty: 0,
    unitPrice: 0,
    catalogProductId: "",
  };
}

export function emptyAcPanel(lineId: string): AcPanelDetail {
  return {
    lineId,
    panelType: "",
    incomingBreakerType: "",
    incomingPoles: "",
    incomingCurrentA: "",
    incomingBreakingCapacityKa: "",
    outgoingBreakerType: "",
    outgoingPoles: "",
    outgoingCurrentA: "",
    outgoingBreakingCapacityKa: "",
    acSpd: "",
    rccbRcboType: "",
    residualCurrentMa: "",
    voltageProtectionRelay: "",
    phaseFailureRelay: "",
    phaseSequenceRelay: "",
    contactor: "",
    isolator: "",
    energyMeter: "",
    ctRatio: "",
    enclosureIp: "",
    customEnclosureIp: "",
    busbarMaterial: "",
    busbarRatingA: "",
    neutralBus: "",
    earthBus: "",
    qty: 0,
    panelCost: 0,
    catalogProductId: "",
  };
}

export function emptyLightningDetail(): LightningDetail {
  return {
    airTerminalType: "",
    airTerminalQty: 0,
    mastHeight: "",
    mastQty: 0,
    downConductorType: "",
    downConductorArea: "",
    downConductorLength: 0,
    testJointQty: 0,
    earthPitQty: 0,
    bondingAccessories: "",
    spdCoordinationRequired: "pending",
  };
}

export function emptyCableTray(): CableTrayDetail {
  return {
    trayType: "",
    widthMm: "",
    heightMm: "",
    thicknessMm: "",
    lengthM: 0,
    coverRequired: "",
    bendQty: 0,
    teeQty: 0,
    reducerQty: 0,
    supportQty: 0,
    hangerQty: 0,
    rate: 0,
  };
}

export function emptyEarthConductor(lineId: string): EarthingConductorDetail {
  return {
    lineId,
    conductorType: "",
    customType: "",
    areaMm2: "",
    stripSize: "",
    lengthM: 0,
    ratePerMeter: 0,
  };
}

export const DC_POLARITY_FOR_LINE: Record<string, DcPolarity> = {
  dc_pos: "positive",
  dc_neg: "negative",
};
