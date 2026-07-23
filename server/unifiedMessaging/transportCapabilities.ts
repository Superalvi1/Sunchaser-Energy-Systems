/**
 * Explicit transport capability negotiation.
 * Unsupported operations fail closed as normalized errors before provider dispatch.
 */
import {
  type MessagingTransport,
  type NormalizedMessageType,
} from "./transportTypes.ts";
import {
  TransportContractError,
  type TransportErrorCategory,
} from "./transportErrors.ts";

export const TRANSPORT_CAPABILITIES = [
  "text",
  "inbound_media",
  "outbound_media",
  "templates",
  "interactive_messages",
  "delivery_receipts",
  "read_receipts",
  "reactions",
  "voice_notes",
  "broadcasts",
  "reconnect",
  "qr_authentication",
  "webhook_verification",
] as const;

export type TransportCapability = (typeof TRANSPORT_CAPABILITIES)[number];

export type TransportCapabilitySet = Readonly<
  Record<TransportCapability, boolean>
>;

export function emptyCapabilitySet(): TransportCapabilitySet {
  return {
    text: false,
    inbound_media: false,
    outbound_media: false,
    templates: false,
    interactive_messages: false,
    delivery_receipts: false,
    read_receipts: false,
    reactions: false,
    voice_notes: false,
    broadcasts: false,
    reconnect: false,
    qr_authentication: false,
    webhook_verification: false,
  };
}

export function capabilitySet(
  enabled: readonly TransportCapability[]
): TransportCapabilitySet {
  const set = { ...emptyCapabilitySet() };
  for (const cap of enabled) {
    set[cap] = true;
  }
  return set;
}

export function hasCapability(
  capabilities: TransportCapabilitySet,
  capability: TransportCapability
): boolean {
  return capabilities[capability] === true;
}

/**
 * Map high-level operations to the capability that must be present.
 * Not every channel is assumed to support Meta templates or broadcasts.
 */
export const OPERATION_REQUIRED_CAPABILITY = {
  send_text: "text",
  send_template: "templates",
  send_interactive: "interactive_messages",
  send_outbound_media: "outbound_media",
  receive_inbound_media: "inbound_media",
  download_media: "inbound_media",
  upload_media: "outbound_media",
  delivery_receipt: "delivery_receipts",
  read_receipt: "read_receipts",
  send_reaction: "reactions",
  send_voice_note: "voice_notes",
  broadcast: "broadcasts",
  reconnect: "reconnect",
  qr_authenticate: "qr_authentication",
  verify_webhook: "webhook_verification",
} as const satisfies Record<string, TransportCapability>;

export type CapabilityGatedOperation =
  keyof typeof OPERATION_REQUIRED_CAPABILITY;

export type CapabilityCheckResult =
  | { ok: true; capability: TransportCapability }
  | {
      ok: false;
      capability: TransportCapability;
      error: TransportContractError;
    };

/**
 * Explicit capability gate. Call before any future provider dispatch.
 * Never assumes templates/broadcasts/QR are universally available.
 */
export function assertCapability(
  transport: MessagingTransport,
  capabilities: TransportCapabilitySet,
  operation: CapabilityGatedOperation
): CapabilityCheckResult {
  const capability = OPERATION_REQUIRED_CAPABILITY[operation];
  if (hasCapability(capabilities, capability)) {
    return { ok: true, capability };
  }
  return {
    ok: false,
    capability,
    error: new TransportContractError({
      category: "capability_unsupported" satisfies TransportErrorCategory,
      retryable: false,
      safeMessage: `Transport "${transport}" does not support capability "${capability}" for operation "${operation}"`,
      diagnostic: {
        transport,
        operation,
        capability,
      },
      providerCode: null,
    }),
  };
}

/** Convenience helper that throws on unsupported capability. */
export function requireCapability(
  transport: MessagingTransport,
  capabilities: TransportCapabilitySet,
  operation: CapabilityGatedOperation
): void {
  const result = assertCapability(transport, capabilities, operation);
  if (result.ok === false) {
    throw result.error;
  }
}

/**
 * Message-type → capability mapping for outbound send planning.
 * Unknown mappings default to capability_unsupported via explicit check.
 */
export function outboundCapabilityForMessageType(
  messageType: NormalizedMessageType
): CapabilityGatedOperation | null {
  switch (messageType) {
    case "text":
      return "send_text";
    case "template":
      return "send_template";
    case "interactive":
      return "send_interactive";
    case "image":
    case "audio":
    case "video":
    case "document":
      return "send_outbound_media";
    case "reaction":
      return "send_reaction";
    case "location":
      // Location outbound is treated as structured text-capable content unless
      // a future location-specific capability is introduced.
      return "send_text";
    case "system":
      return null;
    default: {
      const _exhaustive: never = messageType;
      return _exhaustive;
    }
  }
}

/**
 * Illustrative defaults for documentation/tests only — not production wiring.
 * Official Meta adapter is not implemented in this phase.
 */
export function exampleCapabilityProfile(
  transport: MessagingTransport
): TransportCapabilitySet {
  switch (transport) {
    case "meta_whatsapp_cloud":
      return capabilitySet([
        "text",
        "inbound_media",
        "outbound_media",
        "templates",
        "interactive_messages",
        "delivery_receipts",
        "read_receipts",
        "reactions",
        "voice_notes",
        "reconnect",
        "webhook_verification",
      ]);
    case "whatsapp_web_qr":
      return capabilitySet([
        "text",
        "inbound_media",
        "delivery_receipts",
        "read_receipts",
        "reconnect",
        "qr_authentication",
      ]);
    case "website_chat":
      return capabilitySet([
        "text",
        "inbound_media",
        "outbound_media",
        "delivery_receipts",
        "read_receipts",
        "reconnect",
      ]);
    case "instagram":
      return capabilitySet([
        "text",
        "inbound_media",
        "outbound_media",
        "interactive_messages",
        "delivery_receipts",
        "read_receipts",
        "reactions",
        "reconnect",
        "webhook_verification",
      ]);
    case "messenger":
      return capabilitySet([
        "text",
        "inbound_media",
        "outbound_media",
        "templates",
        "interactive_messages",
        "delivery_receipts",
        "read_receipts",
        "reactions",
        "reconnect",
        "webhook_verification",
      ]);
    default: {
      const _exhaustive: never = transport;
      return _exhaustive;
    }
  }
}
