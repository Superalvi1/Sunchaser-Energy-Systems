/**
 * Production gating for Solar Proposal Studio, Roof Intelligence Studio,
 * and Sunchaser Design Studio (CRM-integrated Design Project / HelioScope workflow).
 *
 * Canonical Design Project flag: VITE_ENABLE_SUNCHASER_DESIGN_STUDIO
 * - Enabled when env is missing / empty / "true"
 * - Explicitly disabled only when value is "false"
 *
 * Legacy: VITE_ENABLE_ROOF_STUDIO remains opt-in ("true" only) and can still
 * unlock Design Project for older deployments.
 *
 * Proposal Studio stays opt-in (default off).
 */

export const PROPOSAL_STUDIO_ENV_KEY = "VITE_ENABLE_PROPOSAL_STUDIO";
export const ROOF_STUDIO_ENV_KEY = "VITE_ENABLE_ROOF_STUDIO";
export const SUNCHASER_DESIGN_STUDIO_ENV_KEY = "VITE_ENABLE_SUNCHASER_DESIGN_STUDIO";

function readViteEnv(key: string): string | undefined {
  return (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[key];
}

/** Opt-in: true only when the raw value is exactly "true" (case-insensitive). */
export function parseStudioEnvFlagTrue(raw: string | undefined | null): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
}

/**
 * Enabled-by-default: true when missing/empty/"true";
 * false only when the raw value is "false" (case-insensitive).
 */
export function parseStudioEnvFlagEnabledByDefault(raw: string | undefined | null): boolean {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "") return true;
  return value !== "false";
}

/** True only when VITE_ENABLE_PROPOSAL_STUDIO=true at build time. */
export function isProposalStudioEnabled(): boolean {
  return parseStudioEnvFlagTrue(readViteEnv(PROPOSAL_STUDIO_ENV_KEY));
}

/**
 * Legacy opt-in flag (VITE_ENABLE_ROOF_STUDIO=true).
 * Does not change the main Design Project default; used for backward compatibility.
 */
export function isRoofStudioEnabled(): boolean {
  return parseStudioEnvFlagTrue(readViteEnv(ROOF_STUDIO_ENV_KEY));
}

/**
 * Canonical Design Studio / Design Project gate.
 * Enabled when VITE_ENABLE_SUNCHASER_DESIGN_STUDIO is missing;
 * disabled only when set to "false".
 */
export function isSunchaserDesignStudioEnabled(): boolean {
  return parseStudioEnvFlagEnabledByDefault(readViteEnv(SUNCHASER_DESIGN_STUDIO_ENV_KEY));
}

/**
 * CRM Sales Advisor "Roof Studio" / Design Project tab.
 * Routes to Project Design Workspace (not standalone Roof Intelligence Studio).
 * On when canonical Design Studio is enabled, or legacy ROOF_STUDIO=true.
 */
export function isDesignProjectEnabled(): boolean {
  return isSunchaserDesignStudioEnabled() || isRoofStudioEnabled();
}
