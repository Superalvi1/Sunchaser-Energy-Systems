import { getSupabase, isSupabaseActive, type Database } from "./dbManager.js";
import { normalizePakistanPhone, phonesMatch } from "./src/lib/phoneNormalize.ts";

export type InvoiceCustomerInput = {
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  cnicNtn?: string | null;
};

function placeholderEmail(phone: string, customerId: string): string {
  const norm = normalizePakistanPhone(phone) || phone.replace(/\D/g, "") || customerId;
  return `invoice+${norm}@sunchaser.invoice`;
}

async function loadAllCustomers(localDb?: Database): Promise<any[]> {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from("customers").select("*");
    if (error) throw error;
    return data || [];
  }
  return (localDb as any)?.customers || [];
}

async function findCustomerByPhone(
  phone: string,
  localDb?: Database
): Promise<string | null> {
  const norm = normalizePakistanPhone(phone);
  if (!norm) return null;
  const customers = await loadAllCustomers(localDb);
  for (const c of customers) {
    const cPhone = c.phone || "";
    if (cPhone && phonesMatch(cPhone, phone)) return c.id;
  }
  return null;
}

async function findCustomerByEmail(
  email: string,
  localDb?: Database
): Promise<string | null> {
  const needle = String(email || "").trim().toLowerCase();
  if (!needle) return null;
  const customers = await loadAllCustomers(localDb);
  const hit = customers.find(
    (c) => String(c.email || "").trim().toLowerCase() === needle
  );
  return hit?.id || null;
}

async function findCustomerByCnicNtn(
  cnicNtn: string,
  localDb?: Database
): Promise<string | null> {
  const needle = String(cnicNtn || "").trim();
  if (!needle) return null;

  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("invoices")
      .select("customer_id")
      .eq("cnic_ntn", needle)
      .not("customer_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (data?.customer_id) return data.customer_id;
  } else {
    const rows = (localDb as any)?.invoices || [];
    const hit = rows.find(
      (r: any) =>
        String(r.cnic_ntn || r.cnicNtn || "").trim() === needle &&
        (r.customer_id || r.customerId)
    );
    if (hit) return hit.customer_id || hit.customerId;
  }
  return null;
}

async function insertCustomer(
  row: {
    id: string;
    name: string;
    email: string;
    phone: string;
    address: string | null;
  },
  localDb?: Database
) {
  const payload = {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    created_at: new Date().toISOString(),
  };
  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from("customers").insert(payload);
    if (error) throw error;
  } else {
    const db = localDb as any;
    db.customers = db.customers || [];
    db.customers.push(payload);
  }
}

/**
 * Find an existing customer by phone → email → CNIC (no create).
 * Used by portal registration to link self-signup to CRM records.
 */
export async function findExistingCustomerIdForLinking(
  input: { phone?: string | null; email?: string | null; cnicNtn?: string | null },
  localDb?: Database
): Promise<string | null> {
  const phone = String(input.phone || "").trim();
  const email = String(input.email || "").trim();
  const cnic = String(input.cnicNtn || "").trim();
  let matched: string | null = null;
  if (phone) matched = await findCustomerByPhone(phone, localDb);
  if (!matched && email) matched = await findCustomerByEmail(email, localDb);
  if (!matched && cnic) matched = await findCustomerByCnicNtn(cnic, localDb);
  return matched;
}

/**
 * Resolve customer_id for an invoice when not explicitly provided.
 * Does not modify existing customer records on match.
 */
export async function resolveInvoiceCustomerId(
  input: InvoiceCustomerInput,
  localDb?: Database,
  auditContext?: { username?: string; invoiceNumber?: string }
): Promise<string | null> {
  if (input.customerId) return input.customerId;

  const name = String(input.customerName || "").trim();
  const phone = String(input.customerPhone || "").trim();
  const email = String(input.customerEmail || "").trim();
  const cnic = String(input.cnicNtn || "").trim();
  const address = String(input.customerAddress || "").trim() || null;

  const matched = await findExistingCustomerIdForLinking(
    { phone, email, cnicNtn: cnic },
    localDb
  );
  if (matched) return matched;

  if (!name || !phone) return null;

  const customerId = `cust-inv-${Date.now()}`;
  const customerEmail = email || placeholderEmail(phone, customerId);
  await insertCustomer(
    {
      id: customerId,
      name,
      email: customerEmail,
      phone,
      address,
    },
    localDb
  );

  console.warn(
    "[InvoiceCustomerLink] Auto-created customer",
    JSON.stringify({
      customerId,
      name,
      phone,
      email: customerEmail,
      createdBy: auditContext?.username || "system",
      invoiceNumber: auditContext?.invoiceNumber || null,
      at: new Date().toISOString(),
    })
  );

  return customerId;
}
