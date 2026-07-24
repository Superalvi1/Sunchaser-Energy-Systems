/**
 * Boot / shutdown wiring for Claude WhatsApp (called from server.ts only).
 * Does not modify existing Cloud API transport files.
 */
import { createInboxOutboundSendPort } from "../whatsappInboxSendTransport.ts";
import type { InboxSendPort } from "../whatsappInboxControllers.ts";
import {
  createClaudeWhatsAppOutboundPort,
  createComposedInboxSendPort,
} from "./claudeWhatsAppOutboundPort.ts";
import {
  getClaudeWhatsAppKillSwitch,
  type ClaudeWhatsAppKillSwitch,
} from "./claudeWhatsAppKillSwitch.ts";
import {
  getClaudeWhatsAppProvider,
  type ClaudeWhatsAppProvider,
} from "./claudeWhatsAppProvider.ts";

export type ClaudeWhatsAppLifecycle = {
  provider: ClaudeWhatsAppProvider;
  killSwitch: ClaudeWhatsAppKillSwitch;
  sendPort: InboxSendPort;
  stop: () => Promise<void>;
};

let lifecycle: ClaudeWhatsAppLifecycle | null = null;

/**
 * Start kill-switch polling + Baileys socket.
 * Safe to call once at process boot.
 */
export async function startClaudeWhatsAppLifecycle(opts?: {
  autoLinkLead?: (conversationId: string) => Promise<unknown>;
  /** When false, do not open the Baileys socket until kill switch is ON. */
  connectEvenIfDisabled?: boolean;
}): Promise<ClaudeWhatsAppLifecycle> {
  if (lifecycle) return lifecycle;

  const killSwitch = getClaudeWhatsAppKillSwitch();
  killSwitch.start();
  await killSwitch.refresh();

  const provider = getClaudeWhatsAppProvider({
    killSwitch,
    autoLinkLead: opts?.autoLinkLead,
  });

  killSwitch.setOnChange((enabled) => {
    void provider.applyKillSwitch(enabled);
    if (enabled && !provider.isConnected()) {
      void provider.start();
    }
  });

  const shouldConnect =
    opts?.connectEvenIfDisabled === true || killSwitch.isEnabled();
  if (shouldConnect) {
    try {
      await provider.start();
    } catch (err) {
      console.error("[claude-whatsapp] failed to start provider:", err);
    }
  }

  const claudePort = createClaudeWhatsAppOutboundPort({
    provider,
    killSwitch,
  });
  const graphPort = createInboxOutboundSendPort();
  const sendPort = createComposedInboxSendPort({
    claudePort,
    graphPort,
    killSwitch,
    provider,
  });

  lifecycle = {
    provider,
    killSwitch,
    sendPort,
    stop: async () => {
      killSwitch.setOnChange(undefined);
      killSwitch.stop();
      await provider.stop();
      lifecycle = null;
    },
  };
  return lifecycle;
}

export function getClaudeWhatsAppLifecycle(): ClaudeWhatsAppLifecycle | null {
  return lifecycle;
}

/**
 * Resolve the inbox send port: composed Claude+Graph when lifecycle started,
 * otherwise the unchanged Graph-only factory (Cloud API path behavior).
 */
export function resolveClaudeAwareInboxSendPort(): InboxSendPort | null {
  if (lifecycle) return lifecycle.sendPort;
  return createInboxOutboundSendPort();
}
