import React from "react";
import type {
  AcCableRunDetail,
  AcPanelDetail,
  CableTrayDetail,
  CivilFoundationDetail,
  DcCableRunDetail,
  DcCombinerDetail,
  EarthingConductorDetail,
  LightningDetail,
} from "../../lib/quoteProjectScope";
import { civilFoundationDisplay } from "../../lib/quoteProjectScope";
import { NumberField, SelectField, TextField } from "./ScopeLineTable";

const DC_CONDUCTOR = [
  { value: "", label: "Select" },
  { value: "copper", label: "Copper" },
  { value: "tinned_copper", label: "Tinned Copper" },
  { value: "other", label: "Other" },
];
const DC_AREA = [
  { value: "", label: "Select" },
  { value: "4", label: "4 mm²" },
  { value: "6", label: "6 mm²" },
  { value: "10", label: "10 mm²" },
  { value: "16", label: "16 mm²" },
  { value: "custom", label: "Custom" },
];
const DC_VOLT = [
  { value: "", label: "Select" },
  { value: "1000v", label: "1000 V DC" },
  { value: "1500v", label: "1500 V DC" },
  { value: "custom", label: "Custom" },
];
const AC_PHASE = [
  { value: "", label: "Select" },
  { value: "single", label: "Single Phase" },
  { value: "three", label: "Three Phase" },
];
const AC_CONDUCTOR = [
  { value: "", label: "Select" },
  { value: "copper", label: "Copper" },
  { value: "aluminium", label: "Aluminium" },
];
const AC_CORES = [
  { value: "", label: "Select" },
  { value: "2c", label: "2C" },
  { value: "3c", label: "3C" },
  { value: "4c", label: "4C" },
  { value: "4c_e", label: "4C+E" },
  { value: "custom", label: "Custom" },
];
const AC_AREA = [
  { value: "", label: "Select" },
  ...["6", "10", "16", "25", "35", "50", "70", "95", "120", "150", "185", "240"].map((n) => ({ value: n, label: `${n} mm²` })),
  { value: "custom", label: "Custom" },
];
const AC_CONST = [
  { value: "", label: "Select" },
  { value: "pvc", label: "PVC" },
  { value: "xlpe", label: "XLPE" },
  { value: "xlpe_swa_pvc", label: "XLPE/SWA/PVC" },
  { value: "flexible", label: "Flexible" },
  { value: "custom", label: "Custom" },
];
const AC_VOLT = [
  { value: "", label: "Select" },
  { value: "0.6_1kv", label: "0.6/1 kV" },
  { value: "custom", label: "Custom" },
];
const SPD = [
  { value: "", label: "Select" },
  { value: "type_ii", label: "Type II" },
  { value: "type_i_ii", label: "Type I+II" },
  { value: "none", label: "None" },
];
const IP = [
  { value: "", label: "Select" },
  { value: "ip40", label: "IP40" },
  { value: "ip54", label: "IP54" },
  { value: "ip65", label: "IP65" },
  { value: "ip66", label: "IP66" },
  { value: "custom", label: "Custom" },
];
const YNP = [
  { value: "", label: "Select" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "pending", label: "Pending" },
];
const EARTH_TYPE = [
  { value: "", label: "Select" },
  { value: "bare_copper", label: "Bare Copper" },
  { value: "insulated_copper", label: "Insulated Copper" },
  { value: "gi_strip", label: "GI Strip" },
  { value: "copper_strip", label: "Copper Strip" },
  { value: "custom", label: "Custom" },
];

export function DcCableDetailEditor({
  title,
  detail,
  onChange,
}: {
  title: string;
  detail: DcCableRunDetail;
  onChange: (next: DcCableRunDetail) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-800/80 p-3 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TextField label="Brand" value={detail.brand} onChange={(v) => onChange({ ...detail, brand: v })} />
        <TextField label="Cable type" value={detail.cableType} onChange={(v) => onChange({ ...detail, cableType: v })} placeholder="PV1-F" />
        <SelectField label="Conductor" value={detail.conductor} options={DC_CONDUCTOR} onChange={(v) => onChange({ ...detail, conductor: v as DcCableRunDetail["conductor"] })} />
        <SelectField label="Area mm²" value={detail.areaMm2} options={DC_AREA} onChange={(v) => onChange({ ...detail, areaMm2: v as DcCableRunDetail["areaMm2"] })} />
        {detail.areaMm2 === "custom" && <TextField label="Custom area" value={detail.customArea} onChange={(v) => onChange({ ...detail, customArea: v })} />}
        <SelectField label="Voltage rating" value={detail.voltageRating} options={DC_VOLT} onChange={(v) => onChange({ ...detail, voltageRating: v as DcCableRunDetail["voltageRating"] })} />
        {detail.voltageRating === "custom" && <TextField label="Custom voltage" value={detail.customVoltage} onChange={(v) => onChange({ ...detail, customVoltage: v })} />}
        <NumberField label="Length m" value={detail.lengthM} onChange={(v) => onChange({ ...detail, lengthM: v })} />
        <NumberField label="Run count" value={detail.runCount} onChange={(v) => onChange({ ...detail, runCount: v })} />
        <SelectField
          label="Polarity"
          value={detail.polarity}
          options={[
            { value: "", label: "Select" },
            { value: "positive", label: "Positive" },
            { value: "negative", label: "Negative" },
            { value: "both", label: "Both" },
          ]}
          onChange={(v) => onChange({ ...detail, polarity: v as DcCableRunDetail["polarity"] })}
        />
        <NumberField label="Rate / m" value={detail.ratePerMeter} onChange={(v) => onChange({ ...detail, ratePerMeter: v })} />
      </div>
    </div>
  );
}

export function AcCableDetailEditor({
  title,
  detail,
  onChange,
}: {
  title: string;
  detail: AcCableRunDetail;
  onChange: (next: AcCableRunDetail) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-800/80 p-3 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SelectField label="Phase" value={detail.phase} options={AC_PHASE} onChange={(v) => onChange({ ...detail, phase: v as AcCableRunDetail["phase"] })} />
        <SelectField label="Conductor" value={detail.conductor} options={AC_CONDUCTOR} onChange={(v) => onChange({ ...detail, conductor: v as AcCableRunDetail["conductor"] })} />
        <SelectField label="Cores" value={detail.cores} options={AC_CORES} onChange={(v) => onChange({ ...detail, cores: v as AcCableRunDetail["cores"] })} />
        {detail.cores === "custom" && <TextField label="Custom cores" value={detail.customCores} onChange={(v) => onChange({ ...detail, customCores: v })} />}
        <SelectField label="Area mm²" value={detail.areaMm2} options={AC_AREA} onChange={(v) => onChange({ ...detail, areaMm2: v as AcCableRunDetail["areaMm2"] })} />
        {detail.areaMm2 === "custom" && <TextField label="Custom area" value={detail.customArea} onChange={(v) => onChange({ ...detail, customArea: v })} />}
        <SelectField label="Construction" value={detail.construction} options={AC_CONST} onChange={(v) => onChange({ ...detail, construction: v as AcCableRunDetail["construction"] })} />
        <SelectField label="Voltage" value={detail.voltageRating} options={AC_VOLT} onChange={(v) => onChange({ ...detail, voltageRating: v as AcCableRunDetail["voltageRating"] })} />
        <NumberField label="Length m" value={detail.lengthM} onChange={(v) => onChange({ ...detail, lengthM: v })} />
        <NumberField label="Runs" value={detail.runs} onChange={(v) => onChange({ ...detail, runs: v })} />
        <NumberField label="Rate / m" value={detail.ratePerMeter} onChange={(v) => onChange({ ...detail, ratePerMeter: v })} />
      </div>
    </div>
  );
}

export function DcCombinerEditor({ detail, onChange }: { detail: DcCombinerDetail; onChange: (next: DcCombinerDetail) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <NumberField label="Number of strings" value={detail.numberOfStrings} onChange={(v) => onChange({ ...detail, numberOfStrings: v })} />
      <NumberField label="Inputs" value={detail.inputs} onChange={(v) => onChange({ ...detail, inputs: v })} />
      <NumberField label="Outputs" value={detail.outputs} onChange={(v) => onChange({ ...detail, outputs: v })} />
      <TextField label="String fuse A" value={detail.stringFuseCurrentA} onChange={(v) => onChange({ ...detail, stringFuseCurrentA: v })} />
      <TextField label="String fuse V" value={detail.stringFuseVoltageV} onChange={(v) => onChange({ ...detail, stringFuseVoltageV: v })} />
      <TextField label="DC breaker type" value={detail.dcBreakerType} onChange={(v) => onChange({ ...detail, dcBreakerType: v })} />
      <TextField label="DC breaker A" value={detail.dcBreakerCurrentA} onChange={(v) => onChange({ ...detail, dcBreakerCurrentA: v })} />
      <TextField label="DC breaker V" value={detail.dcBreakerVoltageV} onChange={(v) => onChange({ ...detail, dcBreakerVoltageV: v })} />
      <SelectField label="DC isolator" value={detail.dcIsolator} options={YNP} onChange={(v) => onChange({ ...detail, dcIsolator: v as DcCombinerDetail["dcIsolator"] })} />
      <SelectField label="SPD type" value={detail.spdType} options={SPD} onChange={(v) => onChange({ ...detail, spdType: v as DcCombinerDetail["spdType"] })} />
      <TextField label="SPD voltage" value={detail.spdVoltageRating} onChange={(v) => onChange({ ...detail, spdVoltageRating: v })} />
      <SelectField
        label="Monitoring"
        value={detail.monitoring}
        options={[
          { value: "", label: "Select" },
          { value: "none", label: "None" },
          { value: "string", label: "String monitoring" },
          { value: "smart", label: "Smart combiner" },
        ]}
        onChange={(v) => onChange({ ...detail, monitoring: v as DcCombinerDetail["monitoring"] })}
      />
      <SelectField label="Enclosure IP" value={detail.enclosureIp} options={IP} onChange={(v) => onChange({ ...detail, enclosureIp: v as DcCombinerDetail["enclosureIp"] })} />
      <NumberField label="Qty" value={detail.qty} onChange={(v) => onChange({ ...detail, qty: v })} />
      <NumberField label="Unit price" value={detail.unitPrice} onChange={(v) => onChange({ ...detail, unitPrice: v })} />
    </div>
  );
}

export function AcPanelEditor({ detail, onChange }: { detail: AcPanelDetail; onChange: (next: AcPanelDetail) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <TextField label="Panel type" value={detail.panelType} onChange={(v) => onChange({ ...detail, panelType: v })} />
      <TextField label="Incoming breaker" value={detail.incomingBreakerType} onChange={(v) => onChange({ ...detail, incomingBreakerType: v })} />
      <TextField label="Incoming poles" value={detail.incomingPoles} onChange={(v) => onChange({ ...detail, incomingPoles: v })} />
      <TextField label="Incoming A" value={detail.incomingCurrentA} onChange={(v) => onChange({ ...detail, incomingCurrentA: v })} />
      <TextField label="Incoming kA" value={detail.incomingBreakingCapacityKa} onChange={(v) => onChange({ ...detail, incomingBreakingCapacityKa: v })} />
      <TextField label="Outgoing breaker" value={detail.outgoingBreakerType} onChange={(v) => onChange({ ...detail, outgoingBreakerType: v })} />
      <TextField label="Outgoing poles" value={detail.outgoingPoles} onChange={(v) => onChange({ ...detail, outgoingPoles: v })} />
      <TextField label="Outgoing A" value={detail.outgoingCurrentA} onChange={(v) => onChange({ ...detail, outgoingCurrentA: v })} />
      <TextField label="Outgoing kA" value={detail.outgoingBreakingCapacityKa} onChange={(v) => onChange({ ...detail, outgoingBreakingCapacityKa: v })} />
      <SelectField label="AC SPD" value={detail.acSpd} options={SPD} onChange={(v) => onChange({ ...detail, acSpd: v as AcPanelDetail["acSpd"] })} />
      <TextField label="RCCB / RCBO" value={detail.rccbRcboType} onChange={(v) => onChange({ ...detail, rccbRcboType: v })} />
      <TextField label="Residual mA" value={detail.residualCurrentMa} onChange={(v) => onChange({ ...detail, residualCurrentMa: v })} />
      <SelectField label="Voltage protection relay" value={detail.voltageProtectionRelay} options={YNP} onChange={(v) => onChange({ ...detail, voltageProtectionRelay: v as AcPanelDetail["voltageProtectionRelay"] })} />
      <SelectField label="Phase failure relay" value={detail.phaseFailureRelay} options={YNP} onChange={(v) => onChange({ ...detail, phaseFailureRelay: v as AcPanelDetail["phaseFailureRelay"] })} />
      <SelectField label="Phase sequence relay" value={detail.phaseSequenceRelay} options={YNP} onChange={(v) => onChange({ ...detail, phaseSequenceRelay: v as AcPanelDetail["phaseSequenceRelay"] })} />
      <TextField label="Contactor" value={detail.contactor} onChange={(v) => onChange({ ...detail, contactor: v })} />
      <TextField label="Isolator" value={detail.isolator} onChange={(v) => onChange({ ...detail, isolator: v })} />
      <TextField label="Energy meter" value={detail.energyMeter} onChange={(v) => onChange({ ...detail, energyMeter: v })} />
      <TextField label="CT ratio" value={detail.ctRatio} onChange={(v) => onChange({ ...detail, ctRatio: v })} />
      <SelectField label="Enclosure IP" value={detail.enclosureIp} options={IP} onChange={(v) => onChange({ ...detail, enclosureIp: v as AcPanelDetail["enclosureIp"] })} />
      {detail.enclosureIp === "custom" && <TextField label="Custom IP" value={detail.customEnclosureIp} onChange={(v) => onChange({ ...detail, customEnclosureIp: v })} />}
      <SelectField
        label="Busbar"
        value={detail.busbarMaterial}
        options={[
          { value: "", label: "Select" },
          { value: "copper", label: "Copper" },
          { value: "aluminium", label: "Aluminium" },
        ]}
        onChange={(v) => onChange({ ...detail, busbarMaterial: v as AcPanelDetail["busbarMaterial"] })}
      />
      <TextField label="Busbar A" value={detail.busbarRatingA} onChange={(v) => onChange({ ...detail, busbarRatingA: v })} />
      <SelectField label="Neutral bus" value={detail.neutralBus} options={YNP} onChange={(v) => onChange({ ...detail, neutralBus: v as AcPanelDetail["neutralBus"] })} />
      <SelectField label="Earth bus" value={detail.earthBus} options={YNP} onChange={(v) => onChange({ ...detail, earthBus: v as AcPanelDetail["earthBus"] })} />
      <NumberField label="Qty" value={detail.qty} onChange={(v) => onChange({ ...detail, qty: v })} />
      <NumberField label="Panel cost" value={detail.panelCost} onChange={(v) => onChange({ ...detail, panelCost: v })} />
    </div>
  );
}

export function LightningDetailEditor({ detail, onChange }: { detail: LightningDetail; onChange: (next: LightningDetail) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <TextField label="Air terminal type" value={detail.airTerminalType} onChange={(v) => onChange({ ...detail, airTerminalType: v })} />
      <NumberField label="Air terminal qty" value={detail.airTerminalQty} onChange={(v) => onChange({ ...detail, airTerminalQty: v })} />
      <TextField label="Mast height" value={detail.mastHeight} onChange={(v) => onChange({ ...detail, mastHeight: v })} />
      <NumberField label="Mast qty" value={detail.mastQty} onChange={(v) => onChange({ ...detail, mastQty: v })} />
      <TextField label="Down conductor type" value={detail.downConductorType} onChange={(v) => onChange({ ...detail, downConductorType: v })} />
      <TextField label="Down conductor area" value={detail.downConductorArea} onChange={(v) => onChange({ ...detail, downConductorArea: v })} />
      <NumberField label="Down conductor length" value={detail.downConductorLength} onChange={(v) => onChange({ ...detail, downConductorLength: v })} />
      <NumberField label="Test joint qty" value={detail.testJointQty} onChange={(v) => onChange({ ...detail, testJointQty: v })} />
      <NumberField label="Earth pit qty" value={detail.earthPitQty} onChange={(v) => onChange({ ...detail, earthPitQty: v })} />
      <TextField label="Bonding accessories" value={detail.bondingAccessories} onChange={(v) => onChange({ ...detail, bondingAccessories: v })} />
      <SelectField label="SPD coordination" value={detail.spdCoordinationRequired} options={YNP} onChange={(v) => onChange({ ...detail, spdCoordinationRequired: v as LightningDetail["spdCoordinationRequired"] })} />
    </div>
  );
}

export function CableTrayEditor({ detail, onChange }: { detail: CableTrayDetail; onChange: (next: CableTrayDetail) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <TextField label="Tray type" value={detail.trayType} onChange={(v) => onChange({ ...detail, trayType: v })} />
      <TextField label="Width mm" value={detail.widthMm} onChange={(v) => onChange({ ...detail, widthMm: v })} />
      <TextField label="Height mm" value={detail.heightMm} onChange={(v) => onChange({ ...detail, heightMm: v })} />
      <TextField label="Thickness / gauge" value={detail.thicknessMm} onChange={(v) => onChange({ ...detail, thicknessMm: v })} />
      <NumberField label="Length m" value={detail.lengthM} onChange={(v) => onChange({ ...detail, lengthM: v })} />
      <SelectField label="Cover required" value={detail.coverRequired} options={YNP} onChange={(v) => onChange({ ...detail, coverRequired: v as CableTrayDetail["coverRequired"] })} />
      <NumberField label="Bends" value={detail.bendQty} onChange={(v) => onChange({ ...detail, bendQty: v })} />
      <NumberField label="Tees" value={detail.teeQty} onChange={(v) => onChange({ ...detail, teeQty: v })} />
      <NumberField label="Reducers" value={detail.reducerQty} onChange={(v) => onChange({ ...detail, reducerQty: v })} />
      <NumberField label="Supports" value={detail.supportQty} onChange={(v) => onChange({ ...detail, supportQty: v })} />
      <NumberField label="Hangers" value={detail.hangerQty} onChange={(v) => onChange({ ...detail, hangerQty: v })} />
      <NumberField label="Rate" value={detail.rate} onChange={(v) => onChange({ ...detail, rate: v })} />
    </div>
  );
}

export function EarthConductorEditor({
  title,
  detail,
  onChange,
}: {
  title: string;
  detail: EarthingConductorDetail;
  onChange: (next: EarthingConductorDetail) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-800/80 p-3 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SelectField label="Conductor type" value={detail.conductorType} options={EARTH_TYPE} onChange={(v) => onChange({ ...detail, conductorType: v as EarthingConductorDetail["conductorType"] })} />
        {detail.conductorType === "custom" && <TextField label="Custom type" value={detail.customType} onChange={(v) => onChange({ ...detail, customType: v })} />}
        <TextField label="Area mm²" value={detail.areaMm2} onChange={(v) => onChange({ ...detail, areaMm2: v })} />
        <TextField label="Strip size" value={detail.stripSize} onChange={(v) => onChange({ ...detail, stripSize: v })} />
        <NumberField label="Length m" value={detail.lengthM} onChange={(v) => onChange({ ...detail, lengthM: v })} />
        <NumberField label="Rate / m" value={detail.ratePerMeter} onChange={(v) => onChange({ ...detail, ratePerMeter: v })} />
      </div>
    </div>
  );
}

export function CivilFoundationEditor({ detail, onChange }: { detail: CivilFoundationDetail; onChange: (next: CivilFoundationDetail) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-amber-200">{civilFoundationDisplay(detail)}</p>
      <p className="text-[11px] text-slate-500">Do not auto-calculate structural dimensions. Unknown stays pending structural design / site survey.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SelectField
          label="Design status"
          value={detail.designStatus}
          options={[
            { value: "pending_structural_design", label: "Pending structural design" },
            { value: "provided", label: "Provided by engineer" },
          ]}
          onChange={(v) => onChange({ ...detail, designStatus: v as CivilFoundationDetail["designStatus"] })}
        />
        {detail.designStatus === "provided" && (
          <TextField label="Design note" value={detail.designNote} onChange={(v) => onChange({ ...detail, designNote: v })} />
        )}
        <NumberField label="Foundation pad qty" value={detail.foundationPadQty} onChange={(v) => onChange({ ...detail, foundationPadQty: v })} />
        <TextField label="Pad length" value={detail.padLength} onChange={(v) => onChange({ ...detail, padLength: v })} />
        <TextField label="Pad width" value={detail.padWidth} onChange={(v) => onChange({ ...detail, padWidth: v })} />
        <TextField label="Pad depth" value={detail.padDepth} onChange={(v) => onChange({ ...detail, padDepth: v })} />
        <TextField label="Excavation qty" value={detail.excavationQty} onChange={(v) => onChange({ ...detail, excavationQty: v })} />
        <TextField label="PCC grade" value={detail.pccGrade} onChange={(v) => onChange({ ...detail, pccGrade: v })} />
        <TextField label="PCC qty" value={detail.pccQty} onChange={(v) => onChange({ ...detail, pccQty: v })} />
        <TextField label="RCC grade" value={detail.rccGrade} onChange={(v) => onChange({ ...detail, rccGrade: v })} />
        <TextField label="RCC qty" value={detail.rccQty} onChange={(v) => onChange({ ...detail, rccQty: v })} />
        <TextField label="Rebar grade" value={detail.rebarGrade} onChange={(v) => onChange({ ...detail, rebarGrade: v })} />
        <TextField label="Rebar kg" value={detail.rebarKg} onChange={(v) => onChange({ ...detail, rebarKg: v })} />
        <TextField label="Formwork area" value={detail.formworkArea} onChange={(v) => onChange({ ...detail, formworkArea: v })} />
        <NumberField label="Anchor bolt qty" value={detail.anchorBoltQty} onChange={(v) => onChange({ ...detail, anchorBoltQty: v })} />
        <TextField label="Anchor bolt diameter" value={detail.anchorBoltDiameter} onChange={(v) => onChange({ ...detail, anchorBoltDiameter: v })} />
        <TextField label="Anchor bolt grade" value={detail.anchorBoltGrade} onChange={(v) => onChange({ ...detail, anchorBoltGrade: v })} />
        <TextField label="Grouting" value={detail.grouting} onChange={(v) => onChange({ ...detail, grouting: v })} />
        <TextField label="Curing days / scope" value={detail.curingDays} onChange={(v) => onChange({ ...detail, curingDays: v })} />
        <SelectField label="Waterproofing" value={detail.waterproofingRequired} options={YNP} onChange={(v) => onChange({ ...detail, waterproofingRequired: v as CivilFoundationDetail["waterproofingRequired"] })} />
      </div>
    </div>
  );
}
