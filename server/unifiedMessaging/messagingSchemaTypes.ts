/**
 * Schema-aligned domain constants for normalized messaging persistence.
 * Keep in sync with scripts/unified-messaging-normalized-schema.sql CHECK lists.
 */
import {
  DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_ORIGINS,
  MESSAGE_TYPES,
  MESSAGING_TRANSPORTS,
  PROCESSING_STATUSES,
  type DeliveryStatus,
  type MessageDirection,
  type MessageOrigin,
  type NormalizedMessageType,
  type ProcessingStatus,
  type MessagingTransport,
} from "./transportTypes.ts";

/** Inbox-compatible conversation workflow statuses (normalized schema). */
export const CONVERSATION_STATUSES = [
  "open",
  "pending",
  "resolved",
  "archived",
] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const AUTOMATION_MODES = [
  "bot_active",
  "ai_active",
  "human_handling",
  "paused",
  "disabled",
] as const;

export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const CONSENT_STATUSES = [
  "unknown",
  "opted_in",
  "opted_out",
  "pending",
] as const;

export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const ATTACHMENT_SCAN_STATUSES = [
  "pending",
  "clean",
  "infected",
  "failed",
  "skipped",
] as const;

export type AttachmentScanStatus = (typeof ATTACHMENT_SCAN_STATUSES)[number];

export const OUTBOX_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "dead_lettered",
] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** Status-event delivery subset required by the schema. */
export const STATUS_EVENT_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
] as const;

export type StatusEventStatus = (typeof STATUS_EVENT_STATUSES)[number];

export const AUDIT_ACTOR_TYPES = [
  "system",
  "user",
  "service",
  "transport",
] as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** Re-export contract unions used by the SQL CHECK constraints. */
export {
  MESSAGING_TRANSPORTS,
  MESSAGE_DIRECTIONS,
  MESSAGE_TYPES,
  MESSAGE_ORIGINS,
  PROCESSING_STATUSES,
  DELIVERY_STATUSES,
};

export type {
  MessagingTransport,
  MessageDirection,
  NormalizedMessageType,
  MessageOrigin,
  ProcessingStatus,
  DeliveryStatus,
};

/** Values that must appear in SQL check constraints (static tests compare these). */
export const SQL_ALIGNED_ENUMS = {
  transports: MESSAGING_TRANSPORTS,
  directions: MESSAGE_DIRECTIONS,
  messageTypes: MESSAGE_TYPES,
  origins: MESSAGE_ORIGINS,
  processingStatuses: PROCESSING_STATUSES,
  deliveryStatuses: DELIVERY_STATUSES,
  conversationStatuses: CONVERSATION_STATUSES,
  automationModes: AUTOMATION_MODES,
  consentStatuses: CONSENT_STATUSES,
  scanStatuses: ATTACHMENT_SCAN_STATUSES,
  outboxStatuses: OUTBOX_STATUSES,
  statusEventStatuses: STATUS_EVENT_STATUSES,
  auditActorTypes: AUDIT_ACTOR_TYPES,
} as const;
