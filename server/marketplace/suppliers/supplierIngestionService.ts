/**
 * WS4 supplier price-check job — manual and scheduled share this service.
 * Live adapters fail closed; fixture/manual observations supported for tests.
 */
import type { SupplierAdapter, SupplierMappingRow } from "./adapterTypes.ts";
import { WS4_JOB_NAME } from "./adapterTypes.ts";
import { createAlladinAdapter } from "./alladinAdapter.ts";
import { createKamalAdapter } from "./kamalAdapter.ts";
import {
  isMappingPublishEligible,
  mappingRejectionReason,
} from "./evidenceBlockers.ts";
import { SHOPIFY_STOREFRONT_PRODUCTS_JSON } from "./liveCatalogueTypes.ts";
import { PHASE1_LIVE_PUBLICATION_ALLOWED } from "./liveCatalogueService.ts";
import { isScheduledPublicationAllowed } from "./liveSupplierConfig.ts";
import type { SupplierRepository } from "./supplierRepository.ts";
import { createSupabaseSupplierRepository } from "./supplierRepository.ts";
import { SupplierError, type PriceCheckRunResultDto } from "./supplierTypes.ts";

export type IngestionTrigger = "manual" | "scheduled";

export type SupplierIngestionServiceDeps = {
  repository?: SupplierRepository;
  kamalAdapter?: SupplierAdapter;
  alladinAdapter?: SupplierAdapter;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

function hoursAgoIso(hours: number, now: Date): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString();
}

function safetyBreaches(
  current: number | null,
  candidate: number,
  maxInc: number,
  maxDec: number,
): boolean {
  if (current == null || current <= 0) return false;
  const pct = ((candidate - current) / current) * 100;
  return pct > maxInc || pct < -maxDec;
}

export function createSupplierIngestionService(
  deps: SupplierIngestionServiceDeps = {},
) {
  const env = deps.env ?? process.env;
  const repo = deps.repository ?? createSupabaseSupplierRepository();
  const kamal = deps.kamalAdapter ?? createKamalAdapter({ env });
  const alladin = deps.alladinAdapter ?? createAlladinAdapter({ env });
  const now = deps.now ?? (() => new Date());

  const adapters: Record<"kamal" | "alladin", SupplierAdapter> = {
    kamal,
    alladin,
  };

  async function assertScheduledAllowed(trigger: IngestionTrigger): Promise<void> {
    if (trigger !== "scheduled") return;
    // Phase 1: scheduled production publication remains disabled.
    if (!isScheduledPublicationAllowed(env)) {
      throw new SupplierError(
        503,
        "ADAPTER_NOT_AUTHORIZED",
        "Scheduled supplier publication is disabled in Phase 1 (preview-only). Use Super Admin live preview.",
      );
    }
    const anyLive = kamal.isLiveEnabled(env) || alladin.isLiveEnabled(env);
    if (!anyLive) {
      throw new SupplierError(
        503,
        "ADAPTER_NOT_AUTHORIZED",
        "Scheduled supplier price-check fail-closed: no authorized live adapter configured. Manual-only operation is insufficient for production release.",
      );
    }
  }

  async function runPriceCheck(input: {
    trigger: IngestionTrigger;
    actorScope: string;
    changedBy: string;
  }): Promise<PriceCheckRunResultDto> {
    await assertScheduledAllowed(input.trigger);

    let runId: string | null = null;
    const supplierFailures: PriceCheckRunResultDto["supplierFailures"] = [];
    let observationsInserted = 0;
    let alertsCreated = 0;
    let variantsPublished = 0;
    const variantsToPublish = new Set<string>();

    try {
      const started = await repo.startJob(input.trigger, input.actorScope, {
        jobName: WS4_JOB_NAME,
        productionReady: false,
      });
      runId = started.runId;

      const config = await repo.getPricingConfig();
      const mappings = await repo.listActiveMappings(input.actorScope);

      // Process Kamal before Alladin (priority order).
      const ordered = [
        ...mappings.filter((m) => m.supplierCode === "kamal"),
        ...mappings.filter((m) => m.supplierCode === "alladin"),
      ];

      for (const mapping of ordered) {
        try {
          await processMapping(mapping, {
            runId: runId!,
            actorScope: input.actorScope,
            config,
            variantsToPublish,
            onAlert: () => {
              alertsCreated += 1;
            },
            onObservation: () => {
              observationsInserted += 1;
            },
            onFailure: (f) => supplierFailures.push(f),
          });
        } catch (err) {
          // Isolate individual supplier/mapping failures.
          supplierFailures.push({
            supplierCode: mapping.supplierCode,
            mappingId: mapping.id,
            failureClass: "transport_error",
            message: err instanceof Error ? err.message : "mapping failed",
          });
        }
      }

      for (const variantId of variantsToPublish) {
        const published = await repo.publishPrice(
          variantId,
          input.actorScope.startsWith("admin:super")
            ? input.actorScope
            : `system:ws4:${input.changedBy}`,
          input.changedBy,
        );
        variantsPublished += 1;
        if (published.websitePriceState === "confirm_price") {
          const mapping = ordered.find((m) => m.variantId === variantId);
          await repo.createAlert({
            actorScope: input.actorScope,
            runId,
            productId: mapping?.productId ?? null,
            variantId,
            alertType: "no_safe_price",
            severity: "warning",
            message: "No safe supplier price; confirm_price fallback applied.",
          });
          alertsCreated += 1;
        }
      }

      await repo.finishJob(runId, "succeeded", input.actorScope, null, {
        observationsInserted,
        alertsCreated,
        variantsPublished,
        supplierFailureCount: supplierFailures.length,
        productionReady: false,
      });

      return {
        runId,
        status: "succeeded",
        trigger: input.trigger,
        observationsInserted,
        alertsCreated,
        variantsPublished,
        supplierFailures,
        productionReady: false,
        note: "Manual-only / fixture operation is insufficient for production release until an authorized live adapter is configured.",
      };
    } catch (err) {
      if (runId) {
        const message = err instanceof Error ? err.message : "job failed";
        try {
          await repo.finishJob(runId, "failed", input.actorScope, message, {
            productionReady: false,
          });
        } catch {
          /* durable best-effort */
        }
      }
      throw err;
    }
  }

  async function processMapping(
    mapping: SupplierMappingRow,
    ctx: {
      runId: string;
      actorScope: string;
      config: {
        maxIncreasePct: number;
        maxDecreasePct: number;
        stalenessHours: number;
      };
      variantsToPublish: Set<string>;
      onAlert: () => void;
      onObservation: () => void;
      onFailure: (f: PriceCheckRunResultDto["supplierFailures"][number]) => void;
    },
  ): Promise<void> {
    const reject = mappingRejectionReason(mapping);
    if (reject) {
      await ctxCreateAlert(ctx, mapping, reject, "warning", reject);
      // Still attempt fetch for append-only observability when fixture present.
    }

    const adapter = adapters[mapping.supplierCode];
    const fetched = await adapter.fetchObservation(mapping, { env });
    if (fetched.ok === false) {
      ctx.onFailure({
        supplierCode: fetched.supplierCode,
        mappingId: fetched.mappingId,
        failureClass: fetched.failureClass,
        message: fetched.message,
      });
      if (
        fetched.failureClass === "disabled" ||
        fetched.failureClass === "not_configured"
      ) {
        await ctxCreateAlert(
          ctx,
          mapping,
          "supplier_evidence_gap",
          "info",
          fetched.message,
        );
      }
      return;
    }

    const obs = fetched.observation;
    const observedAt = new Date(obs.observedAt);
    const staleCutoff = new Date(
      now().getTime() - ctx.config.stalenessHours * 3600_000,
    );
    const isStale = Number.isFinite(observedAt.getTime())
      ? observedAt < staleCutoff
      : true;

    await repo.insertObservation({
      actorScope: ctx.actorScope,
      mappingId: mapping.id,
      runId: ctx.runId,
      observedAt: obs.observedAt,
      supplierPublicPrice: obs.supplierPublicPrice,
      currency: obs.currency,
      availability: obs.availability,
      parseStatus: obs.parseStatus,
      evidence: obs.evidence,
    });
    ctx.onObservation();

    if (obs.parseStatus === "malformed") {
      await ctxCreateAlert(ctx, mapping, "malformed", "warning", "Malformed supplier parse.");
    } else if (obs.parseStatus === "missing") {
      await ctxCreateAlert(
        ctx,
        mapping,
        "supplier_evidence_gap",
        "warning",
        "Missing supplier price fields.",
      );
    }

    if (obs.availability === "sold_out") {
      await ctxCreateAlert(ctx, mapping, "soldout", "info", "Supplier sold out.");
    } else if (obs.availability === "backorder") {
      await ctxCreateAlert(ctx, mapping, "backorder", "info", "Supplier backorder.");
    } else if (obs.availability === "unknown") {
      await ctxCreateAlert(
        ctx,
        mapping,
        "unknown_stock",
        "info",
        "Supplier stock unknown.",
      );
    }

    if (isStale) {
      await ctxCreateAlert(ctx, mapping, "stale", "warning", "Supplier observation stale.");
    }

    if (
      obs.supplierPublicPrice != null &&
      (!Number.isFinite(obs.supplierPublicPrice) || obs.supplierPublicPrice <= 0)
    ) {
      await ctxCreateAlert(
        ctx,
        mapping,
        "malformed",
        "warning",
        "Non-positive supplier price rejected.",
      );
    }

    if (mapping.matchConfidence === "conflict") {
      await ctxCreateAlert(ctx, mapping, "conflict", "critical", "Mapping conflict.");
    }

    if (!isMappingPublishEligible(mapping)) {
      return;
    }

    // Phase 1: never auto-publish live Shopify observations.
    const evidenceSource = obs.evidence?.source;
    if (
      evidenceSource === SHOPIFY_STOREFRONT_PRODUCTS_JSON &&
      !PHASE1_LIVE_PUBLICATION_ALLOWED
    ) {
      await ctxCreateAlert(
        ctx,
        mapping,
        "no_safe_price",
        "info",
        "Live observation captured for preview only; publication disabled in Phase 1.",
      );
      return;
    }

    const eligibleAuto =
      !isStale &&
      obs.parseStatus === "ok" &&
      obs.availability === "in_stock" &&
      obs.supplierPublicPrice != null &&
      obs.supplierPublicPrice > 0;

    if (!eligibleAuto) return;

    const current = await repo.getVariantWebsitePrice(mapping.variantId);
    if (
      safetyBreaches(
        current,
        obs.supplierPublicPrice!,
        ctx.config.maxIncreasePct,
        ctx.config.maxDecreasePct,
      )
    ) {
      await ctxCreateAlert(
        ctx,
        mapping,
        "safety_breach",
        "critical",
        "Supplier price exceeds configured safety margins.",
      );
      // Still queue publish so mp_publish_price can skip unsafe candidates and fall back.
    }

    ctx.variantsToPublish.add(mapping.variantId);
  }

  async function ctxCreateAlert(
    ctx: {
      runId: string;
      actorScope: string;
      onAlert: () => void;
    },
    mapping: SupplierMappingRow,
    alertType: string,
    severity: string,
    message: string,
  ): Promise<void> {
    await repo.createAlert({
      actorScope: ctx.actorScope,
      runId: ctx.runId,
      productId: mapping.productId,
      variantId: mapping.variantId,
      alertType,
      severity,
      message,
    });
    ctx.onAlert();
  }

  return {
    runPriceCheck,
    /** Exposed for tests / docs */
    hoursAgoIso: (h: number) => hoursAgoIso(h, now()),
  };
}
