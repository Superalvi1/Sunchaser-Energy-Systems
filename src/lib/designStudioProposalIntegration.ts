/**
 * Design Studio → Proposal Studio integration adapter.
 * Reuses existing Proposal Engine page builders — draft-only, no save/PDF/AI.
 */

import { generateSolarProposal } from "../../server/solar/proposal/SolarProposalEngine.ts";
import { STRUCTURE_TYPES } from "../../server/solar/proposal/SolarProposalModels.ts";
import type { ProposalPreviewPage } from "./solarDesignStudio.ts";
import { DESIGN_INCOMPLETE_BOQ_LABEL, DESIGN_INCOMPLETE_MESSAGE } from "./solarDesignStudio.ts";
import {
  buildIncompleteStudioPages,
  buildStudioProposalPages,
} from "./solarProposalStudioClient.ts";
import type {
  DesignStudioControls,
  DesignStudioLiveResults,
} from "./sunchaserDesignStudioClient.ts";
import {
  resolveCatalogModule,
  snapToSupportedSystemSizeKw,
} from "./sunchaserDesignStudioClient.ts";

export interface DesignStudioProposalCustomer {
  name: string;
  phone: string;
  address: string;
  sanctionedLoad?: string;
}

export interface DesignStudioProposalRoofPreview {
  imageUrl: string | null;
  imageFileName: string | null;
}

export interface DesignStudioProposalIntegrationInput {
  live: DesignStudioLiveResults;
  controls: DesignStudioControls;
  customer: DesignStudioProposalCustomer;
  roofPreview: DesignStudioProposalRoofPreview;
}

export interface DesignStudioProposalIntegration {
  draftOnly: true;
  ready: boolean;
  gatedReason: string | null;
  pages: ProposalPreviewPage[];
  roofImageUrl: string | null;
  roofImageFileName: string | null;
  customer: DesignStudioProposalCustomer;
  warnings: string[];
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `PKR ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function roofDimensionsFromLive(live: DesignStudioLiveResults): {
  roofWidthMeters: number;
  roofDepthMeters: number;
  roofAreaM2: number;
  usableAreaM2: number;
} {
  const roofAreaM2 = live.roof.grossAreaM2 ?? live.roof.trueAreaM2 ?? 0;
  const usableAreaM2 = live.roof.usableAreaM2 ?? 0;
  const side = Math.sqrt(Math.max(roofAreaM2, 1));
  const rounded = Math.round(side * 10) / 10;
  return {
    roofWidthMeters: rounded,
    roofDepthMeters: rounded,
    roofAreaM2,
    usableAreaM2,
  };
}

function buildGatedPages(live: DesignStudioLiveResults): ProposalPreviewPage[] {
  const missing = live.proposal.missingRequirements;
  const reason = live.proposal.gatedReason ?? live.gatedReason ?? DESIGN_INCOMPLETE_MESSAGE;
  const lines = missing.length > 0 ? missing : [reason];
  return [
    {
      id: "incomplete",
      title: "Proposal Preview",
      subtitle: DESIGN_INCOMPLETE_BOQ_LABEL,
      sections: [{ heading: "Status", lines }],
    },
  ];
}

function customerSection(customer: DesignStudioProposalCustomer): { heading: string; lines: string[] } {
  const lines = [
    customer.name,
    customer.phone,
    customer.address || "Address not provided",
  ];
  if (customer.sanctionedLoad) {
    lines.push(`Sanctioned load: ${customer.sanctionedLoad}`);
  }
  return { heading: "Customer information", lines };
}

function panelSummarySection(live: DesignStudioLiveResults): { heading: string; lines: string[] } {
  const p = live.panelsSummary;
  const utilization =
    live.layout?.utilizationPct != null ? `${fmt(live.layout.utilizationPct, 1)}%` : "—";
  return {
    heading: "Panel summary",
    lines: [
      `Module: ${p.panelModel ?? "—"}`,
      `Orientation: ${p.orientation ?? "—"}`,
      `Panel count: ${p.panelCount}`,
      `DC capacity: ${fmt(p.dcKw, 2)} kW`,
      `Layout status: ${p.layoutStatus}`,
      `Roof utilization: ${utilization}`,
    ],
  };
}

function electricalSummarySection(live: DesignStudioLiveResults): { heading: string; lines: string[] } {
  const e = live.electricalSummary;
  return {
    heading: "Electrical summary",
    lines: [
      `Inverter: ${e.inverter ?? "—"}`,
      `Strings: ${e.strings ?? "—"}`,
      `MPPT: ${e.mpptAllocation ?? "—"}`,
      `Voc max: ${e.vocMaxV != null ? `${fmt(e.vocMaxV, 1)} V` : "—"}`,
      `Vmp range: ${e.vmpRange ?? "—"}`,
      `DC cable: ${e.dcCableMm2 != null ? `${fmt(e.dcCableMm2, 1)} mm²` : "—"}`,
      `AC cable: ${e.acCableMm2 != null ? `${fmt(e.acCableMm2, 1)} mm²` : "—"}`,
      `Protection: ${e.breakerSpd ?? "—"}`,
      `Status: ${e.valid === null ? "—" : e.valid ? "Valid" : "Invalid"}`,
    ],
  };
}

function productionSummarySection(live: DesignStudioLiveResults): { heading: string; lines: string[] } {
  const p = live.production;
  const lines = [
    `Annual production: ${p.annualKwh != null ? `${fmt(p.annualKwh, 0)} kWh` : "—"}`,
    `Performance ratio: ${
      p.performanceRatio != null ? `${fmt(p.performanceRatio * 100, 1)}%` : "—"
    }`,
  ];
  if (p.monthly.length > 0) {
    lines.push(
      ...p.monthly.slice(0, 6).map((m) => `${m.label}: ${fmt(m.kwh, 0)} kWh`),
      ...(p.monthly.length > 6 ? [`… +${p.monthly.length - 6} more months`] : [])
    );
  }
  if (p.losses.length > 0) {
    lines.push(...p.losses.slice(0, 4).map((l) => `${l.label} loss: ${fmt(l.kwh, 0)} kWh`));
  }
  return { heading: "Production summary", lines };
}

function boqSummarySection(live: DesignStudioLiveResults): { heading: string; lines: string[] } {
  const b = live.boq;
  return {
    heading: "BOQ summary",
    lines: [
      `Material total: ${fmtMoney(b.materialTotal)}`,
      `Structure total: ${fmtMoney(b.structureTotal)}`,
      `Electrical total: ${fmtMoney(b.electricalTotal)}`,
      `Services total: ${fmtMoney(b.servicesTotal)}`,
      `Grand total: ${fmtMoney(b.grandTotal)}`,
      "Draft only — not a final quotation.",
    ],
  };
}

function roofPreviewSection(
  live: DesignStudioLiveResults,
  roofPreview: DesignStudioProposalRoofPreview
): { heading: string; lines: string[] } {
  const lines = [
    roofPreview.imageFileName ? `Image: ${roofPreview.imageFileName}` : "Roof image loaded on canvas",
    `Panels on layout: ${live.panelCount}`,
    `Usable PV area: ${live.roof.usableAreaM2 != null ? `${fmt(live.roof.usableAreaM2, 1)} m²` : "—"}`,
    roofPreview.imageUrl ? "Annotated roof layout preview shown below." : "Upload a roof image to show layout preview.",
  ];
  return { heading: "Roof layout preview", lines };
}

function enrichProposalPages(
  pages: ProposalPreviewPage[],
  live: DesignStudioLiveResults,
  customer: DesignStudioProposalCustomer,
  roofPreview: DesignStudioProposalRoofPreview
): ProposalPreviewPage[] {
  const enriched = pages.map((page) => {
    if (page.id === "cover") {
      return {
        ...page,
        sections: [
          customerSection(customer),
          ...page.sections.filter((s) => s.heading !== "Prepared for"),
        ],
      };
    }
    if (page.id === "site-design") {
      return {
        ...page,
        sections: [
          roofPreviewSection(live, roofPreview),
          panelSummarySection(live),
          ...page.sections,
        ],
      };
    }
    if (page.id === "system-spec") {
      return {
        ...page,
        sections: [...page.sections, electricalSummarySection(live)],
      };
    }
    if (page.id === "boq") {
      return {
        ...page,
        sections: [boqSummarySection(live), ...page.sections],
      };
    }
    return page;
  });

  if (live.production.available) {
    const productionPage: ProposalPreviewPage = {
      id: "production",
      title: "Energy Production",
      subtitle: "Solar simulation (Design Studio)",
      sections: [
        productionSummarySection(live),
        ...(live.production.assumptions.length > 0
          ? [
              {
                heading: "Assumptions",
                lines: live.production.assumptions.slice(0, 6),
              },
            ]
          : []),
      ],
    };
    const boqIndex = enriched.findIndex((p) => p.id === "boq");
    if (boqIndex >= 0) {
      return [...enriched.slice(0, boqIndex), productionPage, ...enriched.slice(boqIndex)];
    }
    return [...enriched, productionPage];
  }

  return enriched;
}

export function buildDesignStudioProposalIntegration(
  input: DesignStudioProposalIntegrationInput
): DesignStudioProposalIntegration {
  const { live, controls, customer, roofPreview } = input;
  const warnings = [...live.warnings];

  if (!live.proposal.readyForPreview || !live.layout) {
    return {
      draftOnly: true,
      ready: false,
      gatedReason: live.proposal.gatedReason ?? live.gatedReason ?? DESIGN_INCOMPLETE_MESSAGE,
      pages: buildGatedPages(live),
      roofImageUrl: roofPreview.imageUrl,
      roofImageFileName: roofPreview.imageFileName,
      customer,
      warnings,
    };
  }

  const moduleResolved = resolveCatalogModule(controls.moduleId);
  if (!moduleResolved.ok) {
    return {
      draftOnly: true,
      ready: false,
      gatedReason: (moduleResolved as any).message,
      pages: buildGatedPages(live),
      roofImageUrl: roofPreview.imageUrl,
      roofImageFileName: roofPreview.imageFileName,
      customer,
      warnings: [...warnings, (moduleResolved as any).message],
    };
  }

  const snapped = snapToSupportedSystemSizeKw(live.dcKw || live.layout.dcCapacityKw);
  const dims = roofDimensionsFromLive(live);

  try {
    const { draft, template } = generateSolarProposal({
      systemSizeKw: snapped,
      tier: controls.tier,
      systemType: controls.systemType,
      structureType: STRUCTURE_TYPES.includes(controls.structureType) ? controls.structureType : "standard",
      panelWattage: moduleResolved.module.wattage,
    });

    if (draft.warnings?.length) warnings.push(...draft.warnings);

    const basePages = buildStudioProposalPages(
      draft,
      template,
      dims.roofWidthMeters,
      dims.roofDepthMeters,
      dims.usableAreaM2,
      dims.roofAreaM2
    );

    const pages = enrichProposalPages(basePages, live, customer, roofPreview);

    return {
      draftOnly: true,
      ready: true,
      gatedReason: null,
      pages,
      roofImageUrl: roofPreview.imageUrl,
      roofImageFileName: roofPreview.imageFileName,
      customer,
      warnings,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Proposal integration failed.";
    warnings.push(msg);
    return {
      draftOnly: true,
      ready: false,
      gatedReason: msg,
      pages: buildIncompleteStudioPages(),
      roofImageUrl: roofPreview.imageUrl,
      roofImageFileName: roofPreview.imageFileName,
      customer,
      warnings,
    };
  }
}
