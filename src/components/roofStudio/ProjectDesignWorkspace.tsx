/**
 * Project Design Workspace V1 — CRM-connected workflow shell.
 * Uses existing Roof Studio engines only. No new backend, no AI, no fake map/output.
 * Address edits are local draft state only — no CRM mutation.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, Phone, Sun, Zap } from "lucide-react";
import type { Lead } from "../../types";
import { formatLeadLocation, sanitizeLeadLocationInput } from "../../lib/leadDisplay";
import {
  parseOptionalGpsAnchor,
  type SiteGeoReference,
  DEFAULT_SITE_GEO,
} from "../../lib/roofStudioGeoReference";
import {
  DESIGN_WORKSPACE_DRAFT_ONLY_LABEL,
  displayCustomerPhone,
} from "../../lib/sunchaserDesignStudioClient";
import RoofIntelligenceStudio, {
  type ProjectDesignContext,
} from "./RoofIntelligenceStudio";

export interface ProjectDesignWorkspaceProps {
  lead: Lead;
  sanctionedLoad?: string | number | null;
}

function resolveSanctionedLoad(
  lead: Lead,
  override?: string | number | null
): string {
  if (override !== undefined && override !== null && String(override).trim() !== "") {
    return String(override).trim();
  }
  if (lead.sanctionedLoad != null && Number.isFinite(Number(lead.sanctionedLoad))) {
    return `${lead.sanctionedLoad} kW`;
  }
  const quotes = lead.quotes || [];
  for (let i = quotes.length - 1; i >= 0; i--) {
    const q = quotes[i] as { lescoSettings?: { sanctionedLoad?: string } };
    const fromQuote = q?.lescoSettings?.sanctionedLoad;
    if (fromQuote && String(fromQuote).trim()) return String(fromQuote).trim();
  }
  return "Not set";
}

function initialAddress(lead: Lead): string {
  const fromFormat = formatLeadLocation(lead);
  if (fromFormat !== "Location not specified") return fromFormat;
  return sanitizeLeadLocationInput(lead.address) || sanitizeLeadLocationInput(lead.location) || "";
}

export default function ProjectDesignWorkspace({
  lead,
  sanctionedLoad,
}: ProjectDesignWorkspaceProps) {
  const [address, setAddress] = useState(() => initialAddress(lead));
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [geoSeed, setGeoSeed] = useState<SiteGeoReference>(() => ({
    ...DEFAULT_SITE_GEO,
    siteLabel: lead.name || "",
  }));

  useEffect(() => {
    setAddress(initialAddress(lead));
    setLatText("");
    setLngText("");
    setGpsError(null);
    setGeoSeed({
      ...DEFAULT_SITE_GEO,
      siteLabel: lead.name || "",
    });
  }, [lead.id]);

  const sanctionedDisplay = useMemo(
    () => resolveSanctionedLoad(lead, sanctionedLoad),
    [lead, sanctionedLoad]
  );

  const customerPhone = displayCustomerPhone(lead.phone);

  const commitGps = useCallback(
    (nextLat: string, nextLng: string) => {
      const parsed = parseOptionalGpsAnchor(nextLat, nextLng);
      if (!parsed.ok) {
        setGpsError(parsed.error);
        return;
      }
      setGpsError(null);
      setGeoSeed((prev) => ({
        ...prev,
        siteLabel: address.trim() || lead.name || prev.siteLabel,
        latitude: parsed.anchor?.latitude ?? null,
        longitude: parsed.anchor?.longitude ?? null,
      }));
    },
    [address, lead.name]
  );

  const project: ProjectDesignContext = useMemo(
    () => ({
      leadId: lead.id,
      customerName: lead.name || "Customer",
      phone: lead.phone || "",
      address,
      sanctionedLoad: sanctionedDisplay,
      geoSeed,
    }),
    [lead.id, lead.name, lead.phone, address, sanctionedDisplay, geoSeed]
  );

  return (
    <div className="space-y-4 text-left fade-in-entry">
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950/20 p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-amber-600/10 border border-amber-500/30">
            <Sun className="h-6 w-6 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold text-white tracking-tight">Project Design Workspace</h2>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                V1
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-400">
                Draft only
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400 max-w-2xl">
              Customer → Address → Upload &amp; calibrate → Draw roof → Auto layout → BOQ → Proposal draft.
              Existing engines only. No AI guessing. No fake map or output.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Customer</p>
            <p className="mt-0.5 text-sm font-bold text-white truncate">{lead.name || "—"}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1">
              <Phone className="h-3 w-3" /> Phone
            </p>
            <p className="mt-0.5 text-sm font-mono text-slate-200 truncate" data-testid="project-workspace-customer-phone">
              {customerPhone}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 sm:col-span-2 lg:col-span-1">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1">
              <MapPin className="h-3 w-3" /> Address
            </p>
            <p className="mt-0.5 text-sm text-slate-200 truncate">{address || "Not set"}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1">
              <Zap className="h-3 w-3" /> Sanctioned load
            </p>
            <p className="mt-0.5 text-sm font-mono text-amber-200">{sanctionedDisplay}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <MapPin className="h-4 w-4 text-amber-400" />
            Address / GPS
          </h3>
          <p className="text-[9px] text-slate-500">Map preview not available — enter coordinates manually.</p>
        </div>

        <label className="block text-[10px] text-slate-500">
          Site address
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street, area, city"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
          />
        </label>
        <p className="text-[9px] text-amber-300/90" data-testid="design-workspace-draft-only">
          {DESIGN_WORKSPACE_DRAFT_ONLY_LABEL}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-[10px] text-slate-500">
            Latitude
            <input
              value={latText}
              onChange={(e) => setLatText(e.target.value)}
              onBlur={() => commitGps(latText, lngText)}
              placeholder="e.g. 31.5204"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm font-mono text-white"
            />
          </label>
          <label className="block text-[10px] text-slate-500">
            Longitude
            <input
              value={lngText}
              onChange={(e) => setLngText(e.target.value)}
              onBlur={() => commitGps(latText, lngText)}
              placeholder="e.g. 74.3587"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm font-mono text-white"
            />
          </label>
        </div>
        {gpsError && <p className="text-[10px] text-rose-400">{gpsError}</p>}
        <p className="text-[9px] text-slate-500">
          GPS is optional. Leave blank if unknown. Invalid values are rejected (fail closed).
        </p>
      </div>

      <RoofIntelligenceStudio key={lead.id} project={project} workspaceMode />
    </div>
  );
}
