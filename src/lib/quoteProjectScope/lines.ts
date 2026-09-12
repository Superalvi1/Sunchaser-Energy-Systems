import { finiteNumber } from "../quoteCommercialMath";
import {
  DEFAULT_AC_CABLE_RATE,
  DEFAULT_DC_CABLE_RATE,
  DEFAULT_EARTH_WIRE_RATE,
} from "../autoSizer/presets";
import type { IncludeChoice, InclusionState, RateSource, ScopeLine, ScopePreset, ScopeSection, CostGroup, ScopeStatus } from "./types";

type Def = {
  id: string;
  section: ScopeSection;
  name: string;
  unit: string;
  costGroup: CostGroup;
  scopeStatus: ScopeStatus;
  groupedResidential?: boolean;
  replacesGenericId?: string;
  specification?: string;
  companyRate?: number;
};

export const COMPANY_DC_CABLE_RATE = DEFAULT_DC_CABLE_RATE;
export const COMPANY_AC_CABLE_RATE = DEFAULT_AC_CABLE_RATE;
export const COMPANY_EARTH_WIRE_RATE = DEFAULT_EARTH_WIRE_RATE;

const D: Def[] = [
  { id: "hw_grouped", section: "hardware", name: "Structure Hardware & Fasteners", unit: "Job", costGroup: "mounting_structure", scopeStatus: "optional", groupedResidential: true },
  { id: "hw_mid_clamps", section: "hardware", name: "Mid clamps", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_end_clamps", section: "hardware", name: "End clamps", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_rail_connectors", section: "hardware", name: "Rail / purlin connectors", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_lbrackets", section: "hardware", name: "L-brackets", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_ubolts", section: "hardware", name: "U-bolts", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_foundation_bolts", section: "hardware", name: "Foundation bolts", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_anchor_bolts", section: "hardware", name: "Anchor bolts", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_hex_bolts", section: "hardware", name: "Hex bolts", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_nuts", section: "hardware", name: "Nuts", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_flat_washers", section: "hardware", name: "Flat washers", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_spring_washers", section: "hardware", name: "Spring washers", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_sds", section: "hardware", name: "Self-drilling screws", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_expansion", section: "hardware", name: "Expansion bolts", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_cleats", section: "hardware", name: "Cleats", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_brackets", section: "hardware", name: "Brackets", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_connectors", section: "hardware", name: "Structural connectors", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_rubber", section: "hardware", name: "Rubber pads / isolators", unit: "Pcs", costGroup: "mounting_structure", scopeStatus: "optional" },
  { id: "hw_misc", section: "hardware", name: "Miscellaneous fastening accessories", unit: "Lot", costGroup: "mounting_structure", scopeStatus: "optional" },

  { id: "dc_pos", section: "dc_cabling", name: "DC Cable Positive Run", unit: "Meter", costGroup: "dc_bos", scopeStatus: "conditional", companyRate: COMPANY_DC_CABLE_RATE, replacesGenericId: "dc_cable_row", specification: "Conductor/size pending selection — default company rate 280 PKR/m is editable" },
  { id: "dc_neg", section: "dc_cabling", name: "DC Cable Negative Run", unit: "Meter", costGroup: "dc_bos", scopeStatus: "conditional", companyRate: COMPANY_DC_CABLE_RATE, replacesGenericId: "dc_cable_row" },
  { id: "dc_string_combiner", section: "dc_cabling", name: "String → Combiner DC Cable", unit: "Meter", costGroup: "dc_bos", scopeStatus: "optional", companyRate: COMPANY_DC_CABLE_RATE, replacesGenericId: "dc_cable_row" },
  { id: "dc_combiner_inverter", section: "dc_cabling", name: "Combiner → Inverter DC Cable", unit: "Meter", costGroup: "dc_bos", scopeStatus: "optional", companyRate: COMPANY_DC_CABLE_RATE, replacesGenericId: "dc_cable_row" },
  { id: "dc_string_inverter", section: "dc_cabling", name: "Direct String → Inverter DC Cable", unit: "Meter", costGroup: "dc_bos", scopeStatus: "optional", companyRate: COMPANY_DC_CABLE_RATE, replacesGenericId: "dc_cable_row" },

  { id: "ac_inv_db", section: "ac_cabling", name: "Inverter → AC DB Cable", unit: "Meter", costGroup: "ac_bos", scopeStatus: "conditional", companyRate: COMPANY_AC_CABLE_RATE, replacesGenericId: "ac_cable_row", specification: "Phase/core/size pending selection — default company rate 250 PKR/m is editable" },
  { id: "ac_db_lt", section: "ac_cabling", name: "AC DB → Main LT Panel Cable", unit: "Meter", costGroup: "ac_bos", scopeStatus: "optional", companyRate: COMPANY_AC_CABLE_RATE, replacesGenericId: "ac_cable_row" },
  { id: "ac_lt_grid", section: "ac_cabling", name: "LT Panel → Grid / Utility Cable", unit: "Meter", costGroup: "ac_bos", scopeStatus: "optional", companyRate: COMPANY_AC_CABLE_RATE, replacesGenericId: "ac_cable_row" },
  { id: "ac_backup", section: "ac_cabling", name: "Backup Output Cable", unit: "Meter", costGroup: "ac_bos", scopeStatus: "conditional", companyRate: COMPANY_AC_CABLE_RATE },

  { id: "earth_pv", section: "earthing", name: "PV Structure Earth", unit: "Meter", costGroup: "earthing", scopeStatus: "conditional", companyRate: COMPANY_EARTH_WIRE_RATE, replacesGenericId: "earth_wire_row" },
  { id: "earth_inv", section: "earthing", name: "Inverter Earth", unit: "Meter", costGroup: "earthing", scopeStatus: "conditional", companyRate: COMPANY_EARTH_WIRE_RATE, replacesGenericId: "earth_wire_row" },
  { id: "earth_acdb", section: "earthing", name: "AC DB Earth", unit: "Meter", costGroup: "earthing", scopeStatus: "optional", companyRate: COMPANY_EARTH_WIRE_RATE },
  { id: "earth_dcdb", section: "earthing", name: "DC DB Earth", unit: "Meter", costGroup: "earthing", scopeStatus: "optional", companyRate: COMPANY_EARTH_WIRE_RATE },
  { id: "earth_lt", section: "earthing", name: "Main LT Panel Earth", unit: "Meter", costGroup: "earthing", scopeStatus: "optional", companyRate: COMPANY_EARTH_WIRE_RATE },
  { id: "earth_battery", section: "earthing", name: "Battery Rack Earth", unit: "Meter", costGroup: "earthing", scopeStatus: "conditional", companyRate: COMPANY_EARTH_WIRE_RATE },
  { id: "earth_lp_down", section: "earthing", name: "Lightning Protection Down Conductor", unit: "Meter", costGroup: "lightning", scopeStatus: "conditional" },
  { id: "earth_pit_conn", section: "earthing", name: "Earth Pit / Earth Bore Connections", unit: "Meter", costGroup: "earthing", scopeStatus: "optional", companyRate: COMPANY_EARTH_WIRE_RATE },

  { id: "batt_rack", section: "battery_accessories", name: "Battery rack / cabinet", unit: "Pcs", costGroup: "battery", scopeStatus: "conditional" },
  { id: "batt_stand", section: "battery_accessories", name: "Battery stand", unit: "Pcs", costGroup: "battery", scopeStatus: "conditional" },
  { id: "batt_breaker", section: "battery_accessories", name: "Battery breaker", unit: "Pcs", costGroup: "battery", scopeStatus: "conditional" },
  { id: "batt_fuse", section: "battery_accessories", name: "Battery fuse", unit: "Pcs", costGroup: "battery", scopeStatus: "conditional" },
  { id: "batt_isolator", section: "battery_accessories", name: "Battery isolator", unit: "Pcs", costGroup: "battery", scopeStatus: "conditional" },
  { id: "batt_dc_pos", section: "battery_accessories", name: "Battery DC cable positive", unit: "Meter", costGroup: "battery", scopeStatus: "conditional" },
  { id: "batt_dc_neg", section: "battery_accessories", name: "Battery DC cable negative", unit: "Meter", costGroup: "battery", scopeStatus: "conditional" },
  { id: "batt_lugs", section: "battery_accessories", name: "Copper lugs", unit: "Pcs", costGroup: "battery", scopeStatus: "conditional" },
  { id: "batt_comms", section: "battery_accessories", name: "Communication cable", unit: "Meter", costGroup: "battery", scopeStatus: "conditional" },
  { id: "batt_bms", section: "battery_accessories", name: "BMS cable", unit: "Meter", costGroup: "battery", scopeStatus: "conditional" },
  { id: "batt_parallel", section: "battery_accessories", name: "Parallel battery interconnect", unit: "Pcs", costGroup: "battery", scopeStatus: "optional" },
  { id: "batt_earth", section: "battery_accessories", name: "Battery earthing", unit: "Lot", costGroup: "battery", scopeStatus: "conditional" },

  { id: "dc_combiner", section: "dc_protection", name: "DC Combiner Box / DC DB", unit: "Pcs", costGroup: "protection", scopeStatus: "optional" },

  { id: "ac_solar_db", section: "ac_protection", name: "Solar AC DB", unit: "Pcs", costGroup: "protection", scopeStatus: "optional" },
  { id: "ac_gen_panel", section: "ac_protection", name: "Main Generation Panel", unit: "Pcs", costGroup: "protection", scopeStatus: "optional" },
  { id: "ac_sub_panel", section: "ac_protection", name: "Sub Panel", unit: "Pcs", costGroup: "protection", scopeStatus: "optional" },
  { id: "ac_lt_mod", section: "ac_protection", name: "LT Panel modification", unit: "Job", costGroup: "protection", scopeStatus: "optional" },

  { id: "lp_air", section: "lightning", name: "Air Terminal / Lightning Arrester", unit: "Pcs", costGroup: "lightning", scopeStatus: "conditional" },
  { id: "lp_mast", section: "lightning", name: "Lightning mast / support", unit: "Pcs", costGroup: "lightning", scopeStatus: "conditional" },
  { id: "lp_down", section: "lightning", name: "Down conductor", unit: "Meter", costGroup: "lightning", scopeStatus: "conditional" },
  { id: "lp_test", section: "lightning", name: "Test joint", unit: "Pcs", costGroup: "lightning", scopeStatus: "conditional" },
  { id: "lp_earth", section: "lightning", name: "Lightning earth pit / earth arrangement", unit: "Pcs", costGroup: "lightning", scopeStatus: "conditional" },
  { id: "lp_bonding", section: "lightning", name: "Bonding accessories", unit: "Lot", costGroup: "lightning", scopeStatus: "conditional" },

  { id: "cm_tray", section: "cable_management", name: "GI perforated cable tray", unit: "Meter", costGroup: "dc_bos", scopeStatus: "optional" },
  { id: "cm_tray_bends", section: "cable_management", name: "Tray bends / tees / reducers / covers", unit: "Lot", costGroup: "dc_bos", scopeStatus: "optional" },
  { id: "cm_supports", section: "cable_management", name: "Tray supports / hangers / clamps", unit: "Lot", costGroup: "dc_bos", scopeStatus: "optional" },
  { id: "cm_conduit", section: "cable_management", name: "Conduit (PVC / HDPE / GI / flexible)", unit: "Meter", costGroup: "dc_bos", scopeStatus: "optional" },
  { id: "cm_ties", section: "cable_management", name: "Cable ties / saddles / clips / markers", unit: "Lot", costGroup: "dc_bos", scopeStatus: "optional" },
  { id: "cm_glands", section: "cable_management", name: "Cable glands / ferrules / lugs / heat shrink", unit: "Lot", costGroup: "dc_bos", scopeStatus: "optional" },
  { id: "cm_jb", section: "cable_management", name: "Junction boxes / termination kits", unit: "Lot", costGroup: "dc_bos", scopeStatus: "optional" },
  { id: "cm_grouped", section: "cable_management", name: "Cable management & accessories", unit: "Job", costGroup: "dc_bos", scopeStatus: "optional", groupedResidential: true },

  { id: "mon_dongle", section: "monitoring", name: "Inverter monitoring dongle", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_wifi", section: "monitoring", name: "Wi-Fi logger", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_lan", section: "monitoring", name: "LAN logger", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_4g", section: "monitoring", name: "4G logger", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_datalogger", section: "monitoring", name: "Data logger", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_energy_meter", section: "monitoring", name: "Energy / smart meter", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_cts", section: "monitoring", name: "CTs", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_zero_export", section: "monitoring", name: "Zero Export Controller", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_plant", section: "monitoring", name: "Plant Controller", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_scada_gw", section: "monitoring", name: "SCADA / Modbus Gateway", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_scada_ws", section: "monitoring", name: "SCADA workstation", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_cloud", section: "monitoring", name: "Cloud monitoring license", unit: "Job", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_weather", section: "monitoring", name: "Weather station / sensors", unit: "Lot", costGroup: "monitoring", scopeStatus: "optional" },
  { id: "mon_router", section: "monitoring", name: "Internet router / SIM", unit: "Pcs", costGroup: "monitoring", scopeStatus: "optional" },

  { id: "sv_electrical", section: "survey", name: "Electrical Site Survey", unit: "Job", costGroup: "engineering", scopeStatus: "conditional" },
  { id: "sv_roof", section: "survey", name: "Roof Survey", unit: "Job", costGroup: "engineering", scopeStatus: "conditional" },
  { id: "sv_structural", section: "survey", name: "Structural Survey", unit: "Job", costGroup: "engineering", scopeStatus: "conditional" },
  { id: "sv_topo", section: "survey", name: "Topographical Survey", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_shading", section: "survey", name: "Shading Analysis", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_drone", section: "survey", name: "Drone Survey", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_load", section: "survey", name: "Load Study", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_transformer", section: "survey", name: "Transformer Study", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_sc", section: "survey", name: "Short Circuit Study", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_vd", section: "survey", name: "Voltage Drop Study", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_protection", section: "survey", name: "Protection Coordination", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_struct_design", section: "survey", name: "Structural Design", unit: "Job", costGroup: "engineering", scopeStatus: "conditional" },
  { id: "sv_pv_layout", section: "survey", name: "PV Layout Design", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_sld", section: "survey", name: "Single Line Diagram", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_cable_route", section: "survey", name: "Cable Routing Design", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_earth_design", section: "survey", name: "Earthing Design", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_lp_design", section: "survey", name: "Lightning Protection Design", unit: "Job", costGroup: "engineering", scopeStatus: "optional" },
  { id: "sv_civil_design", section: "survey", name: "Civil Foundation Design", unit: "Job", costGroup: "engineering", scopeStatus: "conditional" },

  { id: "log_material", section: "logistics", name: "Material Transportation", unit: "Job", costGroup: "transport", scopeStatus: "optional" },
  { id: "log_panel", section: "logistics", name: "Panel Transport", unit: "Trip", costGroup: "transport", scopeStatus: "optional" },
  { id: "log_battery", section: "logistics", name: "Battery Transport", unit: "Trip", costGroup: "transport", scopeStatus: "conditional" },
  { id: "log_steel", section: "logistics", name: "Steel / Girder Transport", unit: "Trip", costGroup: "transport", scopeStatus: "conditional" },
  { id: "log_manual", section: "logistics", name: "Manual Lifting", unit: "Job", costGroup: "transport", scopeStatus: "optional" },
  { id: "log_crane", section: "logistics", name: "Crane", unit: "Day", costGroup: "transport", scopeStatus: "conditional" },
  { id: "log_hydra", section: "logistics", name: "Hydra crane", unit: "Day", costGroup: "transport", scopeStatus: "optional" },
  { id: "log_forklift", section: "logistics", name: "Forklift", unit: "Day", costGroup: "transport", scopeStatus: "optional" },
  { id: "log_boom", section: "logistics", name: "Boom lifter", unit: "Day", costGroup: "transport", scopeStatus: "optional" },
  { id: "log_scissor", section: "logistics", name: "Scissor lift", unit: "Day", costGroup: "transport", scopeStatus: "optional" },
  { id: "log_trailer", section: "logistics", name: "Trailer / special vehicle", unit: "Trip", costGroup: "transport", scopeStatus: "optional" },
  { id: "log_route", section: "logistics", name: "Route survey", unit: "Job", costGroup: "transport", scopeStatus: "optional" },
  { id: "log_labour", section: "logistics", name: "Loading / unloading labor", unit: "Job", costGroup: "transport", scopeStatus: "optional" },

  { id: "ins_pv", section: "installation", name: "PV installation labor", unit: "Job", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_fab", section: "installation", name: "Structure fabrication labor", unit: "Job", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_erect", section: "installation", name: "Structure erection labor", unit: "Job", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_elec", section: "installation", name: "Electrical installation", unit: "Job", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_pull", section: "installation", name: "Cable pulling", unit: "Job", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_db", section: "installation", name: "DB/panel installation", unit: "Job", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_battery", section: "installation", name: "Battery installation", unit: "Job", costGroup: "installation", scopeStatus: "conditional" },
  { id: "ins_test", section: "installation", name: "Testing", unit: "Job", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_comm", section: "installation", name: "Commissioning / configuration / grid sync", unit: "Job", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_monitor", section: "installation", name: "Monitoring setup", unit: "Job", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_train", section: "installation", name: "Client training", unit: "Job", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_tools", section: "installation", name: "Tools & consumables", unit: "Lot", costGroup: "installation", scopeStatus: "optional" },
  { id: "ins_scaffold", section: "installation", name: "Scaffolding", unit: "Job", costGroup: "installation", scopeStatus: "optional" },

  { id: "cv_excavation", section: "civil", name: "Excavation", unit: "Cft", costGroup: "civil", scopeStatus: "conditional" },
  { id: "cv_pcc", section: "civil", name: "PCC", unit: "Cft", costGroup: "civil", scopeStatus: "conditional" },
  { id: "cv_rcc", section: "civil", name: "RCC", unit: "Cft", costGroup: "civil", scopeStatus: "conditional" },
  { id: "cv_rebar", section: "civil", name: "Rebar", unit: "Kg", costGroup: "civil", scopeStatus: "conditional" },
  { id: "cv_formwork", section: "civil", name: "Formwork", unit: "Sft", costGroup: "civil", scopeStatus: "conditional" },
  { id: "cv_pads", section: "civil", name: "Foundation pads", unit: "Pcs", costGroup: "civil", scopeStatus: "conditional" },
  { id: "cv_anchors", section: "civil", name: "Anchor bolts / templates", unit: "Set", costGroup: "civil", scopeStatus: "conditional" },
  { id: "cv_grout", section: "civil", name: "Grouting", unit: "Job", costGroup: "civil", scopeStatus: "conditional" },
  { id: "cv_cure", section: "civil", name: "Curing", unit: "Job", costGroup: "civil", scopeStatus: "conditional" },
  { id: "cv_backfill", section: "civil", name: "Backfilling", unit: "Cft", costGroup: "civil", scopeStatus: "conditional" },
  { id: "cv_seal", section: "civil", name: "Roof penetration sealing / waterproofing", unit: "Job", costGroup: "civil", scopeStatus: "optional" },
  { id: "cv_plinth", section: "civil", name: "Equipment / battery / inverter plinth", unit: "Pcs", costGroup: "civil", scopeStatus: "optional" },

  { id: "doc_drawings", section: "documentation", name: "Proposal / PV layout / SLD / string / cable / DB schedules", unit: "Set", costGroup: "documentation", scopeStatus: "mandatory" },
  { id: "doc_asbuilt", section: "documentation", name: "As-Built Drawings", unit: "Set", costGroup: "documentation", scopeStatus: "mandatory" },
  { id: "doc_datasheets", section: "documentation", name: "Equipment Datasheets / Warranty Certificates / Serial Register", unit: "Set", costGroup: "documentation", scopeStatus: "mandatory" },
  { id: "doc_om", section: "documentation", name: "O&M Manual", unit: "Set", costGroup: "documentation", scopeStatus: "mandatory" },
  { id: "doc_comm_report", section: "documentation", name: "Commissioning & test reports", unit: "Set", costGroup: "documentation", scopeStatus: "mandatory" },
  { id: "doc_handover", section: "documentation", name: "Handover Certificate / client training pack", unit: "Set", costGroup: "documentation", scopeStatus: "mandatory" },
  { id: "doc_utility", section: "documentation", name: "Utility / Net Metering Documents", unit: "Set", costGroup: "documentation", scopeStatus: "conditional" },

  { id: "nm_docs", section: "net_metering", name: "Net metering application documents / drawings / case processing", unit: "Job", costGroup: "net_metering", scopeStatus: "conditional" },
  { id: "nm_demand", section: "net_metering", name: "Demand notice / green meter process", unit: "Job", costGroup: "net_metering", scopeStatus: "conditional" },
  { id: "nm_grid_study", section: "net_metering", name: "Grid / protection study", unit: "Job", costGroup: "net_metering", scopeStatus: "optional" },
  { id: "nm_ct_meter", section: "net_metering", name: "CT / meter changes", unit: "Job", costGroup: "net_metering", scopeStatus: "optional" },
  { id: "nm_inspect", section: "net_metering", name: "Utility inspection / testing / energization", unit: "Job", costGroup: "net_metering", scopeStatus: "optional" },
  { id: "nm_zero_export", section: "net_metering", name: "Zero Export alternative", unit: "Job", costGroup: "net_metering", scopeStatus: "optional" },
];

export const SCOPE_LINE_DEFS = D;

export const BATTERY_ACCESSORY_IDS = D.filter((d) => d.section === "battery_accessories").map((d) => d.id);
export const LIGHTNING_PATH_IDS = ["lp_air", "lp_down", "lp_test", "lp_earth"] as const;
export const CIVIL_FOUNDATION_IDS = ["cv_excavation", "cv_pcc", "cv_rcc", "cv_rebar", "cv_formwork", "cv_pads", "cv_anchors", "cv_cure"] as const;
export const DETAILED_DC_IDS = ["dc_pos", "dc_neg", "dc_string_combiner", "dc_combiner_inverter", "dc_string_inverter"] as const;
export const DETAILED_AC_IDS = ["ac_inv_db", "ac_db_lt", "ac_lt_grid", "ac_backup"] as const;
export const DETAILED_EARTH_IDS = ["earth_pv", "earth_inv", "earth_acdb", "earth_dcdb", "earth_lt", "earth_battery", "earth_pit_conn"] as const;

function makeLine(
  def: Def,
  include: IncludeChoice,
  inclusionState: InclusionState,
  qty = 0
): ScopeLine {
  const hasCompany = typeof def.companyRate === "number" && def.companyRate > 0;
  const rate = include === "yes" && hasCompany ? def.companyRate! : hasCompany ? def.companyRate! : 0;
  const rateSource: RateSource = hasCompany ? "company_preset" : "none";
  return {
    id: def.id,
    section: def.section,
    name: def.name,
    specification: def.specification || "",
    include,
    inclusionState,
    scopeStatus: def.scopeStatus,
    qty,
    unit: def.unit,
    rate,
    notes: "",
    catalogProductId: "",
    costGroup: def.costGroup,
    groupedResidential: Boolean(def.groupedResidential),
    rateSource,
    replacesGenericId: def.replacesGenericId,
  };
}

export function allDefaultLines(): ScopeLine[] {
  return D.map((def) => makeLine(def, "no", "excluded", 0));
}

export function setLineState(
  line: ScopeLine,
  include: IncludeChoice,
  inclusionState: InclusionState,
  qty?: number
): ScopeLine {
  return {
    ...line,
    include,
    inclusionState,
    qty: qty == null ? line.qty : finiteNumber(qty, 0),
  };
}

export function findDef(id: string): Def | undefined {
  return D.find((d) => d.id === id);
}

export function presetIdForClass(projectClass: "residential" | "commercial" | "industrial" | "custom"): ScopePreset {
  if (projectClass === "commercial") return "commercial_standard";
  if (projectClass === "industrial") return "industrial_standard";
  if (projectClass === "custom") return "custom";
  return "residential_standard";
}
