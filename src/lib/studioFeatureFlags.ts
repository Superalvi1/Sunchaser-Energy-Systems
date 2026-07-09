/**
 * Production gating for Solar Proposal Studio, Roof Intelligence Studio,
 * and Sunchaser Design Studio (HelioScope workflow).
 *
 * Off unless the corresponding VITE_* flag is exactly "true" at build time.
 * Default: disabled.
 */

export const PROPOSAL_STUDIO_ENV_KEY = "VITE_ENABLE_PROPOSAL_STUDIO";
export const ROOF_STUDIO_ENV_KEY = "VITE_ENABLE_ROOF_STUDIO";
export const SUNCHASER_DESIGN_STUDIO_ENV_KEY = "VITE_ENABLE_SUNCHASER_DESIGN_STUDIO";

function envFlagTrue(key: string): boolean {
  const raw = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[key];
  return String(raw ?? "").trim().toLowerCase() === "true";
}

/** True only when VITE_ENABLE_PROPOSAL_STUDIO=true at build time. */
export function isProposalStudioEnabled(): boolean {
  return envFlagTrue(PROPOSAL_STUDIO_ENV_KEY);
}

/** True only when VITE_ENABLE_ROOF_STUDIO=true at build time. */
export function isRoofStudioEnabled(): boolean {
  return envFlagTrue(ROOF_STUDIO_ENV_KEY);
}

/** True only when VITE_ENABLE_SUNCHASER_DESIGN_STUDIO=true at build time. */
export function isSunchaserDesignStudioEnabled(): boolean {
  return envFlagTrue(SUNCHASER_DESIGN_STUDIO_ENV_KEY);
}
