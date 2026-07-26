/**
 * WS-MAP-0 — shared fail-closed denial for the legacy supplier-mapping bypass.
 *
 * Both pricingRoutes and supplierRoutes historically registered
 * POST /api/marketplace/admin/suppliers/mappings. This module keeps their
 * denial response identical so mount-order changes cannot restore creation.
 */
import type { Request, Response } from "express";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "./catalogue/catalogueTypes.ts";

export const LEGACY_MAPPING_DISABLED_CODE = "LEGACY_MAPPING_DISABLED";
export const LEGACY_MAPPING_DISABLED_MESSAGE =
  "Legacy supplier mapping is disabled.";

/** Stable sanitized HTTP body — no actor/body/header reflection. */
export const LEGACY_MAPPING_DISABLED_BODY = {
  error: LEGACY_MAPPING_DISABLED_CODE,
  message: LEGACY_MAPPING_DISABLED_MESSAGE,
} as const;

export const LEGACY_MAPPING_DISABLED_STATUS = 410;

/**
 * Express handler that permanently denies legacy mapping upsert.
 * Does not read the request body, does not call repositories/RPCs,
 * and does not write audit payloads.
 */
export function denyLegacySupplierMapping(
  _req: Request,
  res: Response,
): Response {
  res.setHeader(MARKETPLACE_API_VERSION_HEADER, MARKETPLACE_API_VERSION);
  return res
    .status(LEGACY_MAPPING_DISABLED_STATUS)
    .json({ ...LEGACY_MAPPING_DISABLED_BODY });
}
