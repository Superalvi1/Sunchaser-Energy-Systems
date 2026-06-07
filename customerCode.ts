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
