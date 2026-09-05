/**
 * Server-side AutoSizer preset authorization and patch helpers.
 * UI visibility is not security — routes must call these.
 */

import { canManageAutoSizerPresets } from "../roles";
import {
  mergeAutoSizerPresetsIntoLatestSettings,
  parseCompanyAutoSizerPresets,
  type CompanyAutoSizerPresets,
} from "./companyPresets";

export type AutoSizerPresetsAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

export function authorizeAutoSizerPresetsAccess(
  actor: { username?: string; role?: string } | null | undefined
): AutoSizerPresetsAuthResult {
  if (!actor || !String(actor.role || "").trim()) {
    return { ok: false, status: 401, error: "Authentication required." };
  }
  if (!canManageAutoSizerPresets(String(actor.username || ""), String(actor.role))) {
    return { ok: false, status: 403, error: "Not authorized to change AutoSizer presets." };
  }
  return { ok: true };
}

export function parseIncomingAutoSizerPresets(body: unknown): CompanyAutoSizerPresets {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const record = body as Record<string, unknown>;
  if ("autoSizerPresets" in record) {
    return parseCompanyAutoSizerPresets(record);
  }
  return parseCompanyAutoSizerPresets({ autoSizerPresets: record });
}

export function patchLatestSettingsWithAutoSizerPresets(
  latestSettings: unknown,
  body: unknown
): Record<string, any> {
  const incoming = parseIncomingAutoSizerPresets(body);
  return mergeAutoSizerPresetsIntoLatestSettings(latestSettings, incoming);
}
