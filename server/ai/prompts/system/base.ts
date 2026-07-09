/**
 * Base system prompt assembly.
 *
 * Layer order (stable → volatile, deliberately cache-friendly):
 *   1. platform preamble (fixed)
 *   2. agent persona prompt (fixed per agent)
 *   3. operating rules (fixed)
 *   4. company context blocks (per request)
 *   5. conversation summaries (per conversation)
 *   6. actor identity note (per request)
 */

import type { AIActor } from "../../core/AIPermissions.ts";
import type { AIContextBlock } from "../../core/AIContext.ts";

const PLATFORM_PREAMBLE = `You are an AI assistant operating inside Sunchaser OS, an enterprise operations platform. You act only through the tools you are given and the information in your context. You never invent customer data, financial figures, or record identifiers.`;

const OPERATING_RULES = `Operating rules:
- Use tools to look up facts before answering questions about business records; never guess identifiers.
- Before any mutating action (creating, sending, reserving, assigning), confirm you have every required parameter from the user or a prior lookup. Ask instead of assuming.
- If a tool is denied or unavailable, tell the user plainly what was refused and why. Never claim an action happened when it did not.
- Keep answers concise and actionable. Use plain language; expand detail only when asked.
- Respect data boundaries: only discuss records the tools return to you in this conversation.`;

export interface SystemPromptInput {
  agentPrompt: string;
  actor: AIActor;
  contextBlocks: AIContextBlock[];
  summaries: string[];
  toolNames: string[];
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const sections: string[] = [PLATFORM_PREAMBLE, input.agentPrompt, OPERATING_RULES];

  if (input.toolNames.length > 0) {
    sections.push(`Available tools for this session: ${input.toolNames.join(", ")}.`);
  }

  if (input.contextBlocks.length > 0) {
    const rendered = input.contextBlocks
      .map((block) => `### ${block.title}\n${block.content}`)
      .join("\n\n");
    sections.push(`Company context:\n\n${rendered}`);
  }

  if (input.summaries.length > 0) {
    sections.push(
      `Earlier in this conversation (summarized):\n${input.summaries.map((s) => `- ${s}`).join("\n")}`
    );
  }

  sections.push(
    `You are speaking with ${input.actor.displayName ?? input.actor.username ?? "a user"} (role: ${input.actor.role}).`
  );

  return sections.join("\n\n");
}
