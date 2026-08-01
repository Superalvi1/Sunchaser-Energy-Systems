/**
 * Dedicated TLS config for MARKETPLACE_CEO_AUTO_IMPORT_DATABASE_URL → `pg`.
 *
 * Root cause (pg 8.x / pg-connection-string):
 *   Passing both `connectionString` (with `?sslmode=require`) and
 *   `ssl: { rejectUnauthorized: false }` does NOT work. ConnectionParameters
 *   merges parse(connectionString) OVER the explicit `ssl` object. Current
 *   pg-connection-string treats `sslmode=require` as verify-full (`ssl: {}`),
 *   so Node verifies against the public trust store and fails with
 *   SELF_SIGNED_CERT_IN_CHAIN against Supabase's private pooler CA.
 *
 * Correction:
 *   Parse the URL once, drop sslmode-driven ssl, then apply this module's
 *   ssl object. Never set NODE_TLS_REJECT_UNAUTHORIZED. Scope is limited to
 *   the CEO auto-import commit client — not PostgREST, safeHttp, or other DBs.
 *
 * Verified TLS (preferred when available):
 *   Set MARKETPLACE_CEO_AUTO_IMPORT_DATABASE_SSL_CA to the PEM of the
 *   Supabase project CA (Database Settings → SSL). Then rejectUnauthorized
 *   remains true and the private chain verifies.
 *
 * Encrypt-only fallback (documented risk):
 *   Without a CA PEM, remote pooler connections use rejectUnauthorized:false
 *   (libpq `sslmode=require` semantics: TLS encryption, no public-CA verify).
 *   MITM risk is accepted only for this dedicated importer login URL.
 */
import { parse as parseConnectionString } from "pg-connection-string";
import type { ConnectionOptions as TlsConnectionOptions } from "node:tls";

export type AutoImportPgClientConfig = {
  connectionTimeoutMillis: number;
  user?: string;
  password?: string;
  host?: string;
  port?: number;
  database?: string;
  ssl?: boolean | TlsConnectionOptions;
};

export type BuildAutoImportPgSslOptions = {
  /** PEM contents of Supabase (or other) CA for verified TLS. */
  sslCaPem?: string | null;
};

function isLocalOrDisabledSsl(host: string, sslmode: string): boolean {
  if (sslmode === "disable") return true;
  if (host === "localhost" || host === "127.0.0.1") return true;
  return false;
}

/** Read sslmode then strip SSL query knobs so parse() cannot inject verify-full. */
function parseConnectionWithoutSslMode(connectionString: string): {
  sslmode: string;
  parsed: Record<string, unknown>;
} {
  let sslmode = "";
  let stripped = connectionString;
  try {
    const u = new URL(connectionString);
    sslmode = String(u.searchParams.get("sslmode") || "").toLowerCase();
    u.searchParams.delete("sslmode");
    u.searchParams.delete("uselibpqcompat");
    u.searchParams.delete("sslrootcert");
    stripped = u.toString();
  } catch {
    const m = connectionString.match(/[?&]sslmode=([^&]*)/i);
    sslmode = String(m?.[1] || "").toLowerCase();
  }
  const parsed = parseConnectionString(stripped) as Record<string, unknown>;
  return { sslmode, parsed };
}

/**
 * Build a `pg.Client` config that cannot be overridden by URL sslmode.
 * Does not return `connectionString` — callers must use discrete fields.
 */
export function buildAutoImportPgClientConfig(
  connectionString: string,
  opts: BuildAutoImportPgSslOptions = {},
): AutoImportPgClientConfig {
  const { sslmode, parsed } = parseConnectionWithoutSslMode(connectionString);
  const host = String(parsed.host ?? "");
  const portRaw = parsed.port;
  const port =
    portRaw === undefined || portRaw === null || portRaw === ""
      ? undefined
      : Number(portRaw);

  const base: AutoImportPgClientConfig = {
    connectionTimeoutMillis: 10_000,
    user: parsed.user != null ? String(parsed.user) : undefined,
    password: parsed.password != null ? String(parsed.password) : undefined,
    host: host || undefined,
    database: parsed.database != null ? String(parsed.database) : undefined,
    port: Number.isFinite(port) ? port : undefined,
  };

  if (isLocalOrDisabledSsl(host, sslmode)) {
    return { ...base, ssl: false };
  }

  const ca = String(opts.sslCaPem ?? "").trim();
  if (ca) {
    return {
      ...base,
      ssl: {
        rejectUnauthorized: true,
        ca,
      },
    };
  }

  // Encrypt-only fallback for Supabase Session Pooler private CA without a
  // configured PEM. Constrained to this dedicated importer client only.
  return {
    ...base,
    ssl: { rejectUnauthorized: false },
  };
}

/** True when config enables TLS without public-CA verification (fallback path). */
export function isEncryptOnlyAutoImportSsl(
  ssl: AutoImportPgClientConfig["ssl"],
): boolean {
  return (
    typeof ssl === "object" &&
    ssl != null &&
    ssl.rejectUnauthorized === false &&
    !("ca" in ssl && ssl.ca)
  );
}
