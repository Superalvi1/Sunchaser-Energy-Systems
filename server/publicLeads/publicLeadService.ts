import { randomUUID } from "crypto";
import type { PublicLeadInput } from "./publicLeadValidation.ts";

export type PersistedPublicLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  location: string;
  monthlyBill: number;
  monthlyUnits: number;
  notes: string;
  leadSource: string;
  status: string;
  createdAt: string;
};

export type PersistPublicLeadFn = (
  lead: PersistedPublicLead
) => Promise<{ leadId: string }>;

export function buildPublicLeadRecord(input: PublicLeadInput): PersistedPublicLead {
  const notesParts = [input.notes, input.message].filter(Boolean);
  const notes =
    notesParts.length > 0
      ? notesParts.join("\n")
      : "Submitted via public marketing lead gateway.";

  return {
    id: `lead-${randomUUID()}`,
    name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.address || "",
    location: input.location || input.city || "",
    monthlyBill: input.monthlyBill ?? 0,
    monthlyUnits: input.monthlyUnits ?? 0,
    notes,
    leadSource: input.leadSource || "Marketing Website",
    status: "New",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Persist only after validation/auth. Success responses must use returned leadId.
 */
export async function createPublicLead(
  input: PublicLeadInput,
  persist: PersistPublicLeadFn
): Promise<{ leadId: string }> {
  const record = buildPublicLeadRecord(input);
  const result = await persist(record);
  if (!result?.leadId) {
    throw new Error("Lead persistence did not return a leadId.");
  }
  return { leadId: result.leadId };
}
