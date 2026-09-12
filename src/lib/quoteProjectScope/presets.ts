import type {
  IncludeChoice,
  InclusionState,
  ProjectClass,
  ProjectScopeState,
  ScopeContext,
  ScopeLine,
  ScopeMode,
  ScopePreset,
} from "./types";
import { allDefaultLines, presetIdForClass, setLineState } from "./lines";
import {
  emptyAcCableRun,
  emptyAcPanel,
  emptyCableTray,
  emptyDcCombiner,
  emptyDcCableRun,
  emptyEarthConductor,
  emptyLightningDetail,
  DC_POLARITY_FOR_LINE,
} from "./electricalTypes";
import { emptyCivilFoundation } from "./civilTypes";

function emptyGirder(): ProjectScopeState["girder"] {
  return {
    girderType: "mughal",
    mainSection: "",
    mainSectionCustom: "",
    wallThickness: "",
    material: "",
    steelGrade: "",
    span: "",
    columnCount: 0,
    columnSection: "",
    designLoadStatus: "pending_structural_design",
    designLoadNote: "",
    windLoadDesign: "pending",
    basePlateLength: "",
    basePlateWidth: "",
    basePlateThickness: "",
    anchorBoltDiameter: "",
    anchorBoltGrade: "",
    anchorBoltQty: 0,
    girderLengthFt: 0,
    weight: "",
    jobAmount: 0,
  };
}

function emptyElevated(): ProjectScopeState["elevated"] {
  return {
    height: "",
    columnSpacing: "",
    mainGirder: "",
    secondaryMember: "",
    steelSection: "",
    material: "",
    materialGrade: "",
    basePlate: "",
    anchorBolt: "",
    civilFoundation: "auto",
  };
}

function emptyFinish(): ProjectScopeState["finish"] {
  return { finish: "", surfaceArea: 0, coatSystem: "", coats: 0, rate: 0, amount: 0 };
}

function emptyEarthingBore(): ProjectScopeState["earthingBore"] {
  return {
    depth: "",
    copperRodSize: "",
    copperRodLength: "",
    chemicalCompound: "",
    inspectionChamber: "",
    earthResistanceTarget: "",
    testLink: "",
    earthBusbar: "",
    measuredResistance: "",
  };
}

type Flag = { include: IncludeChoice; state: InclusionState; qty?: number };

function applyFlags(lines: ScopeLine[], flags: Record<string, Flag>): ScopeLine[] {
  return lines.map((line) => {
    const flag = flags[line.id];
    if (!flag) return line;
    return setLineState(line, flag.include, flag.state, flag.qty ?? (flag.state === "included" ? 1 : 0));
  });
}

function yes(qty = 1): Flag {
  return { include: "yes", state: "included", qty };
}
function pending(): Flag {
  return { include: "conditional", state: "pending", qty: 0 };
}

const RESIDENTIAL_FLAGS: Record<string, Flag> = {
  hw_grouped: { include: "no", state: "excluded", qty: 0 },
  cm_grouped: { include: "no", state: "excluded", qty: 0 },
  doc_drawings: yes(),
  doc_asbuilt: yes(),
  doc_datasheets: yes(),
  doc_om: yes(),
  doc_comm_report: yes(),
  doc_handover: yes(),
};

const COMMERCIAL_FLAGS: Record<string, Flag> = {
  ...RESIDENTIAL_FLAGS,
  dc_pos: yes(0),
  dc_neg: yes(0),
  ac_inv_db: yes(0),
  ac_db_lt: pending(),
  earth_pv: yes(0),
  earth_inv: yes(0),
  cm_tray: pending(),
  ac_solar_db: pending(),
  ac_lt_mod: pending(),
  sv_electrical: pending(),
  sv_struct_design: pending(),
  sv_sld: pending(),
  lp_air: pending(),
  mon_dongle: pending(),
  doc_utility: yes(),
};

const INDUSTRIAL_FLAGS: Record<string, Flag> = {
  ...COMMERCIAL_FLAGS,
  ac_gen_panel: pending(),
  ac_lt_mod: pending(),
  cm_tray: pending(),
  mon_scada_gw: pending(),
  mon_energy_meter: pending(),
  sv_structural: pending(),
  sv_struct_design: pending(),
  sv_civil_design: pending(),
  sv_load: pending(),
  log_crane: pending(),
  cv_excavation: pending(),
  cv_rcc: pending(),
  ins_test: pending(),
  ins_comm: pending(),
};

export function flagsForPreset(preset: ScopePreset): Record<string, Flag> {
  if (preset === "industrial_standard") return INDUSTRIAL_FLAGS;
  if (preset === "commercial_standard") return COMMERCIAL_FLAGS;
  if (preset === "custom") return { ...RESIDENTIAL_FLAGS };
  return RESIDENTIAL_FLAGS;
}

export function classForPreset(preset: ScopePreset): ProjectClass {
  if (preset === "commercial_standard") return "commercial";
  if (preset === "industrial_standard") return "industrial";
  if (preset === "custom") return "custom";
  return "residential";
}

export function modeForPreset(preset: ScopePreset): ScopeMode {
  if (preset === "residential_standard") return "standard";
  return "advanced";
}

export function emptyStructuredDetails(): Pick<
  ProjectScopeState,
  | "dcCables"
  | "acCables"
  | "dcCombiner"
  | "acPanels"
  | "lightningDetail"
  | "cableTray"
  | "earthConductors"
  | "civilFoundation"
> {
  return {
    dcCables: {
      dc_pos: emptyDcCableRun("dc_pos", DC_POLARITY_FOR_LINE.dc_pos),
      dc_neg: emptyDcCableRun("dc_neg", DC_POLARITY_FOR_LINE.dc_neg),
      dc_string_combiner: emptyDcCableRun("dc_string_combiner"),
      dc_combiner_inverter: emptyDcCableRun("dc_combiner_inverter"),
      dc_string_inverter: emptyDcCableRun("dc_string_inverter"),
    },
    acCables: {
      ac_inv_db: emptyAcCableRun("ac_inv_db"),
      ac_db_lt: emptyAcCableRun("ac_db_lt"),
      ac_lt_grid: emptyAcCableRun("ac_lt_grid"),
      ac_backup: emptyAcCableRun("ac_backup"),
    },
    dcCombiner: emptyDcCombiner(),
    acPanels: {
      ac_solar_db: emptyAcPanel("ac_solar_db"),
      ac_gen_panel: emptyAcPanel("ac_gen_panel"),
      ac_sub_panel: emptyAcPanel("ac_sub_panel"),
      ac_lt_mod: emptyAcPanel("ac_lt_mod"),
    },
    lightningDetail: emptyLightningDetail(),
    cableTray: emptyCableTray(),
    earthConductors: {
      earth_pv: emptyEarthConductor("earth_pv"),
      earth_inv: emptyEarthConductor("earth_inv"),
      earth_acdb: emptyEarthConductor("earth_acdb"),
      earth_dcdb: emptyEarthConductor("earth_dcdb"),
      earth_lt: emptyEarthConductor("earth_lt"),
      earth_battery: emptyEarthConductor("earth_battery"),
      earth_pit_conn: emptyEarthConductor("earth_pit_conn"),
    },
    civilFoundation: emptyCivilFoundation(),
  };
}

export function buildPresetScope(preset: ScopePreset, _ctx?: Partial<ScopeContext>): ProjectScopeState {
  const lines = applyFlags(allDefaultLines(), flagsForPreset(preset));
  const projectClass = classForPreset(preset);
  return {
    projectClass,
    scopeMode: modeForPreset(preset),
    preset,
    lines,
    girder: emptyGirder(),
    elevated: emptyElevated(),
    finish: emptyFinish(),
    earthingBore: emptyEarthingBore(),
    lightningEnabled: false,
    craneEnabled: preset === "industrial_standard",
    rccFoundationRequired: false,
    scadaEnabled: preset === "industrial_standard",
    replaceGenericDc: false,
    replaceGenericAc: false,
    replaceGenericEarth: false,
    ...emptyStructuredDetails(),
  };
}

export function buildScopeForClass(projectClass: ProjectClass): ProjectScopeState {
  return buildPresetScope(presetIdForClass(projectClass));
}

export function emptyGirderDetails() {
  return emptyGirder();
}
export function emptyElevatedDetails() {
  return emptyElevated();
}
export function emptyFinishDetails() {
  return emptyFinish();
}
export function emptyEarthingBoreDetails() {
  return emptyEarthingBore();
}
