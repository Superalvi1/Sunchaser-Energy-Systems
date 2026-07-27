/**
 * Bounded timeouts for CEO auto-import.
 * One slow supplier / RPC must not hang the HTTP request indefinitely.
 */

/** Default overall job budget (under common ~60–100s reverse-proxy limits). */
export const DEFAULT_AUTO_IMPORT_JOB_TIMEOUT_MS = 55_000;

/** Per-supplier discovery budget (fetch + normalize). */
export const DEFAULT_AUTO_IMPORT_SUPPLIER_TIMEOUT_MS = 25_000;

/** Supabase RPC / table call budget. */
export const DEFAULT_AUTO_IMPORT_RPC_TIMEOUT_MS = 12_000;

/** DNS lookup budget inside safe HTTP. */
export const DEFAULT_AUTO_IMPORT_DNS_TIMEOUT_MS = 5_000;

export class AutoImportTimeoutError extends Error {
  readonly code = "TIMEOUT" as const;
  constructor(message: string) {
    super(message);
    this.name = "AutoImportTimeoutError";
  }
}

export function readTimeoutMs(
  env: NodeJS.ProcessEnv | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = String(env?.[key] ?? "").trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function resolveAutoImportTimeouts(env: NodeJS.ProcessEnv = process.env): {
  jobTimeoutMs: number;
  supplierTimeoutMs: number;
  rpcTimeoutMs: number;
} {
  const jobTimeoutMs = readTimeoutMs(
    env,
    "MARKETPLACE_CEO_AUTO_IMPORT_TIMEOUT_MS",
    DEFAULT_AUTO_IMPORT_JOB_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const supplierTimeoutMs = Math.min(
    jobTimeoutMs,
    readTimeoutMs(
      env,
      "MARKETPLACE_CEO_AUTO_IMPORT_SUPPLIER_TIMEOUT_MS",
      DEFAULT_AUTO_IMPORT_SUPPLIER_TIMEOUT_MS,
      100,
      90_000,
    ),
  );
  const rpcTimeoutMs = Math.min(
    jobTimeoutMs,
    readTimeoutMs(
      env,
      "MARKETPLACE_CEO_AUTO_IMPORT_RPC_TIMEOUT_MS",
      DEFAULT_AUTO_IMPORT_RPC_TIMEOUT_MS,
      100,
      60_000,
    ),
  );
  return { jobTimeoutMs, supplierTimeoutMs, rpcTimeoutMs };
}

/**
 * Race a promise against a deadline. Does not cancel the underlying work
 * (Node fetch/RPC may continue), but the caller always settles.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new AutoImportTimeoutError(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
