/**
 * Process-local identity for WhatsApp Web session ownership diagnostics.
 * Never includes phones, credentials, QR data, or secrets.
 */
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";

const BOOT_UUID = randomUUID();

export function hashOpaqueId(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Stable-for-process opaque instance id.
 * Prefers Render instance id when present; otherwise boot UUID + pid.
 */
export function getWhatsAppWebProcessInstanceId(
  env: NodeJS.ProcessEnv = process.env
): string {
  const renderId = String(env.RENDER_INSTANCE_ID ?? "").trim();
  if (renderId) {
    return `render:${hashOpaqueId(renderId)}`;
  }
  return `proc:${BOOT_UUID.slice(0, 8)}:p${process.pid}`;
}

export function getWhatsAppWebProcessPid(): number {
  return process.pid;
}

/** Hostname hash only — never return raw hostnames that may include secrets. */
export function getWhatsAppWebHostHash(): string | null {
  try {
    return hashOpaqueId(os.hostname());
  } catch {
    return null;
  }
}

/** Test-only: expose boot uuid fragment for assertions. */
export function __testGetBootUuidPrefix(): string {
  return BOOT_UUID.slice(0, 8);
}
