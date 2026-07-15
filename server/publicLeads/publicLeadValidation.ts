export const PUBLIC_LEAD_MAX_BODY_BYTES = 8 * 1024; // 8 KiB

const ALLOWED_FIELDS = new Set([
  "name",
  "email",
  "phone",
  "address",
  "city",
  "location",
  "monthlyBill",
  "monthlyUnits",
  "notes",
  "message",
  "leadSource",
]);

export type PublicLeadInput = {
  name: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  location?: string;
  monthlyBill?: number;
  monthlyUnits?: number;
  notes?: string;
  message?: string;
  leadSource?: string;
};

export type PublicLeadValidationResult =
  | { ok: true; value: PublicLeadInput }
  | { ok: false; status: 400; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s().-]{6,24}$/;

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asOptionalNumber(value: unknown): number | undefined | "invalid" {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

/**
 * Strict validation for public lead ingestion.
 * Rejects unknown fields, missing required values, and oversized payloads.
 */
export function validatePublicLeadPayload(
  body: unknown,
  options?: { rawBodyBytes?: number }
): PublicLeadValidationResult {
  if (options?.rawBodyBytes !== undefined && options.rawBodyBytes > PUBLIC_LEAD_MAX_BODY_BYTES) {
    return { ok: false, status: 400, error: "Payload too large." };
  }

  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Request body must be a JSON object." };
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  const unknown = keys.filter((k) => !ALLOWED_FIELDS.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Unknown field(s): ${unknown.sort().join(", ")}`,
    };
  }

  const name = asTrimmedString(record.name);
  const email = asTrimmedString(record.email);
  const phone = asTrimmedString(record.phone);

  if (!name) return { ok: false, status: 400, error: "name is required." };
  if (name.length > 200) return { ok: false, status: 400, error: "name is too long." };
  if (!email) return { ok: false, status: 400, error: "email is required." };
  if (!EMAIL_RE.test(email) || email.length > 320) {
    return { ok: false, status: 400, error: "email is invalid." };
  }
  if (!phone) return { ok: false, status: 400, error: "phone is required." };
  if (!PHONE_RE.test(phone)) return { ok: false, status: 400, error: "phone is invalid." };

  const monthlyBill = asOptionalNumber(record.monthlyBill);
  if (monthlyBill === "invalid") {
    return { ok: false, status: 400, error: "monthlyBill is invalid." };
  }
  const monthlyUnits = asOptionalNumber(record.monthlyUnits);
  if (monthlyUnits === "invalid") {
    return { ok: false, status: 400, error: "monthlyUnits is invalid." };
  }

  const address = asTrimmedString(record.address) ?? undefined;
  const city = asTrimmedString(record.city) ?? undefined;
  const location = asTrimmedString(record.location) ?? city ?? undefined;
  const notes = asTrimmedString(record.notes) ?? undefined;
  const message = asTrimmedString(record.message) ?? undefined;
  const leadSource = asTrimmedString(record.leadSource) ?? undefined;

  if (address && address.length > 500) {
    return { ok: false, status: 400, error: "address is too long." };
  }
  if (notes && notes.length > 2000) {
    return { ok: false, status: 400, error: "notes is too long." };
  }
  if (message && message.length > 2000) {
    return { ok: false, status: 400, error: "message is too long." };
  }

  return {
    ok: true,
    value: {
      name,
      email: email.toLowerCase(),
      phone,
      address,
      city,
      location,
      monthlyBill,
      monthlyUnits,
      notes,
      message,
      leadSource,
    },
  };
}

export function estimateJsonBodyBytes(body: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? null), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
