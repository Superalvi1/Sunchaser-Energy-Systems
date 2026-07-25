export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const minutes = Math.floor(abs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format digits-only / E.164-ish phone for display (no raw LID/JID). */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 10) {
    return `+${digits}`;
  }
  return digits;
}

export type ContactDisplayInput = {
  profileName?: string | null;
  phoneE164?: string | null;
  /** @deprecated unused — never show UUID as identity */
  contactId?: string | null;
};

/**
 * Display order: real name → formatted phone → Unknown WhatsApp contact.
 * Never returns UUID-derived labels such as "Contact · <uuid suffix>".
 */
export function displayContactLabel(input: ContactDisplayInput | string): string {
  if (typeof input === "string") {
    // Legacy callers passing contactId only — do not render UUID tails.
    return "Unknown WhatsApp contact";
  }
  const name = String(input.profileName || "").trim();
  if (name && !looksLikeInternalId(name)) return name;
  const phone = formatPhoneDisplay(input.phoneE164);
  if (phone) return phone;
  return "Unknown WhatsApp contact";
}

function looksLikeInternalId(value: string): boolean {
  // Guard against accidentally showing UUIDs or @lid / jid hosts.
  if (value.includes("@")) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) return true;
  if (/^Contact\s*·/i.test(value)) return true;
  return false;
}

export function initialsFromContact(input: ContactDisplayInput): string {
  const label = displayContactLabel(input);
  if (label === "Unknown WhatsApp contact") return "?";
  const clean = label.replace(/[^a-zA-Z0-9]/g, "");
  return (clean.slice(0, 2) || "?").toUpperCase();
}

/** @deprecated use initialsFromContact */
export function initialsFromId(id: string): string {
  return initialsFromContact({ contactId: id });
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
