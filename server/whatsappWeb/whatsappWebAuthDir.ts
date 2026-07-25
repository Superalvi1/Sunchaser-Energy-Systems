/**
 * Auth-directory containment helpers.
 * Logout may delete only the intended session directory under WHATSAPP_WEB_AUTH_DIR.
 * Never use an unvalidated recursive-delete path.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  WHATSAPP_WEB_SESSION_DIR_NAME,
  type WhatsAppWebConfig,
} from "./whatsappWebConfig.ts";

export type ResolvedAuthPaths = {
  /** Absolute, normalized auth root. */
  authRoot: string;
  /** Absolute session directory (authRoot/sunchaser). */
  sessionDir: string;
};

/**
 * Resolve and validate auth root + session directory.
 * Ensures the session directory resolves inside the auth root (no traversal).
 */
export function resolveWhatsAppWebAuthPaths(
  config: Pick<WhatsAppWebConfig, "authDir">
): ResolvedAuthPaths {
  const raw = String(config.authDir ?? "").trim();
  if (!raw) {
    throw new Error("WhatsApp Web auth directory is not configured");
  }
  const authRoot = path.resolve(raw);
  const sessionDir = path.resolve(authRoot, WHATSAPP_WEB_SESSION_DIR_NAME);
  assertPathInsideRoot(sessionDir, authRoot);
  return { authRoot, sessionDir };
}

/** Throw if candidate is outside root (after resolve). */
export function assertPathInsideRoot(candidate: string, root: string): void {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (
    rel.startsWith("..") ||
    path.isAbsolute(rel) ||
    resolvedCandidate === resolvedRoot
  ) {
    // Session dir must be a strict subdirectory of auth root.
    if (resolvedCandidate === resolvedRoot) {
      throw new Error("Refusing to operate on auth root itself");
    }
    throw new Error("Resolved path escapes WhatsApp Web auth directory");
  }
}

/**
 * Ensure auth root and session directory exist and are writable.
 * Production fail-closed when unavailable.
 */
export async function ensureWhatsAppWebAuthDirWritable(
  paths: ResolvedAuthPaths
): Promise<void> {
  await fsp.mkdir(paths.authRoot, { recursive: true, mode: 0o700 });
  await fsp.mkdir(paths.sessionDir, { recursive: true, mode: 0o700 });

  const probe = path.join(paths.sessionDir, ".write-probe");
  assertPathInsideRoot(probe, paths.authRoot);
  await fsp.writeFile(probe, "ok", { encoding: "utf8", mode: 0o600 });
  await fsp.unlink(probe);

  // Sync permission tightening (best effort).
  try {
    fs.chmodSync(paths.authRoot, 0o700);
    fs.chmodSync(paths.sessionDir, 0o700);
  } catch {
    /* ignore on platforms that do not support chmod */
  }
}

/**
 * Delete only the intended session directory after containment checks.
 * Uses realpath when the directory exists to defeat symlink escapes.
 */
export async function deleteWhatsAppWebSessionDir(
  paths: ResolvedAuthPaths
): Promise<{ deleted: boolean }> {
  const authRootReal = await realpathOrSelf(paths.authRoot);
  // Ensure auth root exists before containment checks against it.
  await fsp.mkdir(authRootReal, { recursive: true, mode: 0o700 });

  let sessionReal: string;
  try {
    sessionReal = await fsp.realpath(paths.sessionDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { deleted: false };
    }
    throw err;
  }

  assertPathInsideRoot(sessionReal, authRootReal);

  // Extra guard: basename must match the expected session folder name.
  if (path.basename(sessionReal) !== WHATSAPP_WEB_SESSION_DIR_NAME) {
    throw new Error("Refusing to delete unexpected session directory name");
  }

  // Contained path only — force allows removing non-empty session trees safely.
  await fsp.rm(sessionReal, { recursive: true, force: true });
  return { deleted: true };
}

async function realpathOrSelf(target: string): Promise<string> {
  try {
    return await fsp.realpath(target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return path.resolve(target);
    }
    throw err;
  }
}
