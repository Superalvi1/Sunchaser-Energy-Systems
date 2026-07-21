/**
 * Design Studio Results Panel V1 — live engineering summaries in the right sidebar.
 * Displays outputs from existing engines only. Draft-only display — no persistence.
 */

import React from "react";
import {
  CheckCircle2,
  FileText,
  Layers,
  Sparkles,
  Sun,
  Zap,
} from "lucide-react";
import type { DesignStudioProposalCustomer, DesignStudioProposalRoofPreview } from "../../lib/designStudioProposalIntegration";
import {
  COMPLETE_PREVIOUS_STEP_MESSAGE,
  type DesignStudioControls,
  type DesignStudioLiveResults,
} from "../../lib/sunchaserDesignStudioClient";
import DesignStudioProposalPreview from "./DesignStudioProposalPreview";
import {
  StudioButton,
  StudioGateNote,
  StudioPanel,
  StudioRow,
} from "../ui/studio";

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `PKR ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return <StudioRow label={label} value={value} />;
}

function GateNote({ reason }: { reason: string | null | undefined }) {
  return <StudioGateNote reason={reason} />;
}

function PanelSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <StudioPanel title={title} icon={Icon as import("lucide-react").LucideIcon}>
      {children}
    </StudioPanel>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "studio-status-dot studio-status-dot-ok" : "studio-status-dot"} />
  );
}

export interface DesignStudioResultsPanelProps {
  live: DesignStudioLiveResults;
  controls: DesignStudioControls;
  customer: DesignStudioProposalCustomer;
  roofPreview: DesignStudioProposalRoofPreview;
  onAutoLayout?: () => void;
  autoLayoutDisabled?: boolean;
  autoLayoutMessage?: string | null;
}

export default function DesignStudioResultsPanel({
  live,
  controls,
  customer,
  roofPreview,
  onAutoLayout,
  autoLayoutDisabled,
  autoLayoutMessage,
}: DesignStudioResultsPanelProps) {
  const { status, roof, panelsSummary, electricalSummary, production, boq, proposal } = live;

  return (
    <div className="space-y-3 studio-fade-in" data-testid="design-studio-results-panel">
      <PanelSection title="Design Status" icon={CheckCircle2}>
        {(
          [
            ["Upload complete", status.uploadComplete],
            ["Scale calibrated", status.scaleCalibrated],
            ["Roof valid", status.roofValid],
            ["Panel layout ready", status.panelLayoutReady],
            ["Electrical ready", status.electricalReady],
            ["Simulation ready", status.simulationReady],
            ["BOQ ready", status.boqReady],
          ] as const
        ).map(([label, ok]) => (
          <div key={label} className="flex items-center gap-2.5 text-sm text-slate-300">
            <StatusDot ok={ok} />
            <span>{label}</span>
          </div>
        ))}
        {live.gatedReason && <GateNote reason={live.gatedReason} />}
      </PanelSection>

      <PanelSection title="Roof" icon={Layers}>
        {!roof.available ? (
          <GateNote reason={roof.gatedReason ?? COMPLETE_PREVIOUS_STEP_MESSAGE} />
        ) : (
          <>
            {roof.stageError && (
              <p className="text-[10px] text-rose-300">Stage error: {roof.stageError}</p>
            )}
            <Row label="Gross area" value={`${fmt(roof.grossAreaM2, 1)} m²`} />
            <Row label="Usable area" value={`${fmt(roof.usableAreaM2, 1)} m²`} />
            <Row label="True area" value={`${fmt(roof.trueAreaM2, 1)} m²`} />
            <Row label="Obstacle %" value={roof.obstaclePercent != null ? `${fmt(roof.obstaclePercent, 1)}%` : "—"} />
            {roof.warnings.length > 0 && (
              <ul className="space-y-0.5">
                {roof.warnings.slice(0, 4).map((w) => (
                  <li key={w} className="text-[9px] text-amber-200/90">
                    • {w}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </PanelSection>

      <PanelSection title="Panels" icon={Sun}>
        {!panelsSummary.available && !status.panelLayoutReady ? (
          <>
            <GateNote reason={panelsSummary.gatedReason ?? COMPLETE_PREVIOUS_STEP_MESSAGE} />
            {onAutoLayout && (
              <StudioButton
                variant="secondary"
                icon={Sparkles}
                disabled={autoLayoutDisabled}
                onClick={onAutoLayout}
                className="w-full mt-1 border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15"
              >
                Auto Layout
              </StudioButton>
            )}
          </>
        ) : (
          <>
            <Row label="Panel model" value={panelsSummary.panelModel ?? "—"} />
            <Row label="Orientation" value={panelsSummary.orientation ?? "—"} />
            <Row label="Panel count" value={String(panelsSummary.panelCount)} />
            <Row label="DC size" value={`${fmt(panelsSummary.dcKw, 2)} kW`} />
            <Row label="Layout status" value={panelsSummary.layoutStatus} />
            {!status.panelLayoutReady && onAutoLayout && (
              <StudioButton
                variant="secondary"
                icon={Sparkles}
                disabled={autoLayoutDisabled}
                onClick={onAutoLayout}
                className="w-full mt-1 border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15"
              >
                Auto Layout
              </StudioButton>
            )}
          </>
        )}
        {autoLayoutMessage && (
          <p className="text-[9px] text-amber-200/90">{autoLayoutMessage}</p>
        )}
      </PanelSection>

      <PanelSection title="Electrical" icon={Zap}>
        {!electricalSummary.available ? (
          <GateNote reason={electricalSummary.gatedReason ?? COMPLETE_PREVIOUS_STEP_MESSAGE} />
        ) : (
          <>
            {electricalSummary.stageError && (
              <p className="text-[10px] text-rose-300">Stage error: {electricalSummary.stageError}</p>
            )}
            <Row label="Inverter" value={electricalSummary.inverter ?? "—"} />
            <Row
              label="AC size"
              value={electricalSummary.acKw != null ? `${fmt(electricalSummary.acKw, 1)} kW` : "—"}
            />
            <Row
              label="String count"
              value={electricalSummary.stringCount != null ? String(electricalSummary.stringCount) : "—"}
            />
            <Row label="Strings" value={electricalSummary.strings ?? "—"} />
            <Row label="MPPT allocation" value={electricalSummary.mpptAllocation ?? "—"} />
            <Row
              label="Voc"
              value={electricalSummary.vocMaxV != null ? `${fmt(electricalSummary.vocMaxV, 1)} V` : "—"}
            />
            <Row
              label="Isc"
              value={electricalSummary.iscA != null ? `${fmt(electricalSummary.iscA, 2)} A` : "—"}
            />
            <Row label="Vmp range" value={electricalSummary.vmpRange ?? "—"} />
            <Row
              label="DC cable"
              value={electricalSummary.dcCableMm2 != null ? `${fmt(electricalSummary.dcCableMm2, 1)} mm²` : "—"}
            />
            <Row
              label="AC cable"
              value={electricalSummary.acCableMm2 != null ? `${fmt(electricalSummary.acCableMm2, 1)} mm²` : "—"}
            />
            <Row label="Breaker / SPD" value={electricalSummary.breakerSpd ?? "—"} />
            <Row
              label="Status"
              value={
                electricalSummary.valid === null
                  ? "—"
                  : electricalSummary.valid
                    ? "Valid"
                    : "Invalid"
              }
            />
          </>
        )}
      </PanelSection>

      <PanelSection title="Production" icon={Sun}>
        {!production.available ? (
          <GateNote reason={production.gatedReason ?? COMPLETE_PREVIOUS_STEP_MESSAGE} />
        ) : (
          <>
            {production.stageError && (
              <p className="text-[10px] text-rose-300">Stage error: {production.stageError}</p>
            )}
            <Row
              label="Annual kWh"
              value={production.annualKwh != null ? `${fmt(production.annualKwh, 0)} kWh` : "—"}
            />
            <Row
              label="Performance ratio"
              value={
                production.performanceRatio != null
                  ? `${fmt(production.performanceRatio * 100, 1)}%`
                  : "—"
              }
            />
            {production.monthly.length > 0 && (
              <ul className="grid grid-cols-3 gap-1 mt-1">
                {production.monthly.map((m) => (
                  <li key={m.label} className="rounded-md bg-slate-950 px-1.5 py-1 text-center">
                    <div className="text-[8px] uppercase text-slate-500">{m.label}</div>
                    <div className="text-[10px] font-mono text-slate-200">{fmt(m.kwh, 0)}</div>
                  </li>
                ))}
              </ul>
            )}
            {production.losses.length > 0 && (
              <div className="space-y-0.5 pt-1">
                <p className="text-[9px] uppercase text-slate-500 font-bold">Losses</p>
                {production.losses.map((l) => (
                  <Row key={l.label} label={l.label} value={`${fmt(l.kwh, 0)} kWh`} />
                ))}
              </div>
            )}
            {production.assumptions.length > 0 && (
              <ul className="space-y-0.5 pt-1">
                <p className="text-[9px] uppercase text-slate-500 font-bold">Assumptions</p>
                {production.assumptions.slice(0, 6).map((a) => (
                  <li key={a} className="text-[9px] text-slate-400">
                    • {a}
                  </li>
                ))}
              </ul>
            )}
            {production.warnings.length > 0 && (
              <ul className="space-y-0.5">
                {production.warnings.slice(0, 4).map((w) => (
                  <li key={w} className="text-[9px] text-amber-200/90">
                    • {w}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </PanelSection>

      <PanelSection title="BOQ" icon={FileText}>
        {!boq.available ? (
          <GateNote reason={boq.gatedReason ?? COMPLETE_PREVIOUS_STEP_MESSAGE} />
        ) : (
          <>
            {boq.stageError && <p className="text-[10px] text-rose-300">Stage error: {boq.stageError}</p>}
            <Row label="Material total" value={fmtMoney(boq.materialTotal)} />
            <Row label="Structure total" value={fmtMoney(boq.structureTotal)} />
            <Row label="Electrical total" value={fmtMoney(boq.electricalTotal)} />
            <Row label="Services total" value={fmtMoney(boq.servicesTotal)} />
            <Row label="Grand total" value={fmtMoney(boq.grandTotal)} />
            {boq.hasManualOverride && (
              <p className="studio-gate-note text-[11px]">
                {boq.overrideWarning ?? "Manual override applied — totals may differ from engine draft."}
              </p>
            )}
          </>
        )}
      </PanelSection>

      <PanelSection title="Proposal" icon={FileText}>
        <Row label="Draft status" value={proposal.draftStatus} />
        <Row label="Ready for preview" value={proposal.readyForPreview ? "Yes" : "No"} />
        {!proposal.available && !proposal.readyForPreview && (
          <>
            <GateNote reason={proposal.gatedReason ?? COMPLETE_PREVIOUS_STEP_MESSAGE} />
            {proposal.missingRequirements.length > 0 && (
              <ul className="space-y-0.5">
                {proposal.missingRequirements.map((m) => (
                  <li key={m} className="text-[9px] text-slate-400">
                    • {m}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <DesignStudioProposalPreview
          live={live}
          controls={controls}
          customer={customer}
          roofPreview={roofPreview}
        />
      </PanelSection>

      <p className="text-[9px] text-slate-500 px-1">
        Results from Roof Geometry, Panel Layout V2, Electrical Design, Solar Simulation, and Proposal/BOQ engines.
        Draft only — not saved.
      </p>
    </div>
  );
}
