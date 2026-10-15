import { isMultiCompanyEnabled } from "./multiCompany.ts";
import { usesNeutralIdentity } from "./companyIdentity.ts";

/**
 * Modules that are not finished for companies other than the founding one. They are refused by the API and hidden by the interface,
 * from the same switch, so a pilot company can neither open nor call them.
 *
 *  autoSizer  The AutoSizer builds a bill of quantities from Sunchaser's own price list and equipment presets. There is no per-company
 *             price book yet, so another company would silently be quoted Sunchaser's prices. Disabled until a price book exists.
 *

 *  afterSales Delivery challans and certificates, project completion and handover, customer warranties and warranty claims. Their
 *             documents are branded per company (tested), but a delivery challan cannot be created on a database built from this
 *             repository's own schema scripts (the code writes delivery_challans.created_by_user_id, which no script creates), and
 *             the flows were not exercised with two companies. Disabled for pilot companies until they are.
 *
 *  designTools Interactive proposals (client links that re-price a quotation), Proposal Studio (its PDF export falls back to Sunchaser
 *             branding) and Roof Studio (per-lead design sessions, Google map layers). Their pricing and equipment catalogue are
 *             Sunchaser's, and none of them was exercised with two companies. Disabled for pilot companies until company-specific
 *             pricing and isolation are proven.
 *
 *  assistants  The AI assistant widget and the customer-portal "solar sizing wizard". Their prompts and equipment catalogue are Sunchaser's
 *             ("Sunchaser OS", "Sunchaser Core batteries"), and the wizard submits its lead through the public intake, which belongs to
 *             the founding company, so a pilot company's customer would create a lead in Sunchaser's CRM. Disabled for pilot companies.
 *
 * Single-company mode and the founding company see every module exactly as before.
 */
export type ModuleFlags = { autoSizer: boolean; afterSales: boolean; designTools: boolean; assistants: boolean };

export function moduleFlags(env: NodeJS.ProcessEnv = process.env): ModuleFlags {
  const all = !isMultiCompanyEnabled(env) || !usesNeutralIdentity(env);
  return { autoSizer: all, afterSales: all, designTools: all, assistants: all };
}

export const AUTOSIZER_DISABLED_MESSAGE =
  "AutoSizer is not available for your company yet: it needs a company price book. Use the Manual BOQ Builder.";

export const DESIGN_TOOLS_DISABLED_MESSAGE =
  "Interactive proposals, Proposal Studio and Roof Studio are not available for your company yet: they need company-specific pricing. Use the Manual BOQ Builder and the quotation PDF.";
