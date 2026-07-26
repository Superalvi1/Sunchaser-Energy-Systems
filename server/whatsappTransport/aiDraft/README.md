# AI-03 — Human-approved AI draft workflow

Inbox UX + HTTP contract for **staff-initiated**, **human-reviewed** AI response drafts.

## Hard guarantees (this phase)

- Automatic replies are impossible (`WHATSAPP_AI_AUTO_REPLY_ENABLED` is ignored for send).
- Generation never calls `InboxSendPort` / `POST /messages/send`.
- Feature flag `WHATSAPP_AI_QUERY_DRAFT_ENABLED` defaults **OFF**.
- AI-04 wires `createInboxAiDraftAdapter` → AI-01 `QueryAgentService` (+ AI-02 knowledge).
  Default provider is mock. Live Gemini requires draft enabled + `WHATSAPP_AI_QUERY_PROVIDER=env` +
  `GEMINI_API_KEY` + `WHATSAPP_AI_LIVE_PROVIDER_ENABLED=true` (all four).
- Draft text is held in React memory only (never `localStorage` / `sessionStorage`).

## HTTP contract

```
POST /api/inbox/conversations/:conversationId/ai-draft
Authorization: Bearer <staff JWT>
Body: { "messageText": string, "messageId"?: string, "locale"?: string }
```

Success (`status: "draft"`): editable answer + confidence + warnings + escalation flags.  
Denied (`status: "denied"`): safe reason (feature_disabled, timeout, provider_unavailable, tenant_mismatch, …).  
Auth failures: `401` / `403` via existing inbox RBAC (`canViewInbox` / `canGenerateAiDraft`).

## Adapter contract (AI-01 integration)

AI-03 depends on `InboxAiDraftAdapter`:

```ts
type InboxAiDraftAdapter = {
  readonly adapterId: string;
  generateDraft(request: AiDraftGenerateRequest): Promise<AiDraftOutcome>;
};
```

Request/outcome shapes match AI-01 `QueryDraftRequest` / `QueryDraftOutcome`.

### What AI-01 must satisfy

1. Export `createQueryAgentService` with `generateDraft(QueryDraftRequest) → QueryDraftOutcome`.
2. Keep provider phrasing behind `QueryAgentGateway.phraseDraft` (do **not** duplicate in AI-03).
3. Honor the same env flags (`WHATSAPP_AI_QUERY_DRAFT_ENABLED`, timeout, rate limits).
4. Always set `requiresHumanReview: true` and `autoSendBlocked: true`.
5. Never send WhatsApp / never call inbox send transport.

### Rebase wiring (after AI-01 review)

Replace the mock in `createInboxAiDraftAdapter()`:

```ts
import { createQueryAgentService } from "../aiQueryAgent/index.ts";

const service = createQueryAgentService(/* optional gateway */);
return {
  adapterId: "query-agent",
  generateDraft: (req) => service.generateDraft(req),
};
```

Keep AI-03 files under `aiDraft/` isolated so the rebase is a small factory change + type alias cleanup.

## UX flow

1. Authorized staff opens a conversation (no auto-generate).
2. Clicks **Generate AI draft** (manual only).
3. Sees loading / timeout / failure / unavailable states.
4. Edits the draft preview; may regenerate, discard, or copy to composer.
5. Human uses the existing **Send** action separately — never auto-send after generation.
