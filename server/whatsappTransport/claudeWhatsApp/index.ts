export {
  CLAUDE_WHATSAPP_PROVIDER,
  CLAUDE_WHATSAPP_SESSION_ID,
  CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID,
  CLAUDE_WHATSAPP_ENABLED_SETTINGS_KEY,
  CLAUDE_WHATSAPP_KILL_SWITCH_POLL_MS,
  CLAUDE_WHATSAPP_MIN_SEND_GAP_MS,
} from "./claudeWhatsAppConstants.ts";

export { useClaudeWhatsAppAuthStore } from "./claudeWhatsAppAuthStore.ts";
export {
  ClaudeWhatsAppKillSwitch,
  getClaudeWhatsAppKillSwitch,
  resetClaudeWhatsAppKillSwitchForTests,
} from "./claudeWhatsAppKillSwitch.ts";
export {
  normalizeBaileysInboundMessage,
  persistClaudeWhatsAppInbound,
  handleClaudeWhatsAppMessagesUpsert,
} from "./claudeWhatsAppInboundAdapter.ts";
export {
  ClaudeWhatsAppProvider,
  getClaudeWhatsAppProvider,
  resetClaudeWhatsAppProviderForTests,
} from "./claudeWhatsAppProvider.ts";
export {
  createClaudeWhatsAppOutboundPort,
  createComposedInboxSendPort,
  sendClaudeWhatsAppBroadcast,
} from "./claudeWhatsAppOutboundPort.ts";
export { createClaudeWhatsAppRouter } from "./claudeWhatsAppRoutes.ts";
export {
  startClaudeWhatsAppLifecycle,
  getClaudeWhatsAppLifecycle,
  resolveClaudeAwareInboxSendPort,
} from "./claudeWhatsAppLifecycle.ts";
