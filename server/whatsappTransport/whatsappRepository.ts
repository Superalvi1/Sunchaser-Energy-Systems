import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import {
  AUDIT_EVENTS,
  DEFAULT_COMPANY_ID,
  MESSAGE_DIRECTIONS,
  MESSAGE_STATUSES,
  type AuditEventType,
} from "./whatsappConstants.ts";
import type {
  NormalizedInboundText,
  NormalizedStatusEvent,
} from "./whatsappEnvelope.ts";

export type WhatsAppChannel = {
  id: string;
  companyId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  wabaId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WhatsAppContact = {
  id: string;
  companyId: string;
  phoneE164: string;
  profileName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WhatsAppConversation = {
  id: string;
  companyId: string;
  channelId: string;
  contactId: string;
  status: string;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WhatsAppMessage = {
  id: string;
  companyId: string;
  conversationId: string;
  direction: string;
  status: string;
  textBody: string | null;
  waMessageId: string | null;
  providerError: string | null;
  occurredAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  rawPayload: Record<string, unknown> | null;
  messageType?: string;
  metaMediaId?: string | null;
  mimeType?: string | null;
  caption?: string | null;
  filename?: string | null;
  sha256?: string | null;
  voice?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  placeName?: string | null;
  rawMetadata?: Record<string, unknown> | null;
};

export type WhatsAppWebhookEventRow = {
  id: string;
  companyId: string;
  payloadHash: string;
  processed: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WhatsAppAuditEvent = {
  id: string;
  companyId: string;
  eventType: AuditEventType | string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ConversationBundle = {
  conversation: WhatsAppConversation;
  contact: WhatsAppContact;
  channel: WhatsAppChannel;
};

export type InsertResult<T> =
  | { ok: true; row: T; created: boolean }
  | { ok: false; error: string; uniqueConflict?: boolean };

export type ClaimWebhookResult =
  | { kind: "created"; event: WhatsAppWebhookEventRow }
  | { kind: "existing_processed"; event: WhatsAppWebhookEventRow }
  | { kind: "existing_incomplete"; event: WhatsAppWebhookEventRow }
  | { kind: "error"; error: string };

export interface WhatsAppRepository {
  isActive(): boolean;
  claimWebhookEvent(payloadHash: string): Promise<ClaimWebhookResult>;
  markWebhookEventProcessed(id: string): Promise<void>;
  markWebhookEventError(id: string, error: string): Promise<void>;
  resolveOrCreateChannel(input: {
    phoneNumberId: string;
    displayPhoneNumber?: string | null;
    wabaId?: string | null;
  }): Promise<WhatsAppChannel>;
  resolveOrCreateContact(input: {
    phoneE164: string;
    profileName?: string | null;
  }): Promise<WhatsAppContact>;
  resolveOrCreateOpenConversation(input: {
    channelId: string;
    contactId: string;
  }): Promise<WhatsAppConversation>;
  insertInboundMessage(input: {
    conversationId: string;
    waMessageId: string;
    textBody?: string | null;
    occurredAt: string;
    rawPayload: Record<string, unknown>;
    messageType?: string;
    metaMediaId?: string | null;
    mimeType?: string | null;
    caption?: string | null;
    filename?: string | null;
    sha256?: string | null;
    voice?: boolean;
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
    placeName?: string | null;
    rawMetadata?: Record<string, unknown> | null;
  }): Promise<InsertResult<WhatsAppMessage>>;
  insertStatusEvent(
    input: NormalizedStatusEvent
  ): Promise<
    InsertResult<{
      id: string;
      messageUpdated: boolean;
      messageNotFound?: boolean;
    }>
  >;
  updateConversationLastMessageAt(
    conversationId: string,
    at: string
  ): Promise<void>;
  insertAuditEvent(input: {
    eventType: AuditEventType | string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<WhatsAppAuditEvent>;
  getConversationBundle(conversationId: string): Promise<ConversationBundle | null>;
  /** Resolve legacy whatsapp_messages.id by Meta wa_message_id (for normalized binding recovery). */
  findMessageIdByWaMessageId(waMessageId: string): Promise<string | null>;
  insertOutboundMessage(input: {
    conversationId: string;
    textBody: string;
  }): Promise<WhatsAppMessage>;
  updateMessageStatus(input: {
    messageId: string;
    status: string;
    waMessageId?: string | null;
    providerError?: string | null;
    sentAt?: string | null;
  }): Promise<WhatsAppMessage>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Only PostgreSQL unique_violation is treated as idempotent conflict. */
export function isUniqueViolation(
  error: { code?: string; message?: string } | null
): boolean {
  return !!error && error.code === "23505";
}

// ---------------------------------------------------------------------------
// In-memory repository (tests)
// ---------------------------------------------------------------------------

export class InMemoryWhatsAppRepository implements WhatsAppRepository {
  active = true;
  channels = new Map<string, WhatsAppChannel>();
  contacts = new Map<string, WhatsAppContact>();
  conversations = new Map<string, WhatsAppConversation>();
  messages = new Map<string, WhatsAppMessage>();
  statusEvents = new Map<string, { id: string; key: string }>();
  webhookEvents = new Map<string, WhatsAppWebhookEventRow>();
  auditEvents: WhatsAppAuditEvent[] = [];
  failNextOutboundInsert = false;
  failStatusUpdatesRemaining = 0;
  failPersistAfterClaim: string | null = null;
  /** When set, status-event insert succeeds but message status update throws. */
  failMessageUpdateAfterStatusInsert = false;

  isActive(): boolean {
    return this.active;
  }

  async claimWebhookEvent(payloadHash: string): Promise<ClaimWebhookResult> {
    const existing = this.webhookEvents.get(payloadHash);
    if (existing) {
      if (existing.processed) {
        return { kind: "existing_processed", event: existing };
      }
      return { kind: "existing_incomplete", event: existing };
    }
    const event: WhatsAppWebhookEventRow = {
      id: newId("whe"),
      companyId: DEFAULT_COMPANY_ID,
      payloadHash,
      processed: false,
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.webhookEvents.set(payloadHash, event);
    return { kind: "created", event };
  }

  async markWebhookEventProcessed(id: string): Promise<void> {
    for (const event of this.webhookEvents.values()) {
      if (event.id === id) {
        event.processed = true;
        event.error = null;
        event.updatedAt = nowIso();
        return;
      }
    }
  }

  async markWebhookEventError(id: string, error: string): Promise<void> {
    for (const event of this.webhookEvents.values()) {
      if (event.id === id) {
        event.processed = false;
        event.error = error;
        event.updatedAt = nowIso();
        return;
      }
    }
  }

  async resolveOrCreateChannel(input: {
    phoneNumberId: string;
    displayPhoneNumber?: string | null;
    wabaId?: string | null;
  }): Promise<WhatsAppChannel> {
    for (const channel of this.channels.values()) {
      if (channel.phoneNumberId === input.phoneNumberId) {
        if (input.displayPhoneNumber && !channel.displayPhoneNumber) {
          channel.displayPhoneNumber = input.displayPhoneNumber;
        }
        if (input.wabaId && !channel.wabaId) channel.wabaId = input.wabaId;
        channel.updatedAt = nowIso();
        return channel;
      }
    }
    const channel: WhatsAppChannel = {
      id: newId("wch"),
      companyId: DEFAULT_COMPANY_ID,
      phoneNumberId: input.phoneNumberId,
      displayPhoneNumber: input.displayPhoneNumber ?? null,
      wabaId: input.wabaId ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.channels.set(channel.id, channel);
    return channel;
  }

  async resolveOrCreateContact(input: {
    phoneE164: string;
    profileName?: string | null;
  }): Promise<WhatsAppContact> {
    for (const contact of this.contacts.values()) {
      if (
        contact.companyId === DEFAULT_COMPANY_ID &&
        contact.phoneE164 === input.phoneE164
      ) {
        if (input.profileName && !contact.profileName) {
          contact.profileName = input.profileName;
          contact.updatedAt = nowIso();
        }
        return contact;
      }
    }
    const contact: WhatsAppContact = {
      id: newId("wct"),
      companyId: DEFAULT_COMPANY_ID,
      phoneE164: input.phoneE164,
      profileName: input.profileName ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.contacts.set(contact.id, contact);
    return contact;
  }

  async resolveOrCreateOpenConversation(input: {
    channelId: string;
    contactId: string;
  }): Promise<WhatsAppConversation> {
    for (const conversation of this.conversations.values()) {
      if (
        conversation.companyId === DEFAULT_COMPANY_ID &&
        conversation.channelId === input.channelId &&
        conversation.contactId === input.contactId
      ) {
        return conversation;
      }
    }
    const conversation: WhatsAppConversation = {
      id: newId("wcv"),
      companyId: DEFAULT_COMPANY_ID,
      channelId: input.channelId,
      contactId: input.contactId,
      status: "open",
      lastMessageAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async insertInboundMessage(input: {
    conversationId: string;
    waMessageId: string;
    textBody?: string | null;
    occurredAt: string;
    rawPayload: Record<string, unknown>;
    messageType?: string;
    metaMediaId?: string | null;
    mimeType?: string | null;
    caption?: string | null;
    filename?: string | null;
    sha256?: string | null;
    voice?: boolean;
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
    placeName?: string | null;
    rawMetadata?: Record<string, unknown> | null;
  }): Promise<InsertResult<WhatsAppMessage>> {
    if (this.failPersistAfterClaim) {
      throw new Error(this.failPersistAfterClaim);
    }
    for (const message of this.messages.values()) {
      if (
        message.companyId === DEFAULT_COMPANY_ID &&
        message.waMessageId === input.waMessageId
      ) {
        return { ok: true, row: message, created: false };
      }
    }
    const row: WhatsAppMessage = {
      id: newId("wmsg"),
      companyId: DEFAULT_COMPANY_ID,
      conversationId: input.conversationId,
      direction: MESSAGE_DIRECTIONS.INBOUND,
      status: MESSAGE_STATUSES.RECEIVED,
      textBody: input.textBody ?? null,
      waMessageId: input.waMessageId,
      providerError: null,
      occurredAt: input.occurredAt,
      sentAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      rawPayload: input.rawPayload,
      messageType: input.messageType ?? "text",
      metaMediaId: input.metaMediaId ?? null,
      mimeType: input.mimeType ?? null,
      caption: input.caption ?? null,
      filename: input.filename ?? null,
      sha256: input.sha256 ?? null,
      voice: Boolean(input.voice),
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      address: input.address ?? null,
      placeName: input.placeName ?? null,
      rawMetadata: input.rawMetadata ?? input.rawPayload,
    };
    this.messages.set(row.id, row);
    return { ok: true, row, created: true };
  }

  async insertStatusEvent(
    input: NormalizedStatusEvent
  ): Promise<
    InsertResult<{
      id: string;
      messageUpdated: boolean;
      messageNotFound?: boolean;
    }>
  > {
    const key = `${DEFAULT_COMPANY_ID}|${input.waMessageId}|${input.status}|${input.statusTimestamp}`;
    const existing = this.statusEvents.get(key);
    if (existing) {
      return {
        ok: true,
        row: { id: existing.id, messageUpdated: false },
        created: false,
      };
    }
    const id = newId("wse");
    this.statusEvents.set(key, { id, key });

    if (this.failMessageUpdateAfterStatusInsert) {
      this.failMessageUpdateAfterStatusInsert = false;
      return { ok: false, error: "simulated message status update failure" };
    }

    let found = false;
    for (const message of this.messages.values()) {
      if (
        message.companyId === DEFAULT_COMPANY_ID &&
        message.waMessageId === input.waMessageId
      ) {
        message.status = input.status;
        message.updatedAt = nowIso();
        found = true;
      }
    }
    return {
      ok: true,
      row: {
        id,
        messageUpdated: found,
        messageNotFound: !found,
      },
      created: true,
    };
  }

  async updateConversationLastMessageAt(
    conversationId: string,
    at: string
  ): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    conversation.lastMessageAt = at;
    conversation.updatedAt = nowIso();
  }

  async insertAuditEvent(input: {
    eventType: AuditEventType | string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<WhatsAppAuditEvent> {
    const event: WhatsAppAuditEvent = {
      id: newId("waud"),
      companyId: DEFAULT_COMPANY_ID,
      eventType: input.eventType,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {},
      createdAt: nowIso(),
    };
    this.auditEvents.push(event);
    return event;
  }

  async getConversationBundle(
    conversationId: string
  ): Promise<ConversationBundle | null> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;
    const contact = this.contacts.get(conversation.contactId);
    const channel = this.channels.get(conversation.channelId);
    if (!contact || !channel) return null;
    return { conversation, contact, channel };
  }

  async findMessageIdByWaMessageId(waMessageId: string): Promise<string | null> {
    const needle = String(waMessageId || "").trim();
    if (!needle) return null;
    for (const message of this.messages.values()) {
      if (
        message.companyId === DEFAULT_COMPANY_ID &&
        message.waMessageId === needle
      ) {
        return message.id;
      }
    }
    return null;
  }

  async insertOutboundMessage(input: {
    conversationId: string;
    textBody: string;
  }): Promise<WhatsAppMessage> {
    if (this.failNextOutboundInsert) {
      this.failNextOutboundInsert = false;
      throw new Error("simulated outbound insert failure");
    }
    const row: WhatsAppMessage = {
      id: newId("wmsg"),
      companyId: DEFAULT_COMPANY_ID,
      conversationId: input.conversationId,
      direction: MESSAGE_DIRECTIONS.OUTBOUND,
      status: MESSAGE_STATUSES.QUEUED,
      textBody: input.textBody,
      waMessageId: null,
      providerError: null,
      occurredAt: nowIso(),
      sentAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      rawPayload: null,
    };
    this.messages.set(row.id, row);
    return row;
  }

  async updateMessageStatus(input: {
    messageId: string;
    status: string;
    waMessageId?: string | null;
    providerError?: string | null;
    sentAt?: string | null;
  }): Promise<WhatsAppMessage> {
    if (this.failStatusUpdatesRemaining > 0) {
      this.failStatusUpdatesRemaining -= 1;
      throw new Error("simulated status update failure");
    }
    const row = this.messages.get(input.messageId);
    if (!row) throw new Error("message not found");
    row.status = input.status;
    if (input.waMessageId !== undefined) row.waMessageId = input.waMessageId;
    if (input.providerError !== undefined) {
      row.providerError = input.providerError;
    }
    if (input.sentAt !== undefined) row.sentAt = input.sentAt;
    row.updatedAt = nowIso();
    return row;
  }
}

// ---------------------------------------------------------------------------
// Supabase repository
// ---------------------------------------------------------------------------

function mapChannel(row: Record<string, unknown>): WhatsAppChannel {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    phoneNumberId: String(row.phone_number_id),
    displayPhoneNumber: (row.display_phone_number as string) ?? null,
    wabaId: (row.waba_id as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapContact(row: Record<string, unknown>): WhatsAppContact {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    phoneE164: String(row.phone_e164),
    profileName: (row.profile_name as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapConversation(row: Record<string, unknown>): WhatsAppConversation {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    channelId: String(row.channel_id),
    contactId: String(row.contact_id),
    status: String(row.status),
    lastMessageAt: (row.last_message_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): WhatsAppMessage {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    conversationId: String(row.conversation_id),
    direction: String(row.direction),
    status: String(row.status),
    textBody: (row.text_body as string) ?? null,
    waMessageId: (row.wa_message_id as string) ?? null,
    providerError: (row.provider_error as string) ?? null,
    occurredAt: (row.occurred_at as string) ?? null,
    sentAt: (row.sent_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? null,
    messageType: (row.message_type as string) ?? "text",
    metaMediaId: (row.meta_media_id as string) ?? null,
    mimeType: (row.mime_type as string) ?? null,
    caption: (row.caption as string) ?? null,
    filename: (row.filename as string) ?? null,
    sha256: (row.sha256 as string) ?? null,
    voice: Boolean(row.voice),
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    address: (row.address as string) ?? null,
    placeName: (row.place_name as string) ?? null,
    rawMetadata: (row.raw_metadata as Record<string, unknown>) ?? null,
  };
}

function mapWebhookEvent(row: Record<string, unknown>): WhatsAppWebhookEventRow {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    payloadHash: String(row.payload_hash),
    processed: Boolean(row.processed),
    error: (row.error as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SupabaseWhatsAppRepository implements WhatsAppRepository {
  constructor(private readonly clientFactory: () => SupabaseClient | null = getSupabase) {}

  isActive(): boolean {
    return isSupabaseActive() && this.clientFactory() !== null;
  }

  private client(): SupabaseClient {
    const supabase = this.clientFactory();
    if (!supabase) {
      throw new Error("Supabase is not active for WhatsApp transport.");
    }
    return supabase;
  }

  async claimWebhookEvent(payloadHash: string): Promise<ClaimWebhookResult> {
    const supabase = this.client();
    const { data: existing, error: selectError } = await supabase
      .from("whatsapp_webhook_events")
      .select("*")
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("payload_hash", payloadHash)
      .maybeSingle();

    if (selectError) {
      return { kind: "error", error: selectError.message };
    }
    if (existing) {
      const event = mapWebhookEvent(existing as Record<string, unknown>);
      if (event.processed) {
        return { kind: "existing_processed", event };
      }
      return { kind: "existing_incomplete", event };
    }

    const row = {
      id: newId("whe"),
      company_id: DEFAULT_COMPANY_ID,
      payload_hash: payloadHash,
      processed: false,
      error: null,
    };
    const { data, error } = await supabase
      .from("whatsapp_webhook_events")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        const { data: raced, error: reselectError } = await supabase
          .from("whatsapp_webhook_events")
          .select("*")
          .eq("company_id", DEFAULT_COMPANY_ID)
          .eq("payload_hash", payloadHash)
          .maybeSingle();
        if (reselectError) {
          return {
            kind: "error",
            error: `webhook claim conflict reselect failed: ${reselectError.message}`,
          };
        }
        if (!raced) {
          return {
            kind: "error",
            error: "webhook claim unique conflict but existing row not found",
          };
        }
        const event = mapWebhookEvent(raced as Record<string, unknown>);
        if (event.processed) {
          return { kind: "existing_processed", event };
        }
        return { kind: "existing_incomplete", event };
      }
      return { kind: "error", error: error.message };
    }

    return {
      kind: "created",
      event: mapWebhookEvent(data as Record<string, unknown>),
    };
  }

  async markWebhookEventProcessed(id: string): Promise<void> {
    const { error } = await this.client()
      .from("whatsapp_webhook_events")
      .update({
        processed: true,
        error: null,
        updated_at: nowIso(),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  async markWebhookEventError(id: string, errorMessage: string): Promise<void> {
    const { error } = await this.client()
      .from("whatsapp_webhook_events")
      .update({
        processed: false,
        error: errorMessage.slice(0, 500),
        updated_at: nowIso(),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  async resolveOrCreateChannel(input: {
    phoneNumberId: string;
    displayPhoneNumber?: string | null;
    wabaId?: string | null;
  }): Promise<WhatsAppChannel> {
    const supabase = this.client();
    const { data: existing } = await supabase
      .from("whatsapp_channels")
      .select("*")
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("phone_number_id", input.phoneNumberId)
      .maybeSingle();
    if (existing) {
      return mapChannel(existing as Record<string, unknown>);
    }

    const row = {
      id: newId("wch"),
      company_id: DEFAULT_COMPANY_ID,
      phone_number_id: input.phoneNumberId,
      display_phone_number: input.displayPhoneNumber ?? null,
      waba_id: input.wabaId ?? null,
    };
    const { data, error } = await supabase
      .from("whatsapp_channels")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const { data: raced, error: reselectError } = await supabase
          .from("whatsapp_channels")
          .select("*")
          .eq("company_id", DEFAULT_COMPANY_ID)
          .eq("phone_number_id", input.phoneNumberId)
          .maybeSingle();
        if (reselectError || !raced) {
          throw new Error(
            reselectError?.message ||
              "channel unique conflict but existing row not found"
          );
        }
        return mapChannel(raced as Record<string, unknown>);
      }
      throw new Error(error.message);
    }
    return mapChannel(data as Record<string, unknown>);
  }

  async resolveOrCreateContact(input: {
    phoneE164: string;
    profileName?: string | null;
  }): Promise<WhatsAppContact> {
    const supabase = this.client();
    const { data: existing } = await supabase
      .from("whatsapp_contacts")
      .select("*")
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("phone_e164", input.phoneE164)
      .maybeSingle();
    if (existing) {
      return mapContact(existing as Record<string, unknown>);
    }

    const row = {
      id: newId("wct"),
      company_id: DEFAULT_COMPANY_ID,
      phone_e164: input.phoneE164,
      profile_name: input.profileName ?? null,
    };
    const { data, error } = await supabase
      .from("whatsapp_contacts")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const { data: raced, error: reselectError } = await supabase
          .from("whatsapp_contacts")
          .select("*")
          .eq("company_id", DEFAULT_COMPANY_ID)
          .eq("phone_e164", input.phoneE164)
          .maybeSingle();
        if (reselectError || !raced) {
          throw new Error(
            reselectError?.message ||
              "contact unique conflict but existing row not found"
          );
        }
        return mapContact(raced as Record<string, unknown>);
      }
      throw new Error(error.message);
    }
    return mapContact(data as Record<string, unknown>);
  }

  async resolveOrCreateOpenConversation(input: {
    channelId: string;
    contactId: string;
  }): Promise<WhatsAppConversation> {
    const supabase = this.client();
    const { data: existing } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("channel_id", input.channelId)
      .eq("contact_id", input.contactId)
      .maybeSingle();
    if (existing) {
      return mapConversation(existing as Record<string, unknown>);
    }

    const row = {
      id: newId("wcv"),
      company_id: DEFAULT_COMPANY_ID,
      channel_id: input.channelId,
      contact_id: input.contactId,
      status: "open",
      last_message_at: null,
    };
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const { data: raced, error: reselectError } = await supabase
          .from("whatsapp_conversations")
          .select("*")
          .eq("company_id", DEFAULT_COMPANY_ID)
          .eq("channel_id", input.channelId)
          .eq("contact_id", input.contactId)
          .maybeSingle();
        if (reselectError || !raced) {
          throw new Error(
            reselectError?.message ||
              "conversation unique conflict but existing row not found"
          );
        }
        return mapConversation(raced as Record<string, unknown>);
      }
      throw new Error(error.message);
    }
    return mapConversation(data as Record<string, unknown>);
  }

  async insertInboundMessage(input: {
    conversationId: string;
    waMessageId: string;
    textBody?: string | null;
    occurredAt: string;
    rawPayload: Record<string, unknown>;
    messageType?: string;
    metaMediaId?: string | null;
    mimeType?: string | null;
    caption?: string | null;
    filename?: string | null;
    sha256?: string | null;
    voice?: boolean;
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
    placeName?: string | null;
    rawMetadata?: Record<string, unknown> | null;
  }): Promise<InsertResult<WhatsAppMessage>> {
    const supabase = this.client();
    const { data: existing } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("wa_message_id", input.waMessageId)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        row: mapMessage(existing as Record<string, unknown>),
        created: false,
      };
    }

    const row = {
      id: newId("wmsg"),
      company_id: DEFAULT_COMPANY_ID,
      conversation_id: input.conversationId,
      direction: MESSAGE_DIRECTIONS.INBOUND,
      status: MESSAGE_STATUSES.RECEIVED,
      text_body: input.textBody ?? null,
      wa_message_id: input.waMessageId,
      occurred_at: input.occurredAt,
      raw_payload: input.rawPayload,
      message_type: input.messageType ?? "text",
      meta_media_id: input.metaMediaId ?? null,
      mime_type: input.mimeType ?? null,
      caption: input.caption ?? null,
      filename: input.filename ?? null,
      sha256: input.sha256 ?? null,
      voice: Boolean(input.voice),
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      address: input.address ?? null,
      place_name: input.placeName ?? null,
      raw_metadata: input.rawMetadata ?? input.rawPayload,
    };
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const { data: raced, error: reselectError } = await supabase
          .from("whatsapp_messages")
          .select("*")
          .eq("company_id", DEFAULT_COMPANY_ID)
          .eq("wa_message_id", input.waMessageId)
          .maybeSingle();
        if (reselectError) {
          return {
            ok: false,
            error: `unique conflict reselect failed: ${reselectError.message}`,
            uniqueConflict: true,
          };
        }
        if (!raced) {
          return {
            ok: false,
            error: "unique conflict but existing message row not found",
            uniqueConflict: true,
          };
        }
        return {
          ok: true,
          row: mapMessage(raced as Record<string, unknown>),
          created: false,
        };
      }
      return { ok: false, error: error.message };
    }
    return {
      ok: true,
      row: mapMessage(data as Record<string, unknown>),
      created: true,
    };
  }

  async insertStatusEvent(
    input: NormalizedStatusEvent
  ): Promise<
    InsertResult<{
      id: string;
      messageUpdated: boolean;
      messageNotFound?: boolean;
    }>
  > {
    const supabase = this.client();
    const row = {
      id: newId("wse"),
      company_id: DEFAULT_COMPANY_ID,
      wa_message_id: input.waMessageId,
      status: input.status,
      status_timestamp: input.statusTimestamp,
      recipient_wa_id: input.recipientWaId,
      raw_payload: input.rawEvent,
    };
    const { data, error } = await supabase
      .from("whatsapp_message_status_events")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        const { data: raced, error: reselectError } = await supabase
          .from("whatsapp_message_status_events")
          .select("id")
          .eq("company_id", DEFAULT_COMPANY_ID)
          .eq("wa_message_id", input.waMessageId)
          .eq("status", input.status)
          .eq("status_timestamp", input.statusTimestamp)
          .maybeSingle();
        if (reselectError) {
          return {
            ok: false,
            error: `status conflict reselect failed: ${reselectError.message}`,
            uniqueConflict: true,
          };
        }
        if (!raced) {
          return {
            ok: false,
            error: "status unique conflict but existing row not found",
            uniqueConflict: true,
          };
        }
        return {
          ok: true,
          row: { id: String(raced.id), messageUpdated: false },
          created: false,
        };
      }
      return { ok: false, error: error.message };
    }

    const statusEventId = String(data.id);

    const { data: matchingMessages, error: selectMsgError } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("wa_message_id", input.waMessageId);

    if (selectMsgError) {
      return {
        ok: false,
        error: `status event stored but message lookup failed: ${selectMsgError.message}`,
      };
    }

    if (!matchingMessages || matchingMessages.length === 0) {
      return {
        ok: true,
        row: {
          id: statusEventId,
          messageUpdated: false,
          messageNotFound: true,
        },
        created: true,
      };
    }

    const { error: updateError } = await supabase
      .from("whatsapp_messages")
      .update({ status: input.status, updated_at: nowIso() })
      .eq("company_id", DEFAULT_COMPANY_ID)
      .eq("wa_message_id", input.waMessageId);

    if (updateError) {
      return {
        ok: false,
        error: `status event stored but message update failed: ${updateError.message}`,
      };
    }

    return {
      ok: true,
      row: { id: statusEventId, messageUpdated: true },
      created: true,
    };
  }

  async updateConversationLastMessageAt(
    conversationId: string,
    at: string
  ): Promise<void> {
    const { error } = await this.client()
      .from("whatsapp_conversations")
      .update({ last_message_at: at, updated_at: nowIso() })
      .eq("id", conversationId);
    if (error) throw new Error(error.message);
  }

  async insertAuditEvent(input: {
    eventType: AuditEventType | string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<WhatsAppAuditEvent> {
    const row = {
      id: newId("waud"),
      company_id: DEFAULT_COMPANY_ID,
      event_type: input.eventType,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {},
    };
    const { data, error } = await this.client()
      .from("whatsapp_audit_events")
      .insert(row)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: String(data.id),
      companyId: String(data.company_id),
      eventType: String(data.event_type),
      entityType: (data.entity_type as string) ?? null,
      entityId: (data.entity_id as string) ?? null,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      createdAt: String(data.created_at),
    };
  }

  async getConversationBundle(
    conversationId: string
  ): Promise<ConversationBundle | null> {
    const supabase = this.client();
    const { data: conversation, error } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conversation) return null;

    const conv = mapConversation(conversation as Record<string, unknown>);
    const [{ data: contact }, { data: channel }] = await Promise.all([
      supabase.from("whatsapp_contacts").select("*").eq("id", conv.contactId).maybeSingle(),
      supabase.from("whatsapp_channels").select("*").eq("id", conv.channelId).maybeSingle(),
    ]);
    if (!contact || !channel) return null;
    return {
      conversation: conv,
      contact: mapContact(contact as Record<string, unknown>),
      channel: mapChannel(channel as Record<string, unknown>),
    };
  }

  async findMessageIdByWaMessageId(waMessageId: string): Promise<string | null> {
    const needle = String(waMessageId || "").trim();
    if (!needle) return null;
    const { data, error } = await this.client()
      .from("whatsapp_messages")
      .select("id")
      .eq("wa_message_id", needle)
      .eq("company_id", DEFAULT_COMPANY_ID)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id ? String(data.id) : null;
  }

  async insertOutboundMessage(input: {
    conversationId: string;
    textBody: string;
  }): Promise<WhatsAppMessage> {
    const row = {
      id: newId("wmsg"),
      company_id: DEFAULT_COMPANY_ID,
      conversation_id: input.conversationId,
      direction: MESSAGE_DIRECTIONS.OUTBOUND,
      status: MESSAGE_STATUSES.QUEUED,
      text_body: input.textBody,
      wa_message_id: null,
      occurred_at: nowIso(),
    };
    const { data, error } = await this.client()
      .from("whatsapp_messages")
      .insert(row)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapMessage(data as Record<string, unknown>);
  }

  async updateMessageStatus(input: {
    messageId: string;
    status: string;
    waMessageId?: string | null;
    providerError?: string | null;
    sentAt?: string | null;
  }): Promise<WhatsAppMessage> {
    const patch: Record<string, unknown> = {
      status: input.status,
      updated_at: nowIso(),
    };
    if (input.waMessageId !== undefined) patch.wa_message_id = input.waMessageId;
    if (input.providerError !== undefined) {
      patch.provider_error = input.providerError;
    }
    if (input.sentAt !== undefined) patch.sent_at = input.sentAt;

    const { data, error } = await this.client()
      .from("whatsapp_messages")
      .update(patch)
      .eq("id", input.messageId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapMessage(data as Record<string, unknown>);
  }
}

export function createDefaultWhatsAppRepository(): WhatsAppRepository {
  return new SupabaseWhatsAppRepository();
}

/** Safe audit helper — never throws into request path. */
export async function safeAudit(
  repo: WhatsAppRepository,
  input: {
    eventType: AuditEventType | string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    if (!repo.isActive()) return;
    await repo.insertAuditEvent(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "audit failed";
    const safe = message
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
      .replace(/secret[-_]?token[-_]?\S*/gi, "[redacted]")
      .slice(0, 200);
    console.warn("[whatsapp-transport] audit write failed:", safe);
  }
}

export { AUDIT_EVENTS };
