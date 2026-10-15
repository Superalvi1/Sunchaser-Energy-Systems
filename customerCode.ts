import { randomInt } from "crypto";
import { getSupabase, isSupabaseActive, type Database } from "./dbManager.js";

const CODE_PREFIX = "SES";
const MAX_RETRIES = 40;

/** Normalize user input to canonical SES-XXXXXX or null if invalid. */
export function normalizeCustomerCode(input: string): string | null {
  let s = String(input || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  const match = s.match(/^SES-?(\d{6})$/);
  if (!match) return null;
  return `${CODE_PREFIX}-${match[1]}`;
}

function randomSixDigit(): string {
  return String(randomInt(100000, 1000000));
}

async function customerCodeExists(code: string, localDb?: Database): Promise<boolean> {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("customers")
      .select("id")
      .eq("customer_code", code)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }
  const customers = (localDb as any)?.customers || [];
  return customers.some((c: any) => String(c.customer_code || "").toUpperCase() === code);
}

/** Generate a unique SES-XXXXXX code. Retries on collision. */
export async function generateCustomerCode(localDb?: Database): Promise<string> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const code = `${CODE_PREFIX}-${randomSixDigit()}`;
    if (!(await customerCodeExists(code, localDb))) return code;
  }
  throw new Error("Failed to generate unique customer code after retries.");
}

/** Attempts at one insert before giving up (each attempt draws a fresh code). */
export const CUSTOMER_CODE_INSERT_ATTEMPTS = 5;

/**
 * True when a database error is the unique constraint on the customer code (SQLSTATE 23505 naming customer_code), whichever way the driver
 * words it. A clash on the row id or on any other constraint is NOT this: retrying with a new code would not help and would hide a real fault.
 */
export function isCustomerCodeConflict(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null | undefined;
  if (!e) return false;
  const text = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`.toLowerCase();
  return String(e.code ?? "") === "23505" && text.includes("customer_code");
}

/**
 * Insert-time collision safety. The existence check in generateCustomerCode() and the insert are two steps: another request (this company or
 * another one - the unique index spans all companies) can take the same random code in between. The insert then fails with SQLSTATE 23505 on the
 * customer-code index. This runs `insert(code)`; on exactly that conflict it draws a NEW code and tries again, at most CUSTOMER_CODE_INSERT_ATTEMPTS
 * times in all. Any other error is returned at once, unretried. When the attempts are used up the last conflict is returned (never an endless loop).
 * `first` is a code the caller already generated (used for the first attempt only).
 */
export async function insertWithUniqueCustomerCode<R extends { error?: any }>(
  insert: (code: string) => PromiseLike<R> | R,
  opts: { first?: string; localDb?: Database; attempts?: number } = {}
): Promise<R & { customerCode: string; attempts: number }> {
  const max = Math.max(1, opts.attempts ?? CUSTOMER_CODE_INSERT_ATTEMPTS);
  let code = opts.first || (await generateCustomerCode(opts.localDb));
  let last: R;
  for (let attempt = 1; ; attempt++) {
    last = await insert(code);
    if (!last?.error || !isCustomerCodeConflict(last.error) || attempt >= max) {
      return Object.assign({}, last, { customerCode: code, attempts: attempt }) as R & { customerCode: string; attempts: number };
    }
    code = await generateCustomerCode(opts.localDb);
  }
}

export async function findCustomerByCode(
  codeInput: string,
  localDb?: Database
): Promise<any | null> {
  const code = normalizeCustomerCode(codeInput);
  if (!code) return null;

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("customers")
      .select("*")
      .eq("customer_code", code)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  return (
    ((localDb as any)?.customers || []).find(
      (c: any) => normalizeCustomerCode(c.customer_code || "") === code
    ) || null
  );
}

/** Assign customer_code only when the row has none. Never overwrites existing codes. */
export async function ensureCustomerCodeOnRecord(
  customerId: string,
  localDb?: Database
): Promise<string | null> {
  const id = String(customerId || "").trim();
  if (!id) return null;

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: existing, error } = await supabase
      .from("customers")
      .select("customer_code")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!existing) return null;
    const current = String(existing.customer_code || "").trim();
    if (current) return normalizeCustomerCode(current) || current;

    for (let i = 0; i < MAX_RETRIES; i++) {
      const code = await generateCustomerCode(localDb);
      const { data: updated, error: updErr } = await supabase
        .from("customers")
        .update({ customer_code: code })
        .eq("id", id)
        .is("customer_code", null)
        .select("customer_code")
        .maybeSingle();
      if (updErr) throw updErr;
      if (updated?.customer_code) return updated.customer_code;

      const { data: refetch } = await supabase
        .from("customers")
        .select("customer_code")
        .eq("id", id)
        .maybeSingle();
      if (refetch?.customer_code) return refetch.customer_code;
    }
    return null;
  }

  const db = localDb as any;
  if (!db?.customers) return null;
  const idx = db.customers.findIndex((c: any) => c.id === id);
  if (idx < 0) return null;
  const row = db.customers[idx];
  if (row.customer_code) return row.customer_code;
  const code = await generateCustomerCode(localDb);
  db.customers[idx] = { ...row, customer_code: code };
  return code;
}
