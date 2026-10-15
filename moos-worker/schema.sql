CREATE TABLE IF NOT EXISTS wa_chat (
 phone TEXT PRIMARY KEY,
 latest_message_id TEXT,
 last_inbound_at TIMESTAMPTZ,
 human_owned BOOLEAN NOT NULL DEFAULT false,
 pending_quote JSONB,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wa_inbound (
 message_id TEXT PRIMARY KEY,
 phone TEXT NOT NULL REFERENCES wa_chat(phone),
 payload JSONB NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','done','needs_review')),
 error_code TEXT
);
CREATE INDEX IF NOT EXISTS wa_inbound_queue_idx ON wa_inbound(state,received_at);
CREATE INDEX IF NOT EXISTS wa_inbound_phone_received_idx ON wa_inbound(phone, received_at DESC);
CREATE TABLE IF NOT EXISTS wa_outbound (
 send_key TEXT PRIMARY KEY,
 message_id TEXT NOT NULL REFERENCES wa_inbound(message_id),
 phone TEXT NOT NULL,
 kind TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('attempted','accepted','outcome_unknown','shadow_skipped')),
 provider_message_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wa_handoff (
 source_message_id TEXT PRIMARY KEY REFERENCES wa_inbound(message_id),
 phone TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
