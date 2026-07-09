export type AiChatAgentId =
  | "sales"
  | "finance"
  | "operations"
  | "support"
  | "procurement"
  | "ceo";

export interface AiChatRequest {
  message: string;
  conversationId?: string;
  agent?: AiChatAgentId;
  includeBusinessContext?: boolean;
}

/** Builds the POST /api/ai/chat body — never includes appState or CRM row data. */
export function buildAiChatRequestPayload(input: {
  message: string;
  conversationId?: string;
  agent?: AiChatAgentId;
  includeBusinessContext?: boolean;
}): AiChatRequest {
  const body: AiChatRequest = { message: input.message };
  if (input.conversationId) body.conversationId = input.conversationId;
  if (input.agent) body.agent = input.agent;
  if (input.includeBusinessContext === true) {
    body.includeBusinessContext = true;
  }
  return body;
}
