/**
 * Super-Admin routes for CEO automatic supplier import + sync health.
 *
 * Canonical mount (server.ts):
 *   /api/marketplace/admin + /suppliers/auto-import/{run,health,listings}
 *
 * Compatibility alias mount (same service instance, same Super-Admin gates):
 *   /api/marketplace/auto-import + /{run,health,listings}
 *
 * Auth is never weakened: central JWT (non-public carve-out) + marketplace
 * lockdown + Super Admin pricing gate on every handler.
 */
import type { Request, Response, Router } from "express";
import express from "express";
import type { RequestActor } from "../../middleware/actor.ts";
import { createMarketplaceRouteLockdown } from "../../middleware/marketplaceRouteLockdown.ts";
import {
  canAccessMarketplacePricing,
  superAdminActorScope,
} from "../MarketplacePermissions.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "../catalogue/catalogueTypes.ts";
import {
  createAutoImportService,
  type AutoImportService,
} from "./autoImportService.ts";
import { logAutoImport, sanitizeAutoImportError } from "./autoImportLog.ts";
import {
  runAutoImportPreflight,
  type AutoImportPreflightDeps,
  type AutoImportPreflightReport,
} from "./autoImportPreflight.ts";
import { findLegacySnapshotGaps } from "./legacySnapshotDiagnostic.ts";
import { resolvePublicCataloguePublication } from "../catalogue/resolveCatalogueRepository.ts";

export type AutoImportRouterDeps = {
  env?: NodeJS.ProcessEnv;
  service?: AutoImportService;
  log?: typeof logAutoImport;
  preflight?: (deps?: AutoImportPreflightDeps) => Promise<AutoImportPreflightReport>;
};

/** Canonical Super-Admin paths (relative to /api/marketplace/admin). */
export const AUTO_IMPORT_ADMIN_RUN_PATH = "/suppliers/auto-import/run";
export const AUTO_IMPORT_ADMIN_HEALTH_PATH = "/suppliers/auto-import/health";
export const AUTO_IMPORT_ADMIN_LISTINGS_PATH = "/suppliers/auto-import/listings";
export const AUTO_IMPORT_ADMIN_PREFLIGHT_PATH = "/suppliers/auto-import/preflight";
export const AUTO_IMPORT_ADMIN_LEGACY_SNAPSHOTS_PATH =
  "/suppliers/auto-import/diagnostics/legacy-snapshots";

/** Compatibility alias paths (relative to /api/marketplace/auto-import). */
export const AUTO_IMPORT_ALIAS_RUN_PATH = "/run";
export const AUTO_IMPORT_ALIAS_HEALTH_PATH = "/health";
export const AUTO_IMPORT_ALIAS_LISTINGS_PATH = "/listings";
export const AUTO_IMPORT_ALIAS_PREFLIGHT_PATH = "/preflight";
export const AUTO_IMPORT_ALIAS_LEGACY_SNAPSHOTS_PATH =
  "/diagnostics/legacy-snapshots";

function setApiVersion(res: Response): void {
  res.setHeader(MARKETPLACE_API_VERSION_HEADER, MARKETPLACE_API_VERSION);
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): Response {
  setApiVersion(res);
  return res.status(status).json({ ok: false, error: { code, message } });
}

function sendOk<T>(res: Response, data: T, status = 200): Response {
  setApiVersion(res);
  return res.status(status).json({ ok: true, data });
}

function requireSuperAdmin(req: Request, res: Response): RequestActor | null {
  const actor = req.actor as RequestActor | undefined;
  if (!actor) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return null;
  }
  if (!canAccessMarketplacePricing(actor)) {
    sendError(
      res,
      403,
      "FORBIDDEN",
      "CEO auto-import requires Super Admin.",
    );
    return null;
  }
  return actor;
}

function attachAutoImportHandlers(
  router: Router,
  deps: {
    service: AutoImportService;
    log: typeof logAutoImport;
    env: NodeJS.ProcessEnv;
    preflight: (
      deps?: AutoImportPreflightDeps,
    ) => Promise<AutoImportPreflightReport>;
    runPath: string;
    healthPath: string;
    listingsPath: string;
    preflightPath: string;
    legacySnapshotsPath: string;
  },
): void {
  const {
    service,
    log,
    env,
    preflight,
    runPath,
    healthPath,
    listingsPath,
    preflightPath,
    legacySnapshotsPath,
  } = deps;

  router.get(preflightPath, async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const report = await preflight({ env });
      return sendOk(res, report, 200);
    } catch (err) {
      const sanitized = sanitizeAutoImportError(err);
      log({
        runId: "route",
        stage: "route_error",
        status: "failed",
        errorClass: sanitized.errorClass,
        errorCode: sanitized.errorCode,
        detail: sanitized.message,
      });
      return sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Unable to run auto-import preflight.",
      );
    }
  });

  router.post(runPath, async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      if (req.headers["x-actor-role"] || req.headers["x-actor-scope"]) {
        return sendError(
          res,
          400,
          "FORBIDDEN_FIELD",
          "Client-supplied actor headers are not allowed.",
        );
      }
      const result = await service.runAutomaticImport({
        actorScope: superAdminActorScope(actor),
      });
      // Service always returns a bounded result (including timeout/RPC failures).
      return sendOk(res, result, 202);
    } catch (err) {
      const sanitized = sanitizeAutoImportError(err);
      log({
        runId: "route",
        stage: "route_error",
        status: "failed",
        errorClass: sanitized.errorClass,
        errorCode: sanitized.errorCode,
        detail: sanitized.message,
      });
      return sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Unable to run automatic supplier import.",
      );
    }
  });

  router.get(healthPath, async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const health = await service.getHealth();
      const publication = resolvePublicCataloguePublication(env);
      return sendOk(res, {
        ...health,
        effectivePublicCatalogueSource:
          publication.effectivePublicCatalogueSource,
        publicWouldShowSyncedProducts:
          publication.publicWouldShowSyncedProducts,
      });
    } catch (err) {
      const sanitized = sanitizeAutoImportError(err);
      log({
        runId: "route",
        stage: "route_error",
        status: "failed",
        errorClass: sanitized.errorClass,
        errorCode: sanitized.errorCode,
        detail: sanitized.message,
      });
      return sendError(res, 500, "INTERNAL_ERROR", "Unable to load sync health.");
    }
  });

  router.get(listingsPath, async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const listings = await service.listListings();
      return sendOk(res, {
        count: listings.length,
        listings: listings.slice(0, 200).map((l) => ({
          identityKey: l.identityKey,
          title: l.title,
          slug: l.slug,
          websitePricePkr: l.websitePricePkr,
          selectedSupplier: l.selectedSupplier,
          availability: l.availability,
          lastSyncedAt: l.lastSyncedAt,
          priceReason: l.priceReason,
          matchReason: l.matchReason,
          sourceUrls: l.sourceUrls,
        })),
      });
    } catch (err) {
      const sanitized = sanitizeAutoImportError(err);
      log({
        runId: "route",
        stage: "route_error",
        status: "failed",
        errorClass: sanitized.errorClass,
        errorCode: sanitized.errorCode,
        detail: sanitized.message,
      });
      return sendError(res, 500, "INTERNAL_ERROR", "Unable to list import listings.");
    }
  });

  router.get(legacySnapshotsPath, async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const listings = await service.listListings();
      return sendOk(res, findLegacySnapshotGaps(listings), 200);
    } catch (err) {
      const sanitized = sanitizeAutoImportError(err);
      log({
        runId: "route",
        stage: "route_error",
        status: "failed",
        errorClass: sanitized.errorClass,
        errorCode: sanitized.errorCode,
        detail: sanitized.message,
      });
      return sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Unable to run legacy snapshot diagnostic.",
      );
    }
  });
}

function buildAutoImportRouter(
  deps: AutoImportRouterDeps,
  paths: {
    runPath: string;
    healthPath: string;
    listingsPath: string;
    preflightPath: string;
    legacySnapshotsPath: string;
  },
): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const service = deps.service ?? createAutoImportService({ env });
  const log = deps.log ?? logAutoImport;
  const preflight = deps.preflight ?? runAutoImportPreflight;

  router.use(createMarketplaceRouteLockdown({ env }));
  attachAutoImportHandlers(router, {
    service,
    log,
    env,
    preflight,
    ...paths,
  });
  return router;
}

/**
 * Canonical router for mount at `/api/marketplace/admin`.
 * Routes: POST/GET `/suppliers/auto-import/{run,health,listings,preflight,diagnostics/legacy-snapshots}`.
 */
export function createMarketplaceAutoImportRouter(
  deps: AutoImportRouterDeps = {},
): Router {
  return buildAutoImportRouter(deps, {
    runPath: AUTO_IMPORT_ADMIN_RUN_PATH,
    healthPath: AUTO_IMPORT_ADMIN_HEALTH_PATH,
    listingsPath: AUTO_IMPORT_ADMIN_LISTINGS_PATH,
    preflightPath: AUTO_IMPORT_ADMIN_PREFLIGHT_PATH,
    legacySnapshotsPath: AUTO_IMPORT_ADMIN_LEGACY_SNAPSHOTS_PATH,
  });
}

/**
 * Compatibility alias for mount at `/api/marketplace/auto-import`.
 * Same Super-Admin authorization and shared service instance when deps.service
 * is passed from server.ts — does not duplicate import logic.
 */
export function createMarketplaceAutoImportAliasRouter(
  deps: AutoImportRouterDeps = {},
): Router {
  return buildAutoImportRouter(deps, {
    runPath: AUTO_IMPORT_ALIAS_RUN_PATH,
    healthPath: AUTO_IMPORT_ALIAS_HEALTH_PATH,
    listingsPath: AUTO_IMPORT_ALIAS_LISTINGS_PATH,
    preflightPath: AUTO_IMPORT_ALIAS_PREFLIGHT_PATH,
    legacySnapshotsPath: AUTO_IMPORT_ALIAS_LEGACY_SNAPSHOTS_PATH,
  });
}
