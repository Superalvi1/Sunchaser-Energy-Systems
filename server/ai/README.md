# Sunchaser OS — AI Engine

Reusable, provider-agnostic AI platform layer. **No business logic lives here**: the engine knows how to talk to models, enforce declared permissions, run tools, remember conversations, and account for cost — it does not know what a quotation or an invoice is beyond the schemas modules declare.

## Layout

```
server/ai/
  core/          Engine, provider contract, router, registry, permissions,
                 context, conversation, memory contracts, logging, errors
  providers/     AnthropicProvider · OpenAIProvider · GeminiProvider
  agents/        Sales · Finance · Operations · Support · Procurement · CEO
  memory/        InMemoryConversationMemory · CompanyMemory (interface + null impl)
  tools/         Tool contract · ToolExecutor · ToolSchemas (declarations only)
  prompts/       system/base.ts · agents/*.ts
  index.ts       createAIEngine() composition root + public exports
```

## Request lifecycle

```
AIEngine.execute(request)
  → AIRouter.resolve(agentId, modelOverride)        # agent → provider/model, failover
  → permissions.canAccess(actor, agent.access)      # agent-level gate
  → ConversationMemoryStore.getOrCreate(...)        # thread history
  → CompanyContextProvider.load(...)                # CRM snapshot (pluggable)
  → AIToolRegistry.resolveFor(actor, agent.tools)   # visibility-filtered tools
  → loop: provider.complete/stream                  # retry w/ backoff on 429/5xx
      └ tool_use → ToolExecutor.execute(...)        # authorize → run/refuse/unbound
  → memory.appendTurn · logger.logCall              # persistence + telemetry
  → AIEngineResponse                                # response/reasoning/toolCalls/
                                                    # actions/citations/usage/cost
```

## Key contracts

| Contract | Purpose | Default |
|---|---|---|
| `AIProvider` | Vendor adapter (complete + stream + model catalog w/ pricing) | Anthropic / OpenAI / Gemini |
| `AIPermissionEvaluator` | roles + permissions + ownership vs tool args | `DefaultPermissionEvaluator` |
| `OwnershipPolicyResolver` | record-level ABAC hook (`{type:"policy"}` ownership) | none → policy tools refuse |
| `ConversationMemoryStore` | thread persistence | in-memory (swap for Supabase) |
| `CompanyMemory` | long-term company knowledge (interface only) | `NullCompanyMemory` |
| `CompanyContextProvider` | per-request business snapshot into prompts | empty |
| `ToolSource` | dynamic tool catalogs (future MCP servers) | none |
| `AILogger` | per-call + per-tool telemetry (latency/tokens/cost) | console JSON |

## Wiring

```ts
import { createAIEngine } from "./server/ai/index.ts";

const { engine, registry } = createAIEngine();

// Later, a business module binds real implementations:
registry.bind("searchCustomers", async (input, ctx) => ({
  output: await customerService.search(String(input.query), ctx.actor),
}));

const result = await engine.execute({
  agentId: "sales",
  actor: { userId: "u-1", role: "Sales Manager", permissions: ["customers:read", "quotations:write"] },
  input: "Draft a 10kW quote for Ali Traders",
});
```

Until a handler is bound, tool calls resolve to a structured `unbound` outcome — the model is told the action did not happen. Permission failures resolve to `denied`. **The engine refuses execution when permissions fail; it never throws mid-loop for tool problems.**

## Provider notes

- **Anthropic** (`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`): default `claude-opus-4-8`; adaptive thinking with summarized display feeds the `reasoning` field; sampling params intentionally not sent (rejected by current models).
- **OpenAI** (`openai`, `OPENAI_API_KEY`): Chat Completions + function tools, streamed tool-call assembly, cached-token accounting.
- **Gemini** (`@google/genai`, `GEMINI_API_KEY`): same client family the legacy `/api/gemini/*` routes use; function declarations + `functionResponse` round-trip.
- **Local LLM (future)**: implement `AIProvider` and pass it via `createAIEngine({ providers: [...] })`. Nothing else changes.
- Model pricing lives on `AIModelDescriptor` and is **deployment-overridable** (constructor `models` option). Verify third-party rates before relying on `costUsd` for billing.

## Dependencies

`@anthropic-ai/sdk` and `openai` were added to `package.json`; run `npm install` before building. `@google/genai` was already present. Requires Node 18+ (`node:crypto` randomUUID, global fetch).

## Extension points (deliberate)

1. **New agent**: add a prompt + `AgentDefinition`, register via `createAIEngine({ agents })` or `router.registerAgent`.
2. **New tool**: declare schema + permission spec in the owning module, `registry.register`, bind handler.
3. **ABAC**: implement `OwnershipPolicyResolver` (e.g. backed by the CRM Ownership module) and declare `{type:"policy", policy:"lead-access"}` on tools.
4. **MCP**: implement `ToolSource` per MCP server; discovered tools flow through the same permission gate as static ones.
5. **Durable memory**: implement `ConversationMemoryStore` on Supabase; inject it.
6. **Telemetry**: implement `AILogger`; every call already carries tokens, cost, latency, retries, stop reason.
