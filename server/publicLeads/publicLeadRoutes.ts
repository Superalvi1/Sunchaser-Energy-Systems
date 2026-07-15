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

export type PublicLeadRouterDeps = {
  persistLead: PersistPublicLeadFn;
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

  router.post("/leads", rateLimit, async (req, res) => {
    try {
      const auth = authenticatePublicLeadRequest(req, env);
      if (auth.ok === false) {
        return res.status(auth.status).json({ error: auth.error });
      }

      const contentLength = Number(req.headers["content-length"] || 0);
      if (Number.isFinite(contentLength) && contentLength > PUBLIC_LEAD_MAX_BODY_BYTES) {
        return res.status(400).json({ error: "Payload too large." });
      }

      const validation = validatePublicLeadPayload(req.body, {
        rawBodyBytes: estimateJsonBodyBytes(req.body),
      });
      if (validation.ok === false) {
        return res.status(validation.status).json({ error: validation.error });
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
        success: true,
        leadId,
        message: "Lead created",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create lead.";
      console.error("[public-leads] persistence failure:", message);
      return res.status(500).json({ error: "Failed to create lead." });
    }
  });

  return router;
}
