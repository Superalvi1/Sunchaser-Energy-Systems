import type { Express, Request, Response } from "express";
import {
  calculateInteractiveProposal,
  defaultInteractiveProposalConfig,
  normalizeInteractiveProposalDefinition,
  publicInteractiveProposalDefinition,
  quoteToInteractiveProposalDefinition,
  type InteractiveProposalConfig,
  type InteractiveProposalDefinition,
} from "../../src/lib/interactiveProposal.ts";
import { snapshotOriginalQuotation } from "../../src/lib/interactiveProposalCatalog.ts";
import {
  InteractiveProposalConflictError,
  InteractiveProposalSchemaError,
  type InteractiveProposalRecord,
  type InteractiveProposalStore,
} from "./interactiveProposalRepository.ts";

type SourceQuoteContext = {
  lead: any;
  quote: any;
};

export type InteractiveProposalRouteDeps = {
  resolveStore: () => InteractiveProposalStore;
  resolveSourceQuote: (
    req: Request,
    res: Response,
    leadId: string,
    quotationId: string
  ) => Promise<SourceQuoteContext | null>;
  afterMutation?: () => void | Promise<void>;
  appendActivity?: (input: {
    req: Request;
    action: string;
    details: string;
  }) => void | Promise<void>;
};

function proposalToken(value: unknown): string | null {
  const token = String(value || "").trim();
  return /^[A-Za-z0-9_-]{40,80}$/.test(token) ? token : null;
}

function proposalUnavailable(res: Response) {
  return res.status(404).json({ error: "This proposal link is invalid or no longer available." });
}

function publicDefinition(definition: InteractiveProposalDefinition) {
  return publicInteractiveProposalDefinition(definition);
}

function publicPayload(record: InteractiveProposalRecord) {
  const calculation = calculateInteractiveProposal(record.definition, record.currentConfig);
  return {
    id: record.id,
    status: record.status,
    definition: publicDefinition(record.definition),
    configuration: calculation.configuration,
    calculation,
    expiresAt: record.expiresAt,
    acceptedAt: record.acceptedAt,
    acceptedByName: record.acceptedByName,
    acceptedCalculation: record.acceptedCalculation,
  };
}

function sendRouteError(res: Response, error: unknown) {
  if (error instanceof InteractiveProposalSchemaError) {
    return res.status(503).json({
      error: "Interactive proposals are not ready yet. Apply the interactive proposal database migration.",
      code: "INTERACTIVE_PROPOSAL_SCHEMA_REQUIRED",
    });
  }
  if (error instanceof InteractiveProposalConflictError) {
    return res.status(409).json({ error: error.message });
  }
  console.error("[InteractiveProposal]", error);
  return res.status(500).json({ error: "Interactive proposal request failed." });
}

function mergeStaffDefinition(
  source: InteractiveProposalDefinition,
  requested: any
): InteractiveProposalDefinition {
  return normalizeInteractiveProposalDefinition({
    ...source,
    ...requested,
    customerName: source.customerName,
    sourceQuoteId: source.sourceQuoteId,
    basePrice: source.basePrice,
    panel: {
      ...source.panel,
      ...(requested?.panel || {}),
      label: source.panel.label,
      wattage: source.panel.wattage,
      baseCount: source.panel.baseCount,
    },
    inverter: {
      ...source.inverter,
      ...(requested?.inverter || {}),
    },
    battery: {
      ...source.battery,
      ...(requested?.battery || {}),
    },
    structure: {
      ...source.structure,
      ...(requested?.structure || {}),
    },
  });
}

function validateShareDefinition(definition: InteractiveProposalDefinition): string | null {
  if (!definition.sourceQuoteId) return "A saved source quotation is required.";
  if (definition.basePrice <= 0) return "The saved quotation must have a valid net price.";
  if (
    definition.panel.minCount !== definition.panel.maxCount &&
    definition.panel.unitPrice <= 0
  ) {
    return "Enter the selling price per additional panel, or keep the panel quantity fixed.";
  }
  return null;
}

export function registerInteractiveProposalRoutes(
  app: Express,
  deps: InteractiveProposalRouteDeps
) {
  app.get("/api/interactive-proposals", async (req, res) => {
    const leadId = String(req.query?.leadId || "").trim();
    const quotationId = String(req.query?.quotationId || "").trim();
    if (!leadId || !quotationId) {
      return res.status(400).json({ error: "leadId and quotationId are required." });
    }
    const source = await deps.resolveSourceQuote(req, res, leadId, quotationId);
    if (!source) return;
    try {
      const records = await deps.resolveStore().listForQuote(leadId, quotationId);
      return res.json({
        proposals: records.map((record) => ({
          id: record.id,
          status: record.status,
          currentConfig: record.currentConfig,
          acceptedCalculation: record.acceptedCalculation,
          acceptedByName: record.acceptedByName,
          createdAt: record.createdAt,
          viewedAt: record.viewedAt,
          modifiedAt: record.modifiedAt,
          acceptedAt: record.acceptedAt,
          expiresAt: record.expiresAt,
        })),
      });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  app.post("/api/interactive-proposals", async (req, res) => {
    const leadId = String(req.body?.leadId || "").trim();
    const quotationId = String(req.body?.quotationId || "").trim();
    if (!leadId || !quotationId) {
      return res.status(400).json({ error: "leadId and quotationId are required." });
    }

    const source = await deps.resolveSourceQuote(req, res, leadId, quotationId);
    if (!source) return;

    try {
      const baseDefinition = quoteToInteractiveProposalDefinition(source.quote, source.lead);
      const definition = {
        ...mergeStaffDefinition(baseDefinition, req.body?.definition),
        originalQuoteSnapshot: snapshotOriginalQuotation(source.quote),
      } as InteractiveProposalDefinition;
      const validationError = validateShareDefinition(definition);
      if (validationError) return res.status(422).json({ error: validationError });

      const expiresInDays = Math.max(
        1,
        Math.min(60, Math.round(Number(req.body?.expiresInDays) || 14))
      );
      const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
      const actor = req.actor;
      const created = await deps.resolveStore().create({
        leadId,
        quotationId,
        definition,
        initialConfig: defaultInteractiveProposalConfig(definition),
        createdBy: actor?.username || actor?.id || "staff",
        expiresAt,
      });
      await deps.afterMutation?.();
      await deps.appendActivity?.({
        req,
        action: "Interactive Proposal Shared",
        details: `Created an expiring client configuration link for quote ${quotationId}.`,
      });

      return res.status(201).json({
        id: created.record.id,
        status: created.record.status,
        publicPath: `/proposal/${created.token}`,
        expiresAt: created.record.expiresAt,
      });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  app.post("/api/interactive-proposals/:id/revoke", async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Proposal id is required." });
    try {
      const store = deps.resolveStore();
      const record = await store.findById(id);
      if (!record) return res.status(404).json({ error: "Interactive proposal not found." });
      const source = await deps.resolveSourceQuote(req, res, record.leadId, record.quotationId);
      if (!source) return;
      const revoked = await store.revoke(record);
      await deps.afterMutation?.();
      await deps.appendActivity?.({
        req,
        action: "Interactive Proposal Revoked",
        details: `Revoked client configuration link for quote ${record.quotationId}.`,
      });
      return res.json({ id: revoked.id, status: revoked.status });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  app.get("/api/public/interactive-proposals/:token", async (req, res) => {
    const token = proposalToken(req.params.token);
    if (!token) return proposalUnavailable(res);
    try {
      const store = deps.resolveStore();
      let record = await store.findByToken(token);
      if (!record || record.status === "Revoked" || record.status === "Expired") {
        return proposalUnavailable(res);
      }
      record = await store.markViewed(record);
      await deps.afterMutation?.();
      return res.json(publicPayload(record));
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  app.post("/api/public/interactive-proposals/:token/preview", async (req, res) => {
    const token = proposalToken(req.params.token);
    if (!token) return proposalUnavailable(res);
    try {
      const store = deps.resolveStore();
      const record = await store.findByToken(token);
      if (!record || record.status === "Revoked" || record.status === "Expired") {
        return proposalUnavailable(res);
      }
      if (record.status === "Accepted") {
        return res.status(409).json({
          error: "This proposal has already been accepted.",
          proposal: publicPayload(record),
        });
      }
      const calculation = calculateInteractiveProposal(
        record.definition,
        (req.body?.configuration || {}) as Partial<InteractiveProposalConfig>
      );
      const updated = await store.savePreview(
        record,
        calculation.configuration,
        calculation
      );
      await deps.afterMutation?.();
      return res.json({
        status: updated.status,
        configuration: calculation.configuration,
        calculation,
      });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });

  app.post("/api/public/interactive-proposals/:token/accept", async (req, res) => {
    const token = proposalToken(req.params.token);
    if (!token) return proposalUnavailable(res);
    const acceptedByName = String(req.body?.acceptedByName || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 120);
    if (acceptedByName.length < 2) {
      return res.status(422).json({ error: "Please enter your name to confirm acceptance." });
    }

    try {
      const store = deps.resolveStore();
      const record = await store.findByToken(token);
      if (!record || record.status === "Revoked" || record.status === "Expired") {
        return proposalUnavailable(res);
      }
      const calculation = calculateInteractiveProposal(
        record.definition,
        (req.body?.configuration || record.currentConfig) as Partial<InteractiveProposalConfig>
      );
      const accepted = await store.accept(record, calculation, acceptedByName);
      await deps.afterMutation?.();
      await deps.appendActivity?.({
        req,
        action: "Interactive Proposal Accepted",
        details: `Client accepted configuration for quote ${record.quotationId} at Rs. ${calculation.totalPrice.toLocaleString("en-PK")}.`,
      });
      return res.json({
        status: accepted.status,
        acceptedAt: accepted.acceptedAt,
        acceptedByName: accepted.acceptedByName,
        calculation: accepted.acceptedCalculation,
      });
    } catch (error) {
      return sendRouteError(res, error);
    }
  });
}
