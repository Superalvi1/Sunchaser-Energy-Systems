import { randomBytes } from "crypto";
import { getSupabase, isSupabaseActive, resolveAppUserRole, type Database } from "./dbManager";
import { findExistingCustomerIdForLinking } from "./invoiceCustomerLink.js";
import { findCustomerByCode, generateCustomerCode, normalizeCustomerCode } from "./customerCode.js";
import { hashPassword, verifyPassword } from "./src/lib/passwordHash";
import {
  canSelfRegister,
  isSuperAdmin,
  selfRegisterRequiresApproval,
  type AccountStatus,
  ADMIN_ONLY_CREATE_ROLES,
  APP_ROLES,
} from "./src/lib/roles";
import { canDeleteUser, isHighValueProtectedUser } from "./src/lib/userDeleteGuards.ts";
import { isDemoSeedUser } from "./src/lib/demoUserCleanup.ts";

export class UserAuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function token() {
  return randomBytes(24).toString("hex");
}

function expiresHours(h: number) {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

export function mapUserRow(row: any) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    role: resolveAppUserRole(row.username, row.role),
    customerId: row.customer_id || row.customerId || undefined,
    accountStatus: (row.account_status || row.accountStatus || "Approved") as AccountStatus,
    emailVerified: !!(row.email_verified ?? row.emailVerified),
    onboardingCompleted: !!(row.onboarding_completed ?? row.onboardingCompleted),
    onboardingCompletedAt: row.onboarding_completed_at || row.onboardingCompletedAt || undefined,
    approvedAt: row.approved_at || row.approvedAt || undefined,
    approvedBy: row.approved_by || row.approvedBy || undefined,
    rejectedReason: row.rejected_reason || row.rejectedReason || undefined,
    createdAt: row.created_at || row.createdAt,
  };
}

export function publicAppUrl(path: string) {
  const base = (process.env.APP_PUBLIC_URL || process.env.VITE_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function sendAuthEmail(to: string, subject: string, html: string) {
  console.log("[Auth Email]", { to, subject, html: html.slice(0, 200) });
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM || "Sunchaser <noreply@sunchaser-energy.com>";
  if (!apiKey) return { sent: false, logged: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    return { sent: res.ok, logged: false };
  } catch (err) {
    console.error("[Auth Email] send failed", err);
    return { sent: false, logged: true };
  }
}

async function findUserByUsername(username: string, localDb?: Database) {
  const normalized = String(username || "").trim().toLowerCase();
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from("users").select("*").eq("username", normalized).maybeSingle();
    if (error) throw error;
    return data;
  }
  return (localDb?.users || []).find((u: any) => String(u.username).toLowerCase() === normalized);
}

async function findUserByEmail(email: string, localDb?: Database) {
  const normalized = String(email || "").trim().toLowerCase();
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .ilike("email", normalized)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  return (localDb?.users || []).find((u: any) => String(u.email).toLowerCase() === normalized);
}

export async function authenticateUser(
  username: string,
  password: string,
  localDb?: Database
) {
  const row = await findUserByUsername(username, localDb);
  if (!row || !verifyPassword(password, String(row.password || ""))) {
    throw new UserAuthError("Invalid credentials.", 401);
  }

  const status = row.account_status || "Approved";
  if (status === "Pending") {
    throw new UserAuthError("Your account is pending Super Admin approval.", 403);
  }
  if (status === "Rejected") {
    throw new UserAuthError(row.rejected_reason || "Your registration was rejected.", 403);
  }
  if (status === "Suspended") {
    throw new UserAuthError("Your account is suspended. Contact Sunchaser admin.", 403);
  }

  const emailVerified = !!(row.email_verified ?? row.emailVerified);
  const role = resolveAppUserRole(row.username, row.role);
  if (!emailVerified && role !== "Customer") {
    throw new UserAuthError("Please verify your email before signing in.", 403);
  }

  return mapUserRow(row);
}

export async function registerUser(
  body: {
    username: string;
    password: string;
    name: string;
    email: string;
    role: string;
    phone?: string;
    cnic?: string;
    cnicNtn?: string;
    customerCode?: string;
    invitationCode?: string;
  },
  localDb?: Database
) {
  const username = String(body.username || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const role = String(body.role || "").trim();
  const password = String(body.password || "");

  if (!username || !email || !name || !password) {
    throw new UserAuthError("Username, name, email, and password are required.");
  }
  if (!canSelfRegister(role)) {
    throw new UserAuthError(`${role} cannot self-register. Contact Super Admin.`);
  }
  if (await findUserByUsername(username, localDb)) {
    throw new UserAuthError("Username already taken.");
  }
  if (await findUserByEmail(email, localDb)) {
    throw new UserAuthError("Email already registered.");
  }

  const needsApproval = selfRegisterRequiresApproval(role);
  const accountStatus: AccountStatus = needsApproval ? "Pending" : "Approved";
  const emailVerified = role === "Customer";
  const verificationToken = emailVerified ? null : token();
  const id = `u-${Date.now()}`;

  const row: any = {
    id,
    username,
    password: hashPassword(password),
    name,
    email,
    role,
    account_status: accountStatus,
    email_verified: emailVerified,
    verification_token: verificationToken,
    verification_token_expires_at: verificationToken ? expiresHours(48) : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let linkCustomerAfterInsert = false;

  if (role === "Customer") {
    const phone = String(body.phone || "").trim();
    const cnic = String(body.cnicNtn || body.cnic || "").trim();
    const rawInvitation = String(body.customerCode || body.invitationCode || "").trim();

    if (rawInvitation) {
      const normalizedCode = normalizeCustomerCode(rawInvitation);
      if (!normalizedCode) {
        throw new UserAuthError("Invalid customer code. Please check and try again.");
      }
      const matchedCustomer = await findCustomerByCode(normalizedCode, localDb);
      if (!matchedCustomer) {
        throw new UserAuthError("Invalid customer code. Please check and try again.");
      }
      if (matchedCustomer.user_id && matchedCustomer.user_id !== id) {
        throw new UserAuthError("This customer code is already linked to another portal account.");
      }
      row.customer_id = matchedCustomer.id;
      linkCustomerAfterInsert = true;
    } else {
      const matchedCustomerId = await findExistingCustomerIdForLinking(
        { phone: phone || null, email, cnicNtn: cnic || null },
        localDb
      );
      const customerId = matchedCustomerId || `cust-${id.replace(/^u-/, "")}`;
      row.customer_id = customerId;
      if (matchedCustomerId) {
        linkCustomerAfterInsert = true;
      } else {
        await ensureCustomerRecord(customerId, { name, email, phone }, localDb);
      }
    }
  }

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { error } = await supabase.from("users").insert(row);
    if (error) throw error;
    if (role === "Customer" && row.customer_id) {
      if (linkCustomerAfterInsert) {
        await linkExistingCustomerToPortalUser(
          row.customer_id,
          id,
          { name, email, phone: String(body.phone || "").trim() },
          localDb
        );
      } else {
        await getSupabase()!
          .from("customers")
          .update({ user_id: id })
          .eq("id", row.customer_id);
      }
    }
  } else if (localDb) {
    localDb.users = localDb.users || [];
    localDb.users.push(row);
    if (role === "Customer" && row.customer_id && linkCustomerAfterInsert) {
      await linkExistingCustomerToPortalUser(
        row.customer_id,
        id,
        { name, email, phone: String(body.phone || "").trim() },
        localDb
      );
    }
  }

  let verificationUrl: string | null = null;
  if (verificationToken) {
    verificationUrl = publicAppUrl(`/verify-email?token=${verificationToken}`);
    await sendAuthEmail(
      email,
      "Verify your Sunchaser account",
      `<p>Hello ${name},</p><p>Please verify your email: <a href="${verificationUrl}">${verificationUrl}</a></p>`
    );
  }

  return {
    user: mapUserRow(row),
    needsApproval,
    verificationUrl,
    message: needsApproval
      ? "Registration submitted. Verify your email, then wait for Super Admin approval."
      : "Registration complete. You can sign in now.",
  };
}

export async function verifyEmailToken(tokenValue: string, localDb?: Database) {
  const t = String(tokenValue || "").trim();
  if (!t) throw new UserAuthError("Verification token required.");

  let row: any;
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("verification_token", t)
      .maybeSingle();
    if (error) throw error;
    row = data;
  } else {
    row = (localDb?.users || []).find((u: any) => u.verification_token === t);
  }

  if (!row) throw new UserAuthError("Invalid or expired verification link.");
  const exp = row.verification_token_expires_at;
  if (exp && new Date(exp).getTime() < Date.now()) {
    throw new UserAuthError("Verification link expired.");
  }

  const patch = {
    email_verified: true,
    verification_token: null,
    verification_token_expires_at: null,
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseActive()) {
    await getSupabase()!.from("users").update(patch).eq("id", row.id);
  } else {
    Object.assign(row, patch);
  }

  return { ok: true, message: "Email verified successfully." };
}

export async function requestPasswordReset(email: string, localDb?: Database) {
  const row = await findUserByEmail(email, localDb);
  if (!row) {
    return { ok: true, message: "If that email exists, a reset link was sent." };
  }
  const resetToken = token();
  const patch = {
    reset_token: resetToken,
    reset_token_expires_at: expiresHours(2),
    updated_at: new Date().toISOString(),
  };
  if (isSupabaseActive()) {
    await getSupabase()!.from("users").update(patch).eq("id", row.id);
  } else {
    Object.assign(row, patch);
  }
  const resetUrl = publicAppUrl(`/reset-password?token=${resetToken}`);
  await sendAuthEmail(
    row.email,
    "Reset your Sunchaser password",
    `<p>Reset password: <a href="${resetUrl}">${resetUrl}</a></p><p>Link expires in 2 hours.</p>`
  );
  return { ok: true, message: "If that email exists, a reset link was sent.", resetUrl };
}

export async function resetPasswordWithToken(
  tokenValue: string,
  newPassword: string,
  localDb?: Database
) {
  const t = String(tokenValue || "").trim();
  if (!t || !newPassword) throw new UserAuthError("Token and new password required.");

  let row: any;
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("users")
      .select("*")
      .eq("reset_token", t)
      .maybeSingle();
    if (error) throw error;
    row = data;
  } else {
    row = (localDb?.users || []).find((u: any) => u.reset_token === t);
  }

  if (!row) throw new UserAuthError("Invalid or expired reset link.");
  const exp = row.reset_token_expires_at;
  if (exp && new Date(exp).getTime() < Date.now()) {
    throw new UserAuthError("Reset link expired.");
  }

  const patch = {
    password: hashPassword(newPassword),
    reset_token: null,
    reset_token_expires_at: null,
    updated_at: new Date().toISOString(),
  };
  if (isSupabaseActive()) {
    await getSupabase()!.from("users").update(patch).eq("id", row.id);
  } else {
    Object.assign(row, patch);
  }
  return { ok: true, message: "Password updated. You can sign in now." };
}

export async function assertSuperAdminActor(userId: string, username: string, localDb?: Database) {
  const row = isSupabaseActive()
    ? (await getSupabase()!.from("users").select("*").eq("id", userId).single()).data
    : (localDb?.users || []).find((u: any) => u.id === userId);
  if (!row || !isSuperAdmin(username, resolveAppUserRole(row.username, row.role))) {
    throw new UserAuthError("Super Admin access required.", 403);
  }
  return mapUserRow(row);
}

export async function listUsersForAdmin(actorId: string, actorUsername: string, localDb?: Database) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("users")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapUserRow);
  }
  return (localDb?.users || []).map(mapUserRow);
}

export async function listPendingUsers(actorId: string, actorUsername: string, localDb?: Database) {
  const all = await listUsersForAdmin(actorId, actorUsername, localDb);
  return all.filter((u) => u.accountStatus === "Pending");
}

export async function approveUser(
  actorId: string,
  actorUsername: string,
  targetUserId: string,
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  const patch = {
    account_status: "Approved",
    approved_at: new Date().toISOString(),
    approved_by: actorUsername,
    rejected_reason: null,
    updated_at: new Date().toISOString(),
  };
  await updateUserRow(targetUserId, patch, localDb);
  return { ok: true, message: "User approved." };
}

export async function rejectUser(
  actorId: string,
  actorUsername: string,
  targetUserId: string,
  reason: string,
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  const patch = {
    account_status: "Rejected",
    rejected_reason: reason || "Registration rejected by administrator.",
    updated_at: new Date().toISOString(),
  };
  await updateUserRow(targetUserId, patch, localDb);
  return { ok: true, message: "User rejected." };
}

export async function createUserByAdmin(
  actorId: string,
  actorUsername: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  const role = String(body.role || "").trim();
  if (!(APP_ROLES as readonly string[]).includes(role)) {
    throw new UserAuthError("Invalid role.");
  }

  const username = String(body.username || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "ChangeMe123!");

  if (!username || !email || !name) {
    throw new UserAuthError("Username, name, and email are required.");
  }

  if (await findUserByUsername(username, localDb)) throw new UserAuthError("Username taken.");
  if (await findUserByEmail(email, localDb)) throw new UserAuthError("Email taken.");

  const id = `u-${Date.now()}`;
  const row: any = {
    id,
    username,
    password: hashPassword(password),
    name,
    email,
    role,
    account_status: String(body.accountStatus || "Approved"),
    email_verified: true,
    approved_at: new Date().toISOString(),
    approved_by: actorUsername,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (role === "Customer") {
    const customerId = String(body.customerId || `cust-${id.replace(/^u-/, "")}`);
    row.customer_id = customerId;
    await ensureCustomerRecord(
      customerId,
      { name, email, userId: id, phone: String(body.phone || "") },
      localDb
    );
  }

  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from("users").insert(row);
    if (error) throw error;
    if (role === "Customer" && row.customer_id) {
      await getSupabase()!
        .from("customers")
        .update({ user_id: id })
        .eq("id", row.customer_id);
    }
    const persisted = await getUserById(id, localDb);
    mirrorUserToLocalDb(persisted, localDb);
    return mapUserRow(persisted);
  }
  mirrorUserToLocalDb(row, localDb);
  return mapUserRow(row);
}

async function linkExistingCustomerToPortalUser(
  customerId: string,
  userId: string,
  opts: { name: string; email: string; phone?: string },
  localDb?: Database
) {
  let existing: any = null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .maybeSingle();
    existing = data;
  } else {
    existing = ((localDb as any)?.customers || []).find((c: any) => c.id === customerId);
  }

  const patch: Record<string, unknown> = { user_id: userId };
  if (existing) {
    if (!String(existing.name || "").trim() && opts.name) patch.name = opts.name;
    if (!String(existing.email || "").trim() && opts.email) patch.email = opts.email;
    if (!String(existing.phone || "").trim() && opts.phone) patch.phone = opts.phone;
  }

  if (isSupabaseActive()) {
    await getSupabase()!.from("customers").update(patch).eq("id", customerId);
    return;
  }

  const db = localDb as any;
  if (!db?.customers) return;
  const idx = db.customers.findIndex((c: any) => c.id === customerId);
  if (idx >= 0) Object.assign(db.customers[idx], patch);
}

async function ensureCustomerRecord(
  customerId: string,
  opts: { name: string; email: string; userId?: string; phone?: string },
  localDb?: Database
) {
  const now = new Date().toISOString();
  const customerCode = await generateCustomerCode(localDb);
  const customerRow = {
    id: customerId,
    name: opts.name,
    email: opts.email,
    phone: opts.phone || null,
    address: null,
    customer_code: customerCode,
    created_at: now,
  };

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();
    if (existing) {
      const patch: Record<string, unknown> = { name: opts.name, email: opts.email };
      if (opts.userId) patch.user_id = opts.userId;
      await supabase.from("customers").update(patch).eq("id", customerId);
      return;
    }
    const { error } = await supabase.from("customers").insert(customerRow);
    if (error) throw error;
    return;
  }

  const db = localDb as any;
  if (!db) return;
  db.customers = db.customers || [];
  const idx = db.customers.findIndex((c: any) => c.id === customerId);
  if (idx >= 0) {
    db.customers[idx] = { ...db.customers[idx], ...customerRow };
  } else {
    db.customers.push(customerRow);
  }
}

export async function updateUserByAdmin(
  actorId: string,
  actorUsername: string,
  targetUserId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.accountStatus) patch.account_status = body.accountStatus;
  if (body.role) patch.role = body.role;
  if (body.name) patch.name = body.name;
  if (body.email) patch.email = body.email;
  if (body.password) patch.password = hashPassword(String(body.password));
  await updateUserRow(targetUserId, patch, localDb);
  const row = await getUserById(targetUserId, localDb);
  return mapUserRow(row);
}

async function updateUserRow(id: string, patch: Record<string, unknown>, localDb?: Database) {
  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from("users").update(patch).eq("id", id);
    if (error) throw error;
    return;
  }
  const row = (localDb?.users || []).find((u: any) => u.id === id);
  if (!row) throw new UserAuthError("User not found.", 404);
  Object.assign(row, patch);
}

function mirrorUserToLocalDb(row: any, localDb?: Database) {
  if (!localDb) return;
  localDb.users = localDb.users || [];
  const idx = localDb.users.findIndex((u: any) => u.id === row.id);
  if (idx >= 0) localDb.users[idx] = { ...localDb.users[idx], ...row };
  else localDb.users.push(row);
}

function removeUserFromLocalDb(userId: string, localDb?: Database) {
  if (!localDb?.users) return;
  localDb.users = localDb.users.filter((u: any) => u.id !== userId);
}

/** Clear assignee FKs; historical text fields (audit logs, invoice creator names) are preserved. */
async function clearUserForeignReferences(userId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    await supabase
      .from("project_deliveries")
      .update({ assigned_technician_user_id: null })
      .eq("assigned_technician_user_id", userId);
    await supabase
      .from("technical_job_updates")
      .update({ assigned_user_id: null })
      .eq("assigned_user_id", userId);
    return;
  }
  const db = localDb as any;
  for (const d of db?.projectDeliveries || []) {
    if (d.assigned_technician_user_id === userId || d.assignedTechnicianUserId === userId) {
      d.assigned_technician_user_id = null;
      d.assignedTechnicianUserId = null;
    }
  }
  for (const u of db?.technicalJobUpdates || []) {
    if (u.assigned_user_id === userId || u.assignedUserId === userId) {
      u.assigned_user_id = null;
      u.assignedUserId = null;
    }
  }
}

async function getUserById(id: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from("users").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw new UserAuthError("User not found.", 404);
    return data;
  }
  const row = (localDb?.users || []).find((u: any) => u.id === id);
  if (!row) throw new UserAuthError("User not found.", 404);
  return row;
}

export async function deleteUserByAdmin(
  actorId: string,
  actorUsername: string,
  targetUserId: string,
  opts: { confirmText?: string; unlinkCustomer?: boolean },
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  const confirmText = String(opts.confirmText || "").trim().toUpperCase();
  if (confirmText !== "DELETE") {
    throw new UserAuthError('Type DELETE to permanently remove this user.', 400);
  }

  const target = await getUserById(targetUserId, localDb);
  const mapped = mapUserRow(target);
  const gate = canDeleteUser(mapped, actorId);
  if (!gate.allowed) {
    throw new UserAuthError(gate.reason || "Delete not allowed.", 403);
  }

  const linkedCustomerId = target.customer_id || target.customerId || null;
  let linkedCustomerName: string | null = null;

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    if (linkedCustomerId) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name")
        .eq("id", linkedCustomerId)
        .maybeSingle();
      linkedCustomerName = cust?.name || null;
    }
    if (opts.unlinkCustomer !== false) {
      await supabase.from("customers").update({ user_id: null }).eq("user_id", targetUserId);
    }
    await clearUserForeignReferences(targetUserId, localDb);
    const { error } = await supabase.from("users").delete().eq("id", targetUserId);
    if (error) throw error;
    removeUserFromLocalDb(targetUserId, localDb);
  } else {
    const db = localDb as any;
    if (db?.customers && opts.unlinkCustomer !== false) {
      for (const c of db.customers) {
        if (c.user_id === targetUserId || c.userId === targetUserId) {
          c.user_id = null;
          c.userId = null;
          linkedCustomerName = linkedCustomerName || c.name || null;
        }
      }
    }
    await clearUserForeignReferences(targetUserId, localDb);
    removeUserFromLocalDb(targetUserId, localDb);
  }

  return {
    ok: true,
    message: isHighValueProtectedUser(mapped)
      ? "Protected staff account permanently deleted."
      : "User permanently deleted.",
    deletedUserId: targetUserId,
    unlinkedCustomerId: linkedCustomerId,
    linkedCustomerName,
  };
}

export async function listDemoSeedUsersForCleanup(
  actorId: string,
  actorUsername: string,
  localDb?: Database
) {
  const all = await listUsersForAdmin(actorId, actorUsername, localDb);
  return all
    .filter((u) => isDemoSeedUser(u))
    .map((u) => ({
      ...u,
      demoLabel: isDemoSeedUser(u) ? u.name : u.username,
    }));
}

export async function deleteDemoSeedUsersByAdmin(
  actorId: string,
  actorUsername: string,
  body: { confirmText?: string; userIds?: string[] },
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  const confirmText = String(body.confirmText || "").trim().toUpperCase();
  if (confirmText !== "DELETE") {
    throw new UserAuthError('Type DELETE to permanently remove this user.', 400);
  }

  const demos = await listDemoSeedUsersForCleanup(actorId, actorUsername, localDb);
  const allowedIds = new Set(demos.map((u) => u.id));
  const requested = (body.userIds || []).map((id) => String(id).trim()).filter(Boolean);
  const toDelete = requested.length ? requested.filter((id) => allowedIds.has(id)) : [...allowedIds];

  if (!toDelete.length) {
    return { ok: true, deleted: [], message: "No demo users matched for cleanup." };
  }

  const deleted: string[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const id of toDelete) {
    try {
      await deleteUserByAdmin(actorId, actorUsername, id, { confirmText: "DELETE" }, localDb);
      deleted.push(id);
    } catch (err: any) {
      errors.push({ id, error: err?.message || "Delete failed." });
    }
  }

  return {
    ok: errors.length === 0,
    deleted,
    errors,
    message:
      deleted.length > 0
        ? `Removed ${deleted.length} demo user(s). Invoices, quotations, and audit logs were preserved.`
        : "No demo users were deleted.",
  };
}

export { ADMIN_ONLY_CREATE_ROLES };
