/**
 * AI Chat V1 endpoint tests — run: npm run test:phase-1b1
 */
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { Database } from "../../dbManager.ts";
import { signAccessToken } from "../auth/jwt.ts";
import { isCustomerAllowedApiRoute } from "../middleware/customerRoutePolicy.ts";
import { createAuthorizationMiddleware } from "../middleware/authorization.ts";
import type { RequestActor } from "../middleware/actor.ts";
import type { AIEngineResponse } from "./core/AIResponse.ts";
import type { AITokenUsage } from "./core/AIProvider.ts";
import type { AIEngineRequest } from "./core/AIEngine.ts";
import { handleAiChatPost, configureAiChatRoute } from "./chatRoute.ts";
import {
  AI_CHAT_V1_ROUTE,
  MinimalChatContextProvider,
  type ChatV1EngineLike,
  buildChatV1Agents,
  buildChatV1Providers,
  createChatV1Engine,
  isAiChatRoleAllowed,
  isAiProviderConfigured,
  isChatV1ToolsDisabled,
  parseAiChatV1Body,
  resolveChatV1Model,
  setChatV1EngineForTests,
  toAIActor,
} from "./chatV1.ts";

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-1b1-test-secret-min-32-chars";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

const savedGemini = process.env.GEMINI_API_KEY;
const savedOpenAi = process.env.OPENAI_API_KEY;
const savedAnthropic = process.env.ANTHROPIC_API_KEY;
const savedSupabaseUrl = process.env.SUPABASE_URL;
const savedSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let passCount = 0;

function pass(name: string): void {
  passCount += 1;
  console.log(`PASS: ${name}`);
}

const emptyUsage = (): AITokenUsage => ({
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

const mockAuthDb = {
  users: [
    {
      id: "u-customer-1",
      username: "portaluser",
      name: "Portal User",
      email: "portal@test.com",
      role: "Customer",
      account_status: "Approved",
      customerId: "cust-42",
    },
  ],
} as unknown as Database;

function mockActor(overrides: Partial<RequestActor> = {}): RequestActor {
  return {
    id: "u-sales-1",
    username: "salesuser",
    name: "Sales User",
    email: "sales@test.com",
    role: "Sales Executive",
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
    ...overrides,
  };
}

function mockReqRes(
  overrides: {
    actor?: RequestActor | null;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {}
): { req: Request; res: Response & { statusCode: number; body: unknown } } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as Response & { statusCode: number; body: unknown };

  const req = {
    method: "POST",
    path: AI_CHAT_V1_ROUTE,
    headers: overrides.headers ?? {},
    body: overrides.body ?? {},
    actor: overrides.actor === undefined ? mockActor() : overrides.actor,
    socket: { remoteAddress: "127.0.0.1" },
  } as Request;

  return { req, res };
}

function sampleAiResponse(): AIEngineResponse {
  const tokens = emptyUsage();
  return {
    id: "air-test-1",
    conversationId: "conv-test-1",
    agentId: "support",
    response: "Hello from mock AI.",
    reasoning: null,
    toolCalls: [],
    actions: [],
    citations: [],
    usage: {
      provider: "gemini",
      model: "gemini-3.5-flash",
      latencyMs: 12,
      tokens,
      costUsd: 0.001,
      iterations: 1,
      retries: 0,
    },
    model: "gemini-3.5-flash",
    latencyMs: 12,
    tokens,
    costUsd: 0.001,
    stopReason: "end_turn",
    createdAt: new Date().toISOString(),
  };
}

function assertAiResponseShape(body: unknown): asserts body is AIEngineResponse {
  const r = body as AIEngineResponse;
  assert.equal(typeof r.id, "string");
  assert.equal(typeof r.conversationId, "string");
  assert.equal(typeof r.agentId, "string");
  assert.equal(typeof r.response, "string");
  assert.ok(r.reasoning === null || typeof r.reasoning === "string");
  assert.ok(Array.isArray(r.toolCalls));
  assert.ok(Array.isArray(r.actions));
  assert.ok(Array.isArray(r.citations));
  assert.equal(typeof r.usage, "object");
  assert.equal(typeof r.model, "string");
  assert.equal(typeof r.latencyMs, "number");
  assert.equal(typeof r.tokens, "object");
  assert.equal(typeof r.costUsd, "number");
  assert.equal(typeof r.stopReason, "string");
  assert.equal(typeof r.createdAt, "string");
}

function mockChatEngine(
  handlers: Partial<{
    execute: ChatV1EngineLike["execute"];
    stream: ChatV1EngineLike["stream"];
  }>
): ChatV1EngineLike {
  return {
    execute: handlers.execute ?? (async () => sampleAiResponse()),
    stream: handlers.stream ?? (async () => sampleAiResponse()),
  };
}

async function runTests(): Promise<void> {
  try {
    configureAiChatRoute({ resolveLocalDb: () => mockAuthDb });
    assert.ok(isCustomerAllowedApiRoute(AI_CHAT_V1_ROUTE));
    pass("customer route policy includes /api/ai/chat");

    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(isAiProviderConfigured(), false);
    pass("no provider keys → not configured");

    process.env.GEMINI_API_KEY = "gemini-test";
    process.env.OPENAI_API_KEY = "openai-test";
    process.env.ANTHROPIC_API_KEY = "anthropic-test";
    const providers = buildChatV1Providers();
    assert.equal(providers.length, 3);
    assert.equal(providers[0]!.id, "gemini");
    assert.equal(providers[1]!.id, "openai");
    assert.equal(providers[2]!.id, "anthropic");
    pass("provider list order is Gemini → OpenAI → Anthropic");

    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const geminiOnly = buildChatV1Providers();
    assert.equal(resolveChatV1Model(geminiOnly), "gemini-3.5-pro");
    pass("resolveChatV1Model ignores agent defaults and picks first Gemini model");

    process.env.OPENAI_API_KEY = "openai-test";
    delete process.env.GEMINI_API_KEY;
    const openAiOnly = buildChatV1Providers();
    assert.equal(resolveChatV1Model(openAiOnly), openAiOnly[0]!.models[0]!.id);
    pass("resolveChatV1Model falls through to OpenAI when Gemini unset");

    process.env.GEMINI_API_KEY = "gemini-test";
    assert.equal(resolveChatV1Model(geminiOnly, "gpt-5"), geminiOnly[0]!.models[0]!.id);
    pass("unconfigured modelPreference falls back to first configured provider");

    const openAiModel = openAiOnly[0]!.models[0]!.id;
    assert.equal(resolveChatV1Model(openAiOnly, openAiModel), openAiModel);
    pass("configured modelPreference is honored when provider is available");

    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    process.env.GEMINI_API_KEY = "gemini-test";
    const bundle = createChatV1Engine();
    assert.ok(isChatV1ToolsDisabled(bundle));
    assert.ok(buildChatV1Agents().every((agent) => agent.allowedTools.length === 0));
    pass("V1 engine wiring disables tools");
    delete process.env.GEMINI_API_KEY;

    {
      const { req, res } = mockReqRes({ actor: null });
      await handleAiChatPost(req, res);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.body, { error: "Auth required." });
      pass("handler rejects missing req.actor");
    }

    {
      const middleware = createAuthorizationMiddleware({
        resolveLocalDb: () => mockAuthDb,
      });
      const { req, res } = mockReqRes({ actor: undefined });
      delete (req as { actor?: RequestActor }).actor;
      let nextCalled = false;
      await middleware(req, res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.body, { error: "Unauthorized" });
      pass("middleware denies unauthenticated /api/ai/chat without calling next");
    }

    {
      const { req, res } = mockReqRes({ body: { message: "   " } });
      await handleAiChatPost(req, res);
      assert.equal(res.statusCode, 400);
      assert.match(String((res.body as { error: string }).error), /message/i);
      pass("missing message returns 400");
    }

    assert.equal(parseAiChatV1Body({ message: "" }).ok, false);
    const parsedDefault = parseAiChatV1Body({ message: "Hi" });
    assert.equal(parsedDefault.ok, true);
    if (parsedDefault.ok === true) {
      assert.equal(parsedDefault.includeBusinessContext, false);
    }
    pass("parseAiChatV1Body rejects empty message and defaults includeBusinessContext false");

    {
      const { req, res } = mockReqRes({ body: { message: "Hello" } });
      await handleAiChatPost(req, res);
      assert.equal(res.statusCode, 503);
      assert.equal((res.body as { error: string }).error, "AI provider is not configured");
      pass("no provider configured returns 503");
    }

    process.env.GEMINI_API_KEY = "gemini-test";
    setChatV1EngineForTests(mockChatEngine({}));

    {
      const { req, res } = mockReqRes({
        body: { message: "What is net metering?", agent: "sales" },
      });
      await handleAiChatPost(req, res);
      assert.equal(res.statusCode, 200);
      assertAiResponseShape(res.body);
      assert.equal((res.body as AIEngineResponse).response, "Hello from mock AI.");
      pass("authenticated actor accepted");
    }

    {
      let resolvedModel = "";
      setChatV1EngineForTests(
        mockChatEngine({
          execute: async (request: AIEngineRequest) => {
            resolvedModel = request.model ?? "";
            return sampleAiResponse();
          },
        })
      );
      const { req, res } = mockReqRes({
        body: { message: "Provider priority check", agent: "sales" },
      });
      await handleAiChatPost(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(resolvedModel, "gemini-3.5-pro");
      pass("sales agent with only Gemini configured uses Gemini model not agent default");
    }

    {
      const { req, res } = mockReqRes({
        actor: mockActor({
          id: "u-customer-1",
          username: "portaluser",
          role: "Customer",
          customerId: "cust-42",
        }),
        body: { message: "Help with my invoice" },
      });
      await handleAiChatPost(req, res);
      assert.equal(res.statusCode, 200);
      assertAiResponseShape(res.body);
      pass("customer actor accepted");
    }

    {
      const provider = new MinimalChatContextProvider();
      const context = await provider.load({
        actor: toAIActor(
          mockActor({
            id: "u-customer-1",
            username: "portaluser",
            role: "Customer",
            customerId: "cust-42",
          })
        ),
        agentId: "support",
        conversationId: "conv-ctx-1",
      });
      assert.equal(context.blocks.length, 1);
      const text = context.blocks[0]!.content;
      assert.match(text, /Role: Customer/);
      assert.match(text, /Username: portaluser/);
      assert.match(text, /Selected agent: support/);
      assert.doesNotMatch(text, /cust-42/);
      assert.doesNotMatch(text, /invoice/i);
      assert.doesNotMatch(text, /pipeline/i);
      assert.equal(context.facts.actorRole, "Customer");
      pass("customer receives role-safe minimal context only");
    }

    {
      let engineCalled = false;
      setChatV1EngineForTests(
        mockChatEngine({
          execute: async (request) => {
            engineCalled = true;
            assert.equal(request.maxToolIterations, 1);
            const response = sampleAiResponse();
            assert.equal(response.toolCalls.length, 0);
            return response;
          },
        })
      );
      const { req, res } = mockReqRes({ body: { message: "No tools please" } });
      await handleAiChatPost(req, res);
      assert.equal(res.statusCode, 200);
      assert.ok(engineCalled);
      assert.equal((res.body as AIEngineResponse).toolCalls.length, 0);
      pass("V1 response has no tool calls");
    }

    assert.ok(isAiChatRoleAllowed("Sales Executive"));
    assert.ok(isAiChatRoleAllowed("Customer"));
    assert.equal(isAiChatRoleAllowed("Random Role"), false);
    pass("role allowlist");

    {
      const { req, res } = mockReqRes({
        actor: mockActor({ role: "Random Role" }),
        body: { message: "Hi" },
      });
      await handleAiChatPost(req, res);
      assert.equal(res.statusCode, 403);
      pass("disallowed role returns 403");
    }

    {
      const token = signAccessToken({
        userId: "u-customer-1",
        username: "portaluser",
        role: "Customer",
      });
      const middleware = createAuthorizationMiddleware({
        resolveLocalDb: () => mockAuthDb,
      });
      const { req, res } = mockReqRes({
        actor: undefined,
        headers: { authorization: `Bearer ${token}` },
      });
      delete (req as { actor?: RequestActor }).actor;
      let nextCalled = false;
      await middleware(req, res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
      assert.equal(req.actor?.role, "Customer");
      pass("customer JWT allowed on /api/ai/chat via middleware");
    }

    setChatV1EngineForTests(null);
    console.log(`aiChat.test.ts: ${passCount} checks passed`);
  } finally {
    setChatV1EngineForTests(null);
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGemini;
    if (savedOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedOpenAi;
    if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedAnthropic;
    if (savedSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = savedSupabaseUrl;
    if (savedSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedSupabaseKey;
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
