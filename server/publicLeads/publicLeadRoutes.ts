import { createHash } from "node:crypto";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { authenticatePublicLeadRequest } from "./publicLeadAuth.ts";
import {
  defaultPublicLeadIdempotencyStore,
  readIdempotencyKeyFromHeaders,
  type IdempotencyStore,
} from "./publicLeadIdempotency.ts";
import { createPublicLeadRateLimit } from "./publicLeadRateLimit.ts";
import {
  createPublicLead,
  type PersistPublicLeadFn,
} from "./publicLeadService.ts";
import {
  estimateJsonBodyBytes,
  PUBLIC_LEAD_MAX_BODY_BYTES,
  validatePublicLeadPayload,
} from "./publicLeadValidation.ts";
import { createQuotePdfUploadToken, verifyQuotePdfUploadToken, parseQuotePdfBase64 } from "./smartQuotePdfArchive";
import { toPublicLeadInput, validateSmartQuoteLeadPayload, type SmartQuoteLeadInput } from "./smartQuoteLead.ts";
import { SmartQuoteVersionsUnavailableError, type SaveSmartQuoteResult } from "./smartQuoteVersions.ts";

export type PublicLeadRouterDeps = {
  persistLead: PersistPublicLeadFn;
  /** Durable versioned save; when absent or not yet migrated, the legacy one-lead-per-quote path is used. */
  saveSmartQuote?: (input: SmartQuoteLeadInput) => Promise<SaveSmartQuoteResult>;
  archivePdf?: (leadId: string, quoteNumber: string, pdf: Buffer) => Promise<import("./smartQuotePdfArchive").SmartQuotePdfArchive>;
  issuePdfUploadToken?: (leadId: string, quoteNumber: string) => string;
  idempotencyStore?: IdempotencyStore;
  rateLimit?: (req: Request, res: Response, next: NextFunction) => void;
  env?: NodeJS.ProcessEnv;
};

/**
 * Secure public lead gateway — POST /api/public/leads
 * Auth: X-Public-Lead-Key or Authorization: Bearer <PUBLIC_LEAD_API_KEY>
 */
export function createPublicLeadRouter(deps: PublicLeadRouterDeps): Router {
  const router = express.Router();
  const idempotencyStore =
    deps.idempotencyStore ?? defaultPublicLeadIdempotencyStore;
  const rateLimit = deps.rateLimit ?? createPublicLeadRateLimit();
  const env = deps.env ?? process.env;
  const uploadToken = deps.issuePdfUploadToken ?? (deps.archivePdf ? createQuotePdfUploadToken : () => undefined);

  router.get("/leads", (_req, res) => {
    return res
      .status(405)
      .set("Allow", "POST")
      .json({ ok: false, error: "Method not allowed." });
  });

  router.post("/leads", rateLimit, async (req, res) => {
    try {
      const auth = authenticatePublicLeadRequest(req, env);
      if (auth.ok === false) {
        return res.status(auth.status).json({ ok: false, error: auth.error });
      }

      const contentLength = Number(req.headers["content-length"] || 0);
      if (
        (Number.isFinite(contentLength) && contentLength > PUBLIC_LEAD_MAX_BODY_BYTES) ||
        estimateJsonBodyBytes(req.body) > PUBLIC_LEAD_MAX_BODY_BYTES
      ) {
        return res.status(400).json({ ok: false, error: "Payload too large." });
      }

      const validation = validatePublicLeadPayload(req.body, {
        rawBodyBytes: estimateJsonBodyBytes(req.body),
      });
      if (validation.ok === false) {
        return res
          .status(validation.status)
          .json({ ok: false, error: validation.error });
      }

      const idempotencyKey = readIdempotencyKeyFromHeaders(
        req.headers as Record<string, unknown>
      );
      if (idempotencyKey) {
        const existing = idempotencyStore.get(idempotencyKey);
        if (existing) {
          console.info(
            `[public-leads] idempotent replay key=${idempotencyKey} leadId=${existing.leadId}`
          );
          return res.status(200).json({
            ok: true,
            success: true,
            leadId: existing.leadId,
            message: "Lead created",
          });
        }
      }

      const { leadId } = await createPublicLead(validation.value, deps.persistLead);

      if (idempotencyKey) {
        idempotencyStore.set(idempotencyKey, {
          leadId,
          createdAtMs: Date.now(),
        });
      }

      console.info(`[public-leads] created leadId=${leadId}`);
      return res.status(201).json({
        ok: true,
        success: true,
        leadId,
        message: "Lead created",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create lead.";
      console.error("[public-leads] persistence failure:", message);
      return res.status(500).json({ ok: false, error: "Failed to create lead." });
    }
  });

  router.get("/smart-quotes", (_req, res) => {
    return res.status(405).set("Allow", "POST").json({ ok: false, error: "Method not allowed." });
  });

  // Public, no-login Smart Quote capture. Strict validation, per-IP rate limiting,
  // server-owned source/notes, and idempotency keep this narrow endpoint safe.
  router.post("/smart-quotes", rateLimit, async (req, res) => {
    try {
      const contentLength = Number(req.headers["content-length"] || 0);
      if (
        (Number.isFinite(contentLength) && contentLength > 64 * 1024) ||
        estimateJsonBodyBytes(req.body) > 64 * 1024
      ) {
        return res.status(400).json({ ok: false, error: "Payload too large." });
      }
      const validation = validateSmartQuoteLeadPayload(req.body);
      if (validation.ok === false) {
        return res.status(validation.status).json({ ok: false, error: validation.error });
      }

      if (deps.saveSmartQuote) {
        try {
          const saved = await deps.saveSmartQuote(validation.value);
          if (saved.kind === "conflict") {
            return res.status(409).json({ ok: false, error: "This quotation number is already in use. Generate a new quotation." });
          }
          console.info(`[smart-quotes] ${saved.kind} leadId=${saved.leadId} quote=${validation.value.quoteNumber} version=${saved.versionNumber}`);
          return res.status(saved.kind === "created" ? 201 : 200).json({
            ok: true,
            success: true,
            leadId: saved.leadId,
            versionNumber: saved.versionNumber,
            pdfUploadToken: uploadToken(saved.leadId, validation.value.quoteNumber),
            message: "Smart Quote saved",
          });
        } catch (error) {
          if (!(error instanceof SmartQuoteVersionsUnavailableError)) throw error;
          console.warn("[smart-quotes] version history table missing; using legacy lead capture.");
        }
      }

      const idempotencyKey =
        readIdempotencyKeyFromHeaders(req.headers as Record<string, unknown>) ||
        `smart-quote:${validation.value.quoteNumber}`;
      const quoteFingerprint = createHash("sha256").update(JSON.stringify(validation.value)).digest("hex");
      const existing = idempotencyStore.get(idempotencyKey);
      if (existing) {
        if (existing.quoteFingerprint !== quoteFingerprint) return res.status(409).json({ error: "This quotation number is already in use. Generate a new quotation." });
        return res.status(200).json({ ok: true, success: true, leadId: existing.leadId, pdfUploadToken: uploadToken(existing.leadId, validation.value.quoteNumber), message: "Smart Quote lead saved" });
      }

      const { leadId } = await createPublicLead(toPublicLeadInput(validation.value), deps.persistLead);
      idempotencyStore.set(idempotencyKey, { leadId, createdAtMs: Date.now(), quoteFingerprint });
      console.info(`[smart-quotes] created leadId=${leadId} quote=${validation.value.quoteNumber}`);
      return res.status(201).json({ ok: true, success: true, leadId, pdfUploadToken: uploadToken(leadId, validation.value.quoteNumber), message: "Smart Quote lead saved" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save Smart Quote lead.";
      console.error("[smart-quotes] persistence failure:", message);
      return res.status(500).json({ ok: false, error: "Could not save your details. Please try again." });
    }
  });

  // A short-lived capability issued after lead capture authorizes this PDF only.
  router.post("/smart-quote-pdf", rateLimit, async (req, res) => {
    const { leadId, quoteNumber, uploadToken: token, pdfBase64 } = req.body || {};
    try {
      if (typeof leadId !== "string" || typeof quoteNumber !== "string" || typeof token !== "string" || !verifyQuotePdfUploadToken(leadId, quoteNumber, token)) return res.status(403).json({ error: "Quotation upload authorization is invalid or expired. Generate your quotation again." });
      let pdf: Buffer;
      try { pdf = parseQuotePdfBase64(pdfBase64); } catch { return res.status(400).json({ error: "A valid PDF of up to 5 MB is required." }); }
      if (!deps.archivePdf) return res.status(503).json({ error: "CRM PDF archiving is unavailable. Please try again." });
      const archive = await deps.archivePdf(leadId, quoteNumber, pdf);
      return res.status(201).json({ ok: true, archive });
    } catch (error) {
      console.error("[smart-quote-pdf] archive failed:", error instanceof Error ? error.message : error);
      return res.status(500).json({ error: "Your PDF could not be saved to the CRM. Please try Save PDF again." });
    }
  });
  return router;
}
