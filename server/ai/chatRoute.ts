import type { Request, Response } from "express";
import type { Database } from "../../dbManager.ts";
import {
  AIError,
  AIPermissionDeniedError,
  AIAgentNotFoundError,
  AIModelNotFoundError,
} from "./core/AIErrors.ts";
import type { AIEngineResponse } from "./core/AIResponse.ts";
import {
  createChatV1EngineForRequest,
  getChatV1EngineBundle,
  isAiChatRoleAllowed,
  isAiProviderConfigured,
  parseAiChatV1Body,
  resolveChatV1Model,
  toAIActor,
} from "./chatV1.ts";

let resolveChatLocalDb: (() => Database) | null = null;

export function configureAiChatRoute(deps: { resolveLocalDb: () => Database }): void {
  resolveChatLocalDb = deps.resolveLocalDb;
}

/** @internal Test hook */
export function setChatResolveLocalDbForTests(fn: (() => Database) | null): void {
  resolveChatLocalDb = fn;
}

function getChatLocalDb(): Database {
  if (!resolveChatLocalDb) {
    throw new Error("AI chat route is not configured with resolveLocalDb.");
  }
  return resolveChatLocalDb();
}

export async function handleAiChatPost(req: Request, res: Response): Promise<void> {
  if (!req.actor) {
    res.status(401).json({ error: "Auth required." });
    return;
  }

  if (!isAiChatRoleAllowed(req.actor.role)) {
    res.status(403).json({ error: "Not authorized for AI chat." });
    return;
  }

  const parsed = parseAiChatV1Body(req.body);
  if (parsed.ok === false) {
    res.status(parsed.status).json({ error: parsed.error });
    return;
  }

  if (!isAiProviderConfigured()) {
    res.status(503).json({ error: "AI provider is not configured" });
    return;
  }

  const bundle = parsed.includeBusinessContext
    ? createChatV1EngineForRequest({
        requestActor: req.actor,
        db: getChatLocalDb(),
        includeBusinessContext: true,
      })
    : getChatV1EngineBundle();

  const model = resolveChatV1Model(bundle.providers, parsed.modelPreference);
  if (!model) {
    res.status(503).json({ error: "AI provider is not configured" });
    return;
  }

  try {
    const response: AIEngineResponse = await bundle.engine.execute({
      agentId: parsed.agentId,
      actor: toAIActor(req.actor),
      input: parsed.message,
      conversationId: parsed.conversationId,
      model,
      maxToolIterations: 1,
    });
    res.json(response);
  } catch (err) {
    if (err instanceof AIPermissionDeniedError) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err instanceof AIAgentNotFoundError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof AIModelNotFoundError) {
      res.status(503).json({ error: "AI provider is not configured" });
      return;
    }
    if (err instanceof AIError) {
      res.status(502).json({ error: err.message, code: err.code });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
