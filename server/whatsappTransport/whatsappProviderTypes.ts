/** Defensive Meta Cloud API webhook / Graph shapes (PR-1 subset). */

export type MetaWebhookProfile = {
  name?: string;
};

export type MetaWebhookContact = {
  wa_id?: string;
  profile?: MetaWebhookProfile;
};

export type MetaWebhookText = {
  body?: string;
};

export type MetaWebhookMedia = {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
};

export type MetaWebhookLocation = {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
};

export type MetaWebhookMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: MetaWebhookText;
  image?: MetaWebhookMedia;
  document?: MetaWebhookMedia;
  audio?: MetaWebhookMedia;
  voice?: MetaWebhookMedia;
  video?: MetaWebhookMedia;
  location?: MetaWebhookLocation;
};

export type MetaWebhookStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

export type MetaWebhookMetadata = {
  display_phone_number?: string;
  phone_number_id?: string;
};

export type MetaWebhookValue = {
  messaging_product?: string;
  metadata?: MetaWebhookMetadata;
  contacts?: MetaWebhookContact[];
  messages?: MetaWebhookMessage[];
  statuses?: MetaWebhookStatus[];
};

export type MetaWebhookChange = {
  field?: string;
  value?: MetaWebhookValue;
};

export type MetaWebhookEntry = {
  id?: string;
  changes?: MetaWebhookChange[];
};

export type MetaWebhookEnvelope = {
  object?: string;
  entry?: MetaWebhookEntry[];
};

export type MetaSendTextSuccess = {
  messaging_product?: string;
  contacts?: Array<{ input?: string; wa_id?: string }>;
  messages?: Array<{ id?: string }>;
};

export type MetaSendTextErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};
