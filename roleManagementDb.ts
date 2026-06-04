import { getSupabase, isSupabaseActive, type Database } from "./dbManager";
import { assertSuperAdminActor, UserAuthError } from "./userAuthDb";
import {
  ALL_PERMISSION_KEYS,
  APP_ROLES,
  PERMISSION_LABELS,
  ROLE_PERMISSIONS,
  type PermissionKey,
} from "./src/lib/roles";

export class RoleManagementError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function mapRoleRow(row: any, permissions: PermissionKey[] = []) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isSystem: !!(row.is_system ?? row.isSystem),
    clonedFrom: row.cloned_from || row.clonedFrom || null,
    permissions,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

const localRoles: any[] = [];
const localRolePerms: Record<string, PermissionKey[]> = {};

async function seedSystemRoles(localDb?: Database) {
  try {
  for (const name of APP_ROLES) {
    const id = `role-${slugify(name)}`;
    const perms = [...(ROLE_PERMISSIONS[name as keyof typeof ROLE_PERMISSIONS] || [])];
    const row = {
      id,
      name,
      slug: slugify(name),
      is_system: true,
      cloned_from: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (isSupabaseActive()) {
      const supabase = getSupabase()!;
      await supabase.from("roles").upsert(row, { onConflict: "id" });
      for (const key of ALL_PERMISSION_KEYS) {
        await supabase.from("role_permissions").upsert(
          { role_id: id, permission_key: key, enabled: perms.includes(key) },
          { onConflict: "role_id,permission_key" }
        );
      }
    } else {
      const idx = localRoles.findIndex((r) => r.id === id);
      if (idx >= 0) localRoles[idx] = row;
      else localRoles.push(row);
      localRolePerms[id] = perms;
    }
  }
  } catch (err) {
    console.warn("[roles] seed skipped (tables may not exist yet):", (err as Error).message);
  }
}

async function loadPermissionsForRole(roleId: string, localDb?: Database): Promise<PermissionKey[]> {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("role_permissions")
      .select("permission_key, enabled")
      .eq("role_id", roleId);
    if (error) throw error;
    return (data || [])
      .filter((p: any) => p.enabled)
      .map((p: any) => p.permission_key as PermissionKey);
  }
  return localRolePerms[roleId] || [];
}

export async function listManagedRoles(
  actorId: string,
  actorUsername: string,
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  await seedSystemRoles(localDb);

  let rows: any[] = [];
  if (isSupabaseActive()) {
    try {
      const { data, error } = await getSupabase()!
        .from("roles")
        .select("*")
        .order("is_system", { ascending: false })
        .order("name");
      if (error) throw error;
      rows = data || [];
    } catch (err: any) {
      console.warn("[roles] list failed:", err.message);
      return APP_ROLES.map((name) => ({
        id: `role-${slugify(name)}`,
        name,
        slug: slugify(name),
        isSystem: true,
        permissions: [...(ROLE_PERMISSIONS[name as keyof typeof ROLE_PERMISSIONS] || [])],
      }));
    }
  } else {
    rows = [...localRoles];
  }

  const roles = [];
  for (const row of rows) {
    const permissions = await loadPermissionsForRole(row.id, localDb);
    roles.push(mapRoleRow(row, permissions));
  }
  return roles;
}

export async function getRolesMatrixFromDb(
  actorId: string | null,
  actorUsername: string | null,
  localDb?: Database
) {
  if (actorId && actorUsername) {
    try {
      const roles = await listManagedRoles(actorId, actorUsername, localDb);
      const permissions: Record<string, PermissionKey[]> = {};
      for (const r of roles) permissions[r.name] = r.permissions;
      return {
        roles: roles.map((r) => r.name),
        roleRecords: roles,
        selfRegisterRoles: ["Customer", "Technician", "Sales Executive"],
        adminOnlyCreateRoles: [
          "Director",
          "Admin",
          "Accounts Manager",
          "Sales Manager",
          "Super Admin",
        ],
        permissions,
        permissionLabels: PERMISSION_LABELS,
        permissionKeys: ALL_PERMISSION_KEYS,
        dynamic: true,
      };
    } catch {
      /* fall through to static */
    }
  }
  return {
    roles: APP_ROLES,
    selfRegisterRoles: ["Customer", "Technician", "Sales Executive"],
    adminOnlyCreateRoles: [
      "Director",
      "Admin",
      "Accounts Manager",
      "Sales Manager",
      "Super Admin",
    ],
    permissions: ROLE_PERMISSIONS,
    permissionLabels: PERMISSION_LABELS,
    permissionKeys: ALL_PERMISSION_KEYS,
    dynamic: false,
  };
}

export async function createManagedRole(
  actorId: string,
  actorUsername: string,
  body: { name: string; permissions?: PermissionKey[]; cloneFromId?: string },
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  const name = String(body.name || "").trim();
  if (!name) throw new RoleManagementError("Role name required.");
  if ((APP_ROLES as readonly string[]).includes(name)) {
    throw new RoleManagementError("Use system role editor for built-in roles.");
  }

  const id = `role-${Date.now()}`;
  const slug = slugify(name);
  let permissions: PermissionKey[] = body.permissions || [];

  if (body.cloneFromId) {
    permissions = await loadPermissionsForRole(body.cloneFromId, localDb);
  }

  const row = {
    id,
    name,
    slug,
    is_system: false,
    cloned_from: body.cloneFromId || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseActive()) {
    const { error } = await getSupabase()!.from("roles").insert(row);
    if (error) throw error;
    await saveRolePermissions(id, permissions, localDb);
  } else {
    localRoles.push(row);
    localRolePerms[id] = permissions;
  }
  return mapRoleRow(row, permissions);
}

export async function updateManagedRole(
  actorId: string,
  actorUsername: string,
  roleId: string,
  body: { name?: string; permissions?: PermissionKey[] },
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name) patch.name = String(body.name).trim();

  let row: any;
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("roles")
      .update(patch)
      .eq("id", roleId)
      .select("*")
      .single();
    if (error) throw error;
    row = data;
  } else {
    row = localRoles.find((r) => r.id === roleId);
    if (!row) throw new RoleManagementError("Role not found.", 404);
    Object.assign(row, patch);
  }

  if (body.permissions) {
    await saveRolePermissions(roleId, body.permissions, localDb);
  }
  const permissions = await loadPermissionsForRole(roleId, localDb);
  return mapRoleRow(row, permissions);
}

export async function deleteManagedRole(
  actorId: string,
  actorUsername: string,
  roleId: string,
  localDb?: Database
) {
  await assertSuperAdminActor(actorId, actorUsername, localDb);
  let row: any;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!.from("roles").select("*").eq("id", roleId).single();
    row = data;
    if (row?.is_system) throw new RoleManagementError("Cannot delete system roles.");
    const { error } = await getSupabase()!.from("roles").delete().eq("id", roleId);
    if (error) throw error;
  } else {
    row = localRoles.find((r) => r.id === roleId);
    if (!row) throw new RoleManagementError("Role not found.", 404);
    if (row.is_system) throw new RoleManagementError("Cannot delete system roles.");
    const idx = localRoles.findIndex((r) => r.id === roleId);
    localRoles.splice(idx, 1);
    delete localRolePerms[roleId];
  }
  return { ok: true };
}

export async function cloneManagedRole(
  actorId: string,
  actorUsername: string,
  roleId: string,
  body: { name: string },
  localDb?: Database
) {
  const perms = await loadPermissionsForRole(roleId, localDb);
  return createManagedRole(actorId, actorUsername, {
    name: body.name,
    permissions: perms,
    cloneFromId: roleId,
  }, localDb);
}

async function saveRolePermissions(roleId: string, permissions: PermissionKey[], _localDb?: Database) {
  const enabledSet = new Set(permissions);
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    for (const key of ALL_PERMISSION_KEYS) {
      await supabase.from("role_permissions").upsert(
        { role_id: roleId, permission_key: key, enabled: enabledSet.has(key) },
        { onConflict: "role_id,permission_key" }
      );
    }
    return;
  }
  localRolePerms[roleId] = [...enabledSet];
}

export async function resolvePermissionsForRoleName(
  roleName: string,
  localDb?: Database
): Promise<PermissionKey[]> {
  if (!isSupabaseActive()) {
    const row = localRoles.find((r) => r.name === roleName);
    if (row) return loadPermissionsForRole(row.id, localDb);
    return [...(ROLE_PERMISSIONS[roleName as keyof typeof ROLE_PERMISSIONS] || [])];
  }
  try {
    const { data } = await getSupabase()!
      .from("roles")
      .select("id")
      .eq("name", roleName)
      .maybeSingle();
    if (data?.id) return loadPermissionsForRole(data.id, localDb);
  } catch {
    /* table may not exist yet */
  }
  return [...(ROLE_PERMISSIONS[roleName as keyof typeof ROLE_PERMISSIONS] || [])];
}
