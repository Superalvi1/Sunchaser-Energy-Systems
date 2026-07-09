/**
 * Company context — the read-only business snapshot injected into prompts.
 *
 * The engine only defines the CONTRACT. CRM modules implement
 * CompanyContextProvider later (e.g. pulling the actor's pipeline, open
 * tickets, inventory levels) without the engine ever importing them.
 */

import type { AIActor } from "./AIPermissions.ts";

/** A single named block of context, rendered into the system prompt. */
export interface AIContextBlock {
  /** Stable identifier, e.g. "company-profile", "open-pipeline". */
  key: string;
  title: string;
  /** Plain text / markdown. Keep each block small; the engine concatenates. */
  content: string;
}

export interface AICompanyContext {
  /** Rendered into the system prompt in order. May be empty. */
  blocks: AIContextBlock[];
  /** Machine-readable facts tools may consult (never rendered verbatim). */
  facts: Record<string, string | number | boolean>;
}

export interface CompanyContextRequest {
  actor: AIActor;
  agentId: string;
  conversationId: string;
}

export interface CompanyContextProvider {
  load(request: CompanyContextRequest): Promise<AICompanyContext>;
}

export const EMPTY_COMPANY_CONTEXT: AICompanyContext = Object.freeze({
  blocks: [],
  facts: {},
});

/** Default provider until a CRM adapter is registered. */
export class EmptyCompanyContextProvider implements CompanyContextProvider {
  async load(): Promise<AICompanyContext> {
    return EMPTY_COMPANY_CONTEXT;
  }
}
