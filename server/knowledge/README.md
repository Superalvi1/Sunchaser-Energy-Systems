# Enterprise Knowledge Platform — Backend Architecture (V5)

**Scope: backend architecture only.** This folder is the company's knowledge
brain *data layer* — not a chatbot RAG stack, not production routes, and not
the admin UI.

## What lives here

| Module | Purpose |
|--------|---------|
| `KnowledgeModels.ts` | Collections, visibilities, MIME types, validators |
| `KnowledgeDocument.ts` | Document entity + validation |
| `KnowledgeChunk.ts` | Future indexing unit (no parsing yet) |
| `KnowledgeMetadata.ts` | CRM links, future cloud refs |
| `KnowledgeCollections.ts` | Taxonomy + permission-domain mapping |
| `KnowledgePermissions.ts` | Access control via existing OwnershipResolvers |
| `KnowledgeRepository.ts` | In-memory repository (tests / future wiring) |
| `KnowledgeIndexer.ts` | Stub — `not_implemented` |
| `KnowledgeSearch.ts` | Stub — empty results |
| `KnowledgeEvents.ts` | Lifecycle event types |

## Explicitly NOT in scope (yet)

- No HTTP routes
- No embeddings / vectors
- No LLM / OCR / parsing
- No production UI

## Frontend mock prototype (separate)

The admin **Knowledge Center** UI (`src/components/KnowledgeStaff.tsx`) and
`src/services/knowledgeMock.ts` are a **frontend mock prototype** gated by
`VITE_ENABLE_KNOWLEDGE_MOCK_UI=true` (default: off).

Mock data is **not** a production source and does **not** call this layer.
When routes are wired, the UI should call real APIs that delegate to
`server/knowledge` with full permission checks — never bypass ownership.

## Permissions

`KnowledgePermissions.ts` delegates to:

- `SalesOwnershipResolver`
- `FinanceOwnershipResolver`
- `TechnicianOwnershipResolver`
- `OwnershipResolver`

Never bypass ownership. Collection visibility is checked before domain access.

## Tests

Run with Phase 1B:

```bash
npm run test:phase-1b1
```

Includes `server/knowledge/*.test.ts` (150+ deterministic tests).
