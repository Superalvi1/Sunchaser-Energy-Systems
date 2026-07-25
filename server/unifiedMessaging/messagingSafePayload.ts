/**
 * Runtime validation for safe metadata / structured content persisted by the
 * Postgres messaging repository. Rejects nested objects, arrays, and
 * credential-like keys. Never silently stores unrestricted provider envelopes.
 */
import type {
  NormalizedStructuredContent,
  SafeProviderMetadata,
} from "./transportTypes.ts";
import { MessagingRepositoryError } from "./messagingRepositoryErrors.ts";

/**
 * Credential vocabulary matched as complete segmented tokens after normalizing
 * spaces, underscores, hyphens, and camelCase boundaries.
 *
 * Conservative rule: any segment equal to a credential term is rejected, even
 * when followed by non-credential suffixes (e.g. sessionDurationSeconds,
 * passwordPolicyEnabled). Safe-control examples in tests use keys that do not
 * contain these terms as whole segments (durationSeconds, policyEnabled).
 */
const CREDENTIAL_SEGMENTS = new Set([
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "session",
]);

/** Multi-segment / compacted credential compounds (lowercase, no separators). */
const CREDENTIAL_COMPOUNDS = new Set([
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "apitoken",
  "clientsecret",
  "apisecret",
  "privatekey",
  "passwordhash",
  "authorizationheader",
  "sessionid",
  "whatsappaccesstoken",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Split a metadata key into lowercase segments (camelCase / separators). */
function segmentMetadataKey(key: string): string[] {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((part) => part.length > 0);
}

function isCredentialLikeKey(key: string): boolean {
  const segments = segmentMetadataKey(key);
  if (segments.length === 0) return true;

  for (const segment of segments) {
    if (CREDENTIAL_SEGMENTS.has(segment)) return true;
    if (CREDENTIAL_COMPOUNDS.has(segment)) return true;
  }

  // Adjacent segment joins catch access+token, private+key, etc.
  for (let start = 0; start < segments.length; start += 1) {
    let joined = "";
    for (let end = start; end < segments.length; end += 1) {
      joined += segments[end];
      if (CREDENTIAL_SEGMENTS.has(joined) || CREDENTIAL_COMPOUNDS.has(joined)) {
        return true;
      }
    }
  }

  return false;
}

function assertScalar(
  field: string,
  key: string,
  value: unknown
): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new MessagingRepositoryError({
        code: "invalid_input",
        message: `${field}.${key} must be a finite number`,
      });
    }
    return value;
  }
  throw new MessagingRepositoryError({
    code: "invalid_input",
    message: `${field}.${key} must be a string, number, boolean, or null`,
  });
}

/**
 * Validate and return a SafeProviderMetadata object for persistence.
 */
export function assertSafeMetadata(
  value: unknown,
  field: string
): SafeProviderMetadata {
  if (value == null) return {};
  if (!isPlainObject(value)) {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: `${field} must be a plain object of scalar values`,
    });
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== "string" || !key.trim()) {
      throw new MessagingRepositoryError({
        code: "invalid_input",
        message: `${field} keys must be non-empty strings`,
      });
    }
    if (isCredentialLikeKey(key)) {
      throw new MessagingRepositoryError({
        code: "invalid_input",
        message: `${field} rejects credential-like key`,
        detail: "credential_like_key",
      });
    }
    if (Array.isArray(raw) || (raw !== null && typeof raw === "object")) {
      throw new MessagingRepositoryError({
        code: "invalid_input",
        message: `${field}.${key} must not be an array or nested object`,
      });
    }
    out[key] = assertScalar(field, key, raw);
  }
  return out;
}

function optString(field: string, value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new MessagingRepositoryError({
    code: "invalid_input",
    message: `${field} must be a string or null`,
  });
}

function reqString(field: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: `${field} is required`,
    });
  }
  return value;
}

function reqNumber(field: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: `${field} must be a finite number`,
    });
  }
  return value;
}

function optBoolean(field: string, value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: `${field} must be a boolean`,
    });
  }
  return value;
}

function optStringArray(field: string, value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: `${field} must be an array of strings`,
    });
  }
  return value;
}

function assertAllowedKeys(
  field: string,
  value: Record<string, unknown>,
  allowed: readonly string[]
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new MessagingRepositoryError({
        code: "invalid_input",
        message: `${field} rejects unknown field "${key}"`,
      });
    }
  }
}

/**
 * Validate NormalizedStructuredContent as its discriminated union.
 * Unknown kinds / nested raw provider payloads are rejected.
 */
export function assertStructuredContent(
  value: unknown,
  field = "structuredContent"
): NormalizedStructuredContent {
  if (value == null) return { kind: "none" };
  if (!isPlainObject(value)) {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: `${field} must be a plain object`,
    });
  }
  const kind = value.kind;
  if (typeof kind !== "string") {
    throw new MessagingRepositoryError({
      code: "invalid_input",
      message: `${field}.kind is required`,
    });
  }

  switch (kind) {
    case "none": {
      assertAllowedKeys(field, value, ["kind"]);
      return { kind: "none" };
    }
    case "media_ref": {
      assertAllowedKeys(field, value, [
        "kind",
        "mediaId",
        "mimeType",
        "filename",
        "caption",
        "sha256",
        "voice",
      ]);
      return {
        kind: "media_ref",
        mediaId: reqString(`${field}.mediaId`, value.mediaId),
        mimeType: optString(`${field}.mimeType`, value.mimeType),
        filename: optString(`${field}.filename`, value.filename),
        caption: optString(`${field}.caption`, value.caption),
        sha256: optString(`${field}.sha256`, value.sha256),
        voice: optBoolean(`${field}.voice`, value.voice),
      };
    }
    case "location": {
      assertAllowedKeys(field, value, [
        "kind",
        "latitude",
        "longitude",
        "address",
        "placeName",
      ]);
      return {
        kind: "location",
        latitude: reqNumber(`${field}.latitude`, value.latitude),
        longitude: reqNumber(`${field}.longitude`, value.longitude),
        address: optString(`${field}.address`, value.address),
        placeName: optString(`${field}.placeName`, value.placeName),
      };
    }
    case "template": {
      assertAllowedKeys(field, value, [
        "kind",
        "templateName",
        "languageCode",
        "parameterKeys",
      ]);
      return {
        kind: "template",
        templateName: reqString(`${field}.templateName`, value.templateName),
        languageCode: optString(`${field}.languageCode`, value.languageCode),
        parameterKeys: optStringArray(
          `${field}.parameterKeys`,
          value.parameterKeys
        ),
      };
    }
    case "interactive": {
      assertAllowedKeys(field, value, ["kind", "interactiveType", "title"]);
      return {
        kind: "interactive",
        interactiveType: reqString(
          `${field}.interactiveType`,
          value.interactiveType
        ),
        title: optString(`${field}.title`, value.title),
      };
    }
    case "reaction": {
      assertAllowedKeys(field, value, [
        "kind",
        "emoji",
        "targetExternalMessageId",
      ]);
      return {
        kind: "reaction",
        emoji: reqString(`${field}.emoji`, value.emoji),
        targetExternalMessageId: reqString(
          `${field}.targetExternalMessageId`,
          value.targetExternalMessageId
        ),
      };
    }
    case "system": {
      assertAllowedKeys(field, value, ["kind", "systemCode", "summary"]);
      return {
        kind: "system",
        systemCode: reqString(`${field}.systemCode`, value.systemCode),
        summary: reqString(`${field}.summary`, value.summary),
      };
    }
    default:
      throw new MessagingRepositoryError({
        code: "invalid_input",
        message: `${field}.kind is not a supported structured content kind`,
      });
  }
}
