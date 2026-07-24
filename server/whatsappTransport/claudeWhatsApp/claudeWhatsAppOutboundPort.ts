/**
 * InboxSendPort backed by the Baileys socket.
 * Hard caps: per-conversation min gap, no bulk/broadcast path.
 */
import type { RequestActor } from "../../middleware/actor.ts";
import type { InboxSendPort } from "../whatsappInboxControllers.ts";
import {
  createDefaultWhatsAppRepository,
  type WhatsAppRepository,
} from "../whatsappRepository.ts";
import { MESSAGE_STATUSES } from "../whatsappConstants.ts";
import { validateOutboundText } from "../whatsappOutboundService.ts";
import {
  CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID,
  CLAUDE_WHATSAPP_MIN_SEND_GAP_MS,
  CLAUDE_WHATSAPP_PROVIDER,
} from "./claudeWhatsAppConstants.ts";
import type { ClaudeWhatsAppKillSwitch } from "./claudeWhatsAppKillSwitch.ts";
import { getClaudeWhatsAppKillSwitch } from "./claudeWhatsAppKillSwitch.ts";
import type { ClaudeWhatsAppProvider } from "./claudeWhatsAppProvider.ts";
import { getClaudeWhatsAppProvider } from "./claudeWhatsAppProvider.ts";

export type ClaudeWhatsAppOutboundDeps = {
  repo?: WhatsAppRepository;
  provider?: ClaudeWhatsAppProvider;
  killSwitch?: ClaudeWhatsAppKillSwitch;
  minGapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Explicitly blocked. There is no bulk/broadcast send path for Claude WhatsApp —
 * enforced at the code level, not by convention.
 */
export function sendClaudeWhatsAppBroadcast(_input: {
  recipients: string[];
  text: string;
}): never {
  throw new Error(
    "Claude WhatsApp bulk/broadcast send is blocked at the code level"
  );
}

export function createClaudeWhatsAppOutboundPort(
  deps: ClaudeWhatsAppOutboundDeps = {}
): InboxSendPort {
  const repo = deps.repo ?? createDefaultWhatsAppRepository();
  const provider = deps.provider ?? getClaudeWhatsAppProvider();
  const killSwitch = deps.killSwitch ?? getClaudeWhatsAppKillSwitch();
  const minGapMs = deps.minGapMs ?? CLAUDE_WHATSAPP_MIN_SEND_GAP_MS;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const lastSendByConversation = new Map<string, number>();

  return async (input: {
    conversationId: string;
    text: string;
    actor: RequestActor;
  }) => {
    // Refresh once per send so kill switch is near-immediate even between polls.
    await killSwitch.refresh();
    if (!killSwitch.isEnabled()) {
      return {
        ok: false,
        error: "Claude WhatsApp is OFF (kill switch)",
        permanent: false,
      };
    }

    if (!provider.isConnected()) {
      return {
        ok: false,
        error: "Claude WhatsApp socket is not connected",
        permanent: false,
      };
    }

    const textValidation = validateOutboundText(input.text);
    if (textValidation.ok === false) {
      return { ok: false, error: textValidation.error, permanent: true };
    }

    // Defense in depth: reject accidental multi-recipient payloads if callers
    // ever coerce text into an object/array (broadcast is never exposed).
    if (Array.isArray(input.text as unknown)) {
      return {
        ok: false,
        error: "bulk_send_blocked",
        permanent: true,
      };
    }

    const bundle = await repo.getConversationBundle(input.conversationId);
    if (!bundle) {
      return { ok: false, error: "conversation_not_found", permanent: true };
    }
    if (
      bundle.channel.phoneNumberId !== CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID &&
      bundle.channel.wabaId !== CLAUDE_WHATSAPP_PROVIDER
    ) {
      return {
        ok: false,
        error: "conversation_not_on_claude_whatsapp_channel",
        permanent: true,
      };
    }

    const last = lastSendByConversation.get(input.conversationId) ?? 0;
    const elapsed = now() - last;
    if (elapsed < minGapMs) {
      await sleep(minGapMs - elapsed);
    }

    let message;
    try {
      message = await repo.insertOutboundMessage({
        conversationId: input.conversationId,
        textBody: textValidation.text,
      });
    } catch {
      return { ok: false, error: "Failed to queue outbound message" };
    }

    try {
      await repo.updateMessageStatus({
        messageId: message.id,
        status: MESSAGE_STATUSES.SENDING,
      });
    } catch {
      return {
        ok: false,
        error: "Failed to transition message to sending",
      };
    }

    try {
      const sent = await provider.sendText(
        bundle.contact.phoneE164,
        textValidation.text
      );
      lastSendByConversation.set(input.conversationId, now());
      await repo.updateMessageStatus({
        messageId: message.id,
        status: MESSAGE_STATUSES.SENT,
        waMessageId: sent.waMessageId,
        sentAt: new Date().toISOString(),
        providerError: null,
      });
      return { ok: true, messageId: message.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : "send_failed";
      try {
        await repo.updateMessageStatus({
          messageId: message.id,
          status: MESSAGE_STATUSES.FAILED,
          providerError: error.slice(0, 300),
        });
      } catch {
        /* ignore */
      }
      return { ok: false, error };
    }
  };
}

/**
 * Prefer Claude WhatsApp when the kill switch is ON and the socket is up;
 * otherwise fall through to the Meta Cloud API send port (unchanged path).
 */
export function createComposedInboxSendPort(deps: {
  claudePort: InboxSendPort;
  graphPort: InboxSendPort | null;
  killSwitch?: ClaudeWhatsAppKillSwitch;
  provider?: ClaudeWhatsAppProvider;
  repo?: WhatsAppRepository;
}): InboxSendPort {
  const killSwitch = deps.killSwitch ?? getClaudeWhatsAppKillSwitch();
  const provider = deps.provider ?? getClaudeWhatsAppProvider();
  const repo = deps.repo ?? createDefaultWhatsAppRepository();

  return async (input) => {
    await killSwitch.refresh();
    const bundle = await repo.getConversationBundle(input.conversationId);
    const isClaudeChannel =
      bundle?.channel.phoneNumberId ===
        CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID ||
      bundle?.channel.wabaId === CLAUDE_WHATSAPP_PROVIDER;

    if (isClaudeChannel) {
      return deps.claudePort(input);
    }

    if (killSwitch.isEnabled() && provider.isConnected() && !bundle) {
      // Unknown conversation — try Claude first only when live-test mode is on.
      return deps.claudePort(input);
    }

    if (deps.graphPort) {
      return deps.graphPort(input);
    }
    return {
      ok: false,
      error: "send_unavailable",
      permanent: false,
    };
  };
}
