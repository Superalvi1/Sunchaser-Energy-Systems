/**
 * Knowledge search interface — architecture stub.
 *
 * No search implementation, vectors, or LLM in V5.
 */

import type { KnowledgeCollection } from "./KnowledgeModels.ts";
import { createKnowledgeEvent } from "./KnowledgeEvents.ts";

export interface KnowledgeSearchQuery {
  query: string;
  companyId: string;
  actorId: string;
  collections?: KnowledgeCollection[];
  limit?: number;
}

export interface KnowledgeSearchHit {
  documentId: string;
  collection: KnowledgeCollection;
  score: number;
}

export interface KnowledgeSearchResult {
  query: string;
  hits: KnowledgeSearchHit[];
  total: number;
  status: "not_implemented";
  message: string;
}

export interface KnowledgeSearch {
  search(query: KnowledgeSearchQuery): KnowledgeSearchResult;
}

export const KNOWLEDGE_SEARCH_NOT_IMPLEMENTED_MESSAGE =
  "Knowledge search is not implemented in V5 architecture.";

/** Deterministic stub search — always returns empty results. */
export class StubKnowledgeSearch implements KnowledgeSearch {
  private searchCounter = 0;

  search(query: KnowledgeSearchQuery): KnowledgeSearchResult {
    this.searchCounter += 1;
    createKnowledgeEvent({
      id: `kevt-search-${this.searchCounter}`,
      type: "search.requested",
      documentId: "",
      actorId: query.actorId,
      companyId: query.companyId,
      payload: { queryLength: query.query.length, implemented: false },
    });
    return {
      query: query.query,
      hits: [],
      total: 0,
      status: "not_implemented",
      message: KNOWLEDGE_SEARCH_NOT_IMPLEMENTED_MESSAGE,
    };
  }
}

export function createStubKnowledgeSearch(): StubKnowledgeSearch {
  return new StubKnowledgeSearch();
}

export const STUB_KNOWLEDGE_SEARCH: KnowledgeSearch = createStubKnowledgeSearch();

export function normalizeKnowledgeSearchQuery(query: KnowledgeSearchQuery): KnowledgeSearchQuery {
  return {
    query: String(query.query || "").trim(),
    companyId: String(query.companyId || "").trim(),
    actorId: String(query.actorId || "").trim(),
    collections: query.collections,
    limit: query.limit !== undefined ? Math.max(0, Math.floor(query.limit)) : undefined,
  };
}
