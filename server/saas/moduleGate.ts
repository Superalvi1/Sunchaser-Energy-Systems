import { isMultiCompanyEnabled } from "./multiCompany.ts";
import { usesNeutralIdentity } from "./companyIdentity.ts";

/**
 * Modules that are not finished for companies other than the founding one. They are refused by the API and hidden by the interface,
 * from the same switch, so a pilot company can neither open nor call them.
 *
 *  autoSizer  The AutoSizer builds a bill of quantities from Sunchaser's own price list and equipment presets. There is no per-company
 *             price book yet, so another company would silently be quoted Sunchaser's prices. Disabled until a price book exists.
 *
 * Single-company mode and the founding company see every module exactly as before.
 */
export type ModuleFlags = { autoSizer: boolean };

export function moduleFlags(env: NodeJS.ProcessEnv = process.env): ModuleFlags {
  const all = !isMultiCompanyEnabled(env) || !usesNeutralIdentity(env);
  return { autoSizer: all };
}

export const AUTOSIZER_DISABLED_MESSAGE =
  "AutoSizer is not available for your company yet: it needs a company price book. Use the Manual BOQ Builder.";
