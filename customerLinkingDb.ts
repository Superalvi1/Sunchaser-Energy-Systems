import {
  getSupabase,
  isSupabaseActive,
  verifyStaffPortalUser,
  type Database,
} from "./dbManager.js";
import { normalizePakistanPhone, phonesMatch } from "./src/lib/phoneNormalize.ts";
import { canManageCustomers, isSuperAdmin } from "./src/lib/roles.js";
import { normalizeCustomerCode } from "./customerCode.js";

export class CustomerLinkingError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function assertLinkingAdmin(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  localDb?: Database
) {
  await verifyStaffPortalUser(actorId, actorUsername, localDb);
  if (!canManageCustomers(actorUsername, actorRole) && !isSuperAdmin(actorUsername, actorRole)) {
    throw new CustomerLinkingError("Admin access required for customer linking.", 403);
  }
}

async function loadAllCustomers(localDb?: Database): Promise<any[]> {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from("customers").select("*").order("name");
    if (error) throw error;
    return data || [];
  }
  return (localDb as any)?.customers || [];
}

async function loadCustomerUsers(localDb?: Database): Promise<any[]> {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("users")
      .select("id, username, name, email, role, customer_id, account_status")
      .eq("role", "Customer")
      .order("name");
    if (error) throw error;
    return data || [];
  }
  return (localDb?.users || []).filter((u: any) => u.role === "Customer");
}

function mapCustomerRow(c: any, users: any[]) {
  const linkedUser = users.find((u: any) => u.customer_id === c.id || u.customerId === c.id);
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    customerCode: c.customer_code || c.customerCode || null,
    userId: c.user_id || c.userId || linkedUser?.id || null,
    linkedUsername: linkedUser?.username || null,
    linkedUserName: linkedUser?.name || null,
  };
}

export async function searchCustomersForLinking(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  query: string,
  localDb?: Database
) {
  await assertLinkingAdmin(actorId, actorUsername, actorRole, localDb);
  const q = String(query || "").trim().toLowerCase();
  const users = await loadCustomerUsers(localDb);
  let customers = await loadAllCustomers(localDb);

  if (q) {
    customers = customers.filter((c) => {
      const code = String(c.customer_code || "").toLowerCase();
      const name = String(c.name || "").toLowerCase();
      const email = String(c.email || "").toLowerCase();
      const phone = String(c.phone || "").toLowerCase();
      const id = String(c.id || "").toLowerCase();
      return (
        name.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        code.includes(q) ||
        id.includes(q)
      );
    });
  }

  return customers.slice(0, 50).map((c) => mapCustomerRow(c, users));
}

export async function searchPortalUsersForLinking(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  query: string,
  localDb?: Database
) {
  await assertLinkingAdmin(actorId, actorUsername, actorRole, localDb);
  const q = String(query || "").trim().toLowerCase();
  let users = await loadCustomerUsers(localDb);

  if (q) {
    users = users.filter((u) => {
      const username = String(u.username || "").toLowerCase();
      const name = String(u.name || "").toLowerCase();
      const email = String(u.email || "").toLowerCase();
      const id = String(u.id || "").toLowerCase();
      return username.includes(q) || name.includes(q) || email.includes(q) || id.includes(q);
    });
  }

  const customerIds = users.map((u) => u.customer_id || u.customerId).filter(Boolean);
  let customers: any[] = [];
  if (customerIds.length) {
    if (isSupabaseActive()) {
      const { data } = await getSupabase()!.from("customers").select("id, name, user_id").in("id", customerIds);
      customers = data || [];
    } else {
      customers = ((localDb as any)?.customers || []).filter((c: any) => customerIds.includes(c.id));
    }
  }

  return users.slice(0, 50).map((u) => {
    const cust = customers.find((c) => c.id === (u.customer_id || u.customerId));
    return {
      userId: u.id,
      username: u.username,
      name: u.name,
      email: u.email,
      customerId: u.customer_id || u.customerId || null,
      accountStatus: u.account_status || u.accountStatus || "Approved",
      linkedCustomerName: cust?.name || null,
      customerUserId: cust?.user_id || cust?.userId || null,
    };
  });
}

export async function resolveCustomerForLeadContact(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  opts: { email?: string; phone?: string; customerId?: string },
  localDb?: Database
) {
  await assertLinkingAdmin(actorId, actorUsername, actorRole, localDb);
  const users = await loadCustomerUsers(localDb);
  const customers = await loadAllCustomers(localDb);

  if (opts.customerId) {
    const hit = customers.find((c) => c.id === opts.customerId);
    return hit ? mapCustomerRow(hit, users) : null;
  }

  const email = String(opts.email || "").trim().toLowerCase();
  const phone = String(opts.phone || "").trim();

  if (phone) {
    const byPhone = customers.find((c) => c.phone && phonesMatch(c.phone, phone));
    if (byPhone) return mapCustomerRow(byPhone, users);
  }
  if (email) {
    const byEmail = customers.find((c) => String(c.email || "").trim().toLowerCase() === email);
    if (byEmail) return mapCustomerRow(byEmail, users);
  }
  return null;
}

export type DuplicatePair = {
  customerA: ReturnType<typeof mapCustomerRow>;
  customerB: ReturnType<typeof mapCustomerRow>;
  reason: string;
  matchValue: string;
};

export async function detectDuplicateCustomers(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  localDb?: Database
): Promise<DuplicatePair[]> {
  await assertLinkingAdmin(actorId, actorUsername, actorRole, localDb);
  const users = await loadCustomerUsers(localDb);
  const customers = await loadAllCustomers(localDb);
  const pairs: DuplicatePair[] = [];
  const seen = new Set<string>();

  const pushPair = (a: any, b: any, reason: string, matchValue: string) => {
    if (a.id === b.id) return;
    const key = [a.id, b.id].sort().join("|") + `:${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({
      customerA: mapCustomerRow(a, users),
      customerB: mapCustomerRow(b, users),
      reason,
      matchValue,
    });
  };

  const byPhone = new Map<string, any[]>();
  for (const c of customers) {
    const norm = normalizePakistanPhone(c.phone || "");
    if (!norm) continue;
    if (!byPhone.has(norm)) byPhone.set(norm, []);
    byPhone.get(norm)!.push(c);
  }
  for (const [phone, group] of byPhone) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        pushPair(group[i], group[j], "same normalized phone", phone);
      }
    }
  }

  const byEmail = new Map<string, any[]>();
  for (const c of customers) {
    const email = String(c.email || "").trim().toLowerCase();
    if (!email || email.includes("@sunchaser.invoice")) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email)!.push(c);
  }
  for (const [email, group] of byEmail) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        pushPair(group[i], group[j], "same lowercase email", email);
      }
    }
  }

  const cnicByCustomer = new Map<string, string>();
  if (isSupabaseActive()) {
    const { data: invRows } = await getSupabase()!
      .from("invoices")
      .select("customer_id, cnic_ntn")
      .not("customer_id", "is", null)
      .not("cnic_ntn", "is", null);
    for (const row of invRows || []) {
      const cnic = String(row.cnic_ntn || "").trim();
      const cid = row.customer_id;
      if (cnic && cid && !cnicByCustomer.has(cid)) cnicByCustomer.set(cid, cnic);
    }
  } else {
    for (const inv of (localDb as any)?.invoices || []) {
      const cnic = String(inv.cnic_ntn || inv.cnicNtn || "").trim();
      const cid = inv.customer_id || inv.customerId;
      if (cnic && cid && !cnicByCustomer.has(cid)) cnicByCustomer.set(cid, cnic);
    }
  }

  const byCnic = new Map<string, any[]>();
  for (const c of customers) {
    const cnic = cnicByCustomer.get(c.id);
    if (!cnic) continue;
    if (!byCnic.has(cnic)) byCnic.set(cnic, []);
    byCnic.get(cnic)!.push(c);
  }
  for (const [cnic, group] of byCnic) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        pushPair(group[i], group[j], "same CNIC", cnic);
      }
    }
  }

  return pairs.sort((a, b) => a.reason.localeCompare(b.reason));
}

export async function linkCustomerPortalAccounts(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  customerId: string,
  userId: string,
  confirmOverride: boolean,
  localDb?: Database
) {
  await assertLinkingAdmin(actorId, actorUsername, actorRole, localDb);
  const cid = String(customerId || "").trim();
  const uid = String(userId || "").trim();
  if (!cid || !uid) throw new CustomerLinkingError("customerId and userId are required.");

  let customer: any;
  let user: any;

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: cData, error: cErr } = await supabase.from("customers").select("*").eq("id", cid).maybeSingle();
    if (cErr) throw cErr;
    if (!cData) throw new CustomerLinkingError("Customer not found.", 404);
    customer = cData;

    const { data: uData, error: uErr } = await supabase.from("users").select("*").eq("id", uid).maybeSingle();
    if (uErr) throw uErr;
    if (!uData) throw new CustomerLinkingError("Portal user not found.", 404);
    if (uData.role !== "Customer") throw new CustomerLinkingError("Selected user is not a Customer portal account.");
    user = uData;
  } else {
    customer = ((localDb as any)?.customers || []).find((c: any) => c.id === cid);
    user = (localDb?.users || []).find((u: any) => u.id === uid);
    if (!customer) throw new CustomerLinkingError("Customer not found.", 404);
    if (!user) throw new CustomerLinkingError("Portal user not found.", 404);
    if (user.role !== "Customer") throw new CustomerLinkingError("Selected user is not a Customer portal account.");
  }

  const warnings: string[] = [];
  if (customer.user_id && customer.user_id !== uid) {
    warnings.push(`Customer is already linked to portal user ${customer.user_id}.`);
  }
  if (user.customer_id && user.customer_id !== cid) {
    warnings.push(`Portal user is already linked to customer ${user.customer_id}.`);
  }

  if (warnings.length && !confirmOverride) {
    return {
      ok: false,
      needsConfirmation: true,
      warnings,
      customer: mapCustomerRow(customer, [user]),
      user: {
        userId: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        customerId: user.customer_id || user.customerId || null,
      },
    };
  }

  const now = new Date().toISOString();

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;

    if (user.customer_id && user.customer_id !== cid) {
      await supabase
        .from("customers")
        .update({ user_id: null })
        .eq("id", user.customer_id)
        .eq("user_id", uid);
    }
    if (customer.user_id && customer.user_id !== uid) {
      await supabase
        .from("users")
        .update({ customer_id: null, updated_at: now })
        .eq("id", customer.user_id)
        .eq("customer_id", cid);
    }

    const { error: uUpdErr } = await supabase
      .from("users")
      .update({ customer_id: cid, updated_at: now })
      .eq("id", uid);
    if (uUpdErr) throw uUpdErr;

    const { error: cUpdErr } = await supabase.from("customers").update({ user_id: uid }).eq("id", cid);
    if (cUpdErr) throw cUpdErr;
  } else {
    const db = localDb as any;
    if (user.customer_id && user.customer_id !== cid) {
      const prevCust = (db.customers || []).find((c: any) => c.id === user.customer_id);
      if (prevCust?.user_id === uid) prevCust.user_id = null;
    }
    if (customer.user_id && customer.user_id !== uid) {
      const prevUser = (db.users || []).find((u: any) => u.id === customer.user_id);
      if (prevUser) prevUser.customer_id = null;
    }
    user.customer_id = cid;
    customer.user_id = uid;
  }

  return {
    ok: true,
    message: "Accounts linked successfully.",
    customerId: cid,
    userId: uid,
  };
}
