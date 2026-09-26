import { Router } from "express";
import {
  getLearningStudioUrl,
  normalizeLearningNextPath,
  signLearningSsoTicket,
} from "./learningSso.ts";

function featureEnabled(): boolean {
  const raw = String(process.env.LEARNING_STUDIO_ENABLED || "false").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function createLearningRouter(): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    if (!featureEnabled()) {
      return res.status(404).json({ error: "Learning Studio is disabled." });
    }
    return res.json({
      enabled: true,
      configured: Boolean(process.env.LEARNING_STUDIO_URL && process.env.LEARNING_SSO_SECRET),
    });
  });

  router.post("/sso-ticket", (req, res) => {
    if (!featureEnabled()) {
      return res.status(404).json({ error: "Learning Studio is disabled." });
    }
    if (!req.actor) return res.status(401).json({ error: "Unauthorized" });

    try {
      const next = normalizeLearningNextPath(req.body?.next);
      const token = signLearningSsoTicket(req.actor);
      return res.json({
        action: getLearningStudioUrl() + "/api/sunchaser-sso",
        method: "POST",
        token,
        next,
        expiresInSeconds: 90,
      });
    } catch (error) {
      console.error("[Learning Studio SSO]", error instanceof Error ? error.message : error);
      return res.status(503).json({ error: "Learning Studio is not configured." });
    }
  });

  return router;
}
