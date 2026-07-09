/**
 * Design Studio Results Panel V1 — live engineering summaries in the right sidebar.
 * Displays outputs from existing engines only. Draft-only display — no persistence.
 */

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileText,
  Layers,
  Sparkles,
  Sun,
  Zap,
} from "lucide-react";
import {
  COMPLETE_PREVIOUS_STEP_MESSAGE,
  type DesignStudioLiveResults,
} from "../../lib/sunchaserDesignStudioClient";

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `PKR ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function StatusDot({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
  ) : (
    <Circle className="h-3.5 w-3.5 text-slate-600 shrink-0" />
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 text-[11px]">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-right font-medium text-slate-100 break-words">{value}</span>
    </div>
  );
}

function GateNote({ reason }: { reason: string | null | undefined }) {
  if (!reason) return null;
  return (
    <p className="text-[10px] text-amber-300/90 flex gap-1.5 items-start">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      {reason}
    </p>
  );
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <Icon className="h-3.5 w-3.5 text-amber-400" />
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export interface DesignStudioResultsPanelProps {
  live: DesignStudioLiveResults;
  onAutoLayout?: () => void;
  autoLayoutDisabled?: boolean;
  autoLayoutMessage?: string | null;
}

export default function DesignStudioResultsPanel({
  live,
  onAutoLayout,
  autoLayoutDisabled,
  autoLayoutMessage,
}: DesignStudioResultsPanelProps) {
  const { status, roof, panelsSummary, electricalSummary, production, boq, proposal } = live;

  return (
    <div className="space-y-2" data-testid="design-studio-results-panel">
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
          <div key={label} className="flex items-center gap-2 text-[11px] text-slate-300">
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
              <button
                type="button"
                disabled={autoLayoutDisabled}
                onClick={onAutoLayout}
                className="mt-1 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] font-bold text-amber-200 disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Auto Layout
              </button>
            )}
          </>
        ) : (
          <>
            <Row label="Panel model" value={panelsSummary.panelModel ?? "—"} />
            <Row label="Orientation" value={panelsSummary.orientation ?? "—"} />
            <Row label="Panel count" value={String(panelsSummary.panelCount)} />
            <Row label="DC kW" value={fmt(panelsSummary.dcKw, 2)} />
            <Row label="Layout status" value={panelsSummary.layoutStatus} />
            {!status.panelLayoutReady && onAutoLayout && (
              <button
                type="button"
                disabled={autoLayoutDisabled}
                onClick={onAutoLayout}
                className="mt-1 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] font-bold text-amber-200 disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Auto Layout
              </button>
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
            <Row label="Strings" value={electricalSummary.strings ?? "—"} />
            <Row label="MPPT allocation" value={electricalSummary.mpptAllocation ?? "—"} />
            <Row
              label="Voc max"
              value={electricalSummary.vocMaxV != null ? `${fmt(electricalSummary.vocMaxV, 1)} V` : "—"}
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
              <p className="text-[10px] text-amber-300 flex gap-1 items-start">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {boq.overrideWarning ?? "Manual override applied — totals may differ from engine draft."}
              </p>
            )}
          </>
        )}
      </PanelSection>

      <PanelSection title="Proposal" icon={FileText}>
        {!proposal.available && !proposal.readyForPreview ? (
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
        ) : (
          <>
            <Row label="Draft status" value={proposal.draftStatus} />
            <Row label="Ready for preview" value={proposal.readyForPreview ? "Yes" : "No"} />
            {proposal.missingRequirements.length > 0 && (
              <ul className="space-y-0.5">
                {proposal.missingRequirements.map((m) => (
                  <li key={m} className="text-[9px] text-amber-200/90">
                    • {m}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </PanelSection>

      <p className="text-[9px] text-slate-500 px-1">
        Results from Roof Geometry, Panel Layout V2, Electrical Design, Solar Simulation, and Proposal/BOQ engines.
        Draft only — not saved.
      </p>
    </div>
  );
}
