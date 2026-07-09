/**
 * Company memory — interface re-export plus the null implementation used
 * until the CRM knowledge layer is connected.
 *
 * The real implementation will live in the CRM integration package and back
 * onto Supabase (and later a vector index). Nothing in the engine changes
 * when that lands: it is injected wherever CompanyMemory is consumed.
 */

import type { CompanyMemory, CompanyMemoryEntry } from "../core/AIMemory.ts";
import { AIError } from "../core/AIErrors.ts";

export type { CompanyMemory, CompanyMemoryEntry } from "../core/AIMemory.ts";

/** Inert store: finds nothing, refuses writes loudly. */
export class NullCompanyMemory implements CompanyMemory {
  async search(): Promise<CompanyMemoryEntry[]> {
    return [];
  }

  async get(): Promise<CompanyMemoryEntry | null> {
    return null;
  }

  async upsert(): Promise<CompanyMemoryEntry> {
    throw new AIError(
      "invalid_request",
      "Company memory is not connected in this deployment. Register a CompanyMemory implementation."
    );
  }

  async delete(): Promise<void> {
    throw new AIError(
      "invalid_request",
      "Company memory is not connected in this deployment. Register a CompanyMemory implementation."
    );
  }
}
