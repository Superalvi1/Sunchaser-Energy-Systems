import React, { useEffect, useState } from "react";
import {
  Users,
  Loader2,
  CheckCircle,
  XCircle,
  Shield,
  UserPlus,
  Table,
  Trash2,
} from "lucide-react";
import RoleManagementPanel from "./RoleManagementPanel";
import CustomerProfileStaff from "./CustomerProfileStaff";
import AppModal from "./ui/AppModal";
import type { User } from "../types";
import {
  fetchAdminUsers,
  fetchPendingUsers,
  approveAdminUser,
  rejectAdminUser,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  fetchDemoSeedUsers,
  deleteDemoSeedUsers,
  fetchRolesMatrix,
} from "../services/api";
import { isSuperAdmin, canManageCustomers, APP_ROLES, ADMIN_ONLY_CREATE_ROLES } from "../lib/roles";
import { canDeleteUser, isHighValueProtectedUser, isPermanentlyProtectedUser } from "../lib/userDeleteGuards";
import { DEMO_SEED_USER_MATCHERS } from "../lib/demoUserCleanup";
import type { PermissionKey } from "../lib/roles";
import { useToast } from "../lib/toast";

interface UserManagementStaffProps {
  staffUser: User;
}

type Tab = "pending" | "users" | "roles" | "customers" | "matrix" | "cleanup";

function mergeUserLists(local: User[], server: User[]): User[] {
  const serverIds = new Set(server.map((u) => u.id));
  const extras = local.filter((u) => !serverIds.has(u.id));
  return [...extras, ...server].sort((a, b) =>
    String((b as User & { createdAt?: string }).createdAt || b.name || "").localeCompare(
      String((a as User & { createdAt?: string }).createdAt || a.name || "")
    )
  );
}

export default function UserManagementStaff({ staffUser }: UserManagementStaffProps) {
  const toast = useToast();
  const allowed = isSuperAdmin(staffUser.username, staffUser.role);
  const showCustomers = canManageCustomers(staffUser.username, staffUser.role);
  const [tab, setTab] = useState<Tab>("pending");
  const [users, setUsers] = useState<User[]>([]);
  const [pending, setPending] = useState<User[]>([]);
  const [matrix, setMatrix] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [demoUsers, setDemoUsers] = useState<User[]>([]);
  const [demoLoading, setDemoLoading] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupConfirm, setCleanupConfirm] = useState("");
  const [cleanupSaving, setCleanupSaving] = useState(false);
  const [selectedDemoIds, setSelectedDemoIds] = useState<string[]>([]);
  const [createForm, setCreateForm] = useState({
    username: "",
    name: "",
    email: "",
    password: "ChangeMe123!",
    role: "Admin" as string,
    accountStatus: "Approved",
  });

  const load = async () => {
    if (!allowed) return;
    setLoading(true);
    setMsg(null);
    try {
      const [all, pend, mx] = await Promise.all([
        fetchAdminUsers(staffUser.id, staffUser.username),
        fetchPendingUsers(staffUser.id, staffUser.username),
        fetchRolesMatrix(staffUser.id, staffUser.username),
      ]);
      setUsers(all.users || []);
      setPending(pend.users || []);
      setMatrix(mx);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDemoUsers = async () => {
    setDemoLoading(true);
    try {
      const res = await fetchDemoSeedUsers(staffUser.id, staffUser.username);
      setDemoUsers(res.users || []);
      setSelectedDemoIds((res.users || []).map((u) => u.id));
    } catch (err: any) {
      toast.error(err.message || "Failed to load demo users.");
    } finally {
      setDemoLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "cleanup") loadDemoUsers();
  }, [tab, staffUser.id]);

  useEffect(() => {
    load();
  }, [staffUser.id]);

  if (!allowed) {
    return (
      <p className="text-sm text-rose-400 font-mono">
        Super Admin only — user management and approvals.
      </p>
    );
  }

  const handleApprove = async (id: string) => {
    try {
      await approveAdminUser(staffUser.id, staffUser.username, id);
      toast.success("User approved.");
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectAdminUser(staffUser.id, staffUser.username, id, rejectReason);
      setRejectId(null);
      setRejectReason("");
      toast.success("User rejected.");
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCreate = async () => {
    if (!createForm.username.trim() || !createForm.name.trim() || !createForm.email.trim()) {
      toast.error("Username, name, and email are required.");
      return;
    }
    setCreateSaving(true);
    try {
      const res = await createAdminUser(staffUser.id, staffUser.username, createForm);
      const created = res.user;
      setCreateOpen(false);
      setCreateForm({
        username: "",
        name: "",
        email: "",
        password: "ChangeMe123!",
        role: "Admin",
        accountStatus: "Approved",
      });
      if (created) {
        setUsers((prev) => [created, ...prev.filter((u) => u.id !== created.id)]);
      }
      setTab("users");
      toast.success("User created.");
      try {
        const all = await fetchAdminUsers(staffUser.id, staffUser.username);
        setUsers((prev) => mergeUserLists(prev, all.users || []));
        const pend = await fetchPendingUsers(staffUser.id, staffUser.username);
        setPending(pend.users || []);
      } catch {
        /* keep optimistic list visible */
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to create user.");
    } finally {
      setCreateSaving(false);
    }
  };

  const handleSuspend = async (u: User) => {
    try {
      await updateAdminUser(staffUser.id, staffUser.username, u.id, {
        accountStatus: u.accountStatus === "Suspended" ? "Approved" : "Suspended",
      });
      toast.success(u.accountStatus === "Suspended" ? "User reinstated." : "User suspended.");
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      const res = await deleteAdminUser(
        staffUser.id,
        staffUser.username,
        deleteTarget.id,
        deleteConfirm
      );
      toast.success(res.message || "User deleted.");
      setDeleteTarget(null);
      setDeleteConfirm("");
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      await load();
    } catch (err: any) {
      toast.error(err.message || "Delete failed.");
    } finally {
      setDeleteSaving(false);
    }
  };

  const handleCleanup = async () => {
    setCleanupSaving(true);
    try {
      const res = await deleteDemoSeedUsers(staffUser.id, staffUser.username, {
        confirmText: cleanupConfirm,
        userIds: selectedDemoIds,
      });
      toast.success(res.message || "Demo users removed.");
      setCleanupOpen(false);
      setCleanupConfirm("");
      setUsers((prev) => prev.filter((u) => !res.deleted.includes(u.id)));
      await loadDemoUsers();
      await load();
    } catch (err: any) {
      toast.error(err.message || "Cleanup failed.");
    } finally {
      setCleanupSaving(false);
    }
  };

  const allPermKeys: PermissionKey[] = matrix?.permissionLabels
    ? (Object.keys(matrix.permissionLabels) as PermissionKey[])
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-amber-500" />
          <h2 className="text-xl font-bold text-white">User management</h2>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 bg-amber-500 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl"
        >
          <UserPlus className="h-4 w-4" />
          Create user
        </button>
      </div>

      {msg && <p className="text-xs text-amber-400 font-mono">{msg}</p>}

      <div className="flex flex-wrap gap-2 text-xs font-bold">
        {(["pending", "users", "roles", ...(showCustomers ? (["customers"] as Tab[]) : []), "matrix", "cleanup"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl border ${
              tab === t
                ? "bg-amber-500 text-slate-950 border-amber-500"
                : "bg-slate-950 border-slate-800 text-slate-400"
            }`}
          >
            {t === "pending"
              ? `Approval queue (${pending.length})`
              : t === "users"
                ? `All users (${users.length})`
                : t === "roles"
                  ? "Roles"
                  : t === "customers"
                    ? "Customer profiles"
                    : t === "cleanup"
                      ? "Cleanup"
                      : "Permissions matrix"}
          </button>
        ))}
      </div>

      {loading ? (
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      ) : tab === "pending" ? (
        <ul className="space-y-3">
          {pending.length === 0 ? (
            <p className="text-sm text-slate-500">No pending registrations.</p>
          ) : (
            pending.map((u) => (
              <li
                key={u.id}
                className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-wrap justify-between gap-3"
              >
                <div>
                  <p className="font-bold text-white">{u.name}</p>
                  <p className="text-xs text-slate-400 font-mono">
                    @{u.username} · {u.role} · {u.email}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Email verified: {u.emailVerified ? "yes" : "no"}
                  </p>
                </div>
                <div className="flex gap-2 items-start">
                  <button
                    type="button"
                    onClick={() => handleApprove(u.id)}
                    className="flex items-center gap-1 bg-emerald-600/20 text-emerald-400 border border-emerald-800 px-3 py-1.5 rounded-lg text-xs font-bold"
                  >
                    <CheckCircle className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectId(u.id)}
                    className="flex items-center gap-1 bg-rose-600/20 text-rose-400 border border-rose-800 px-3 py-1.5 rounded-lg text-xs font-bold"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
                {rejectId === u.id && (
                  <div className="w-full flex flex-col gap-2 mt-2">
                    <input
                      placeholder="Rejection reason"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs w-full"
                    />
                    <button
                      type="button"
                      onClick={() => handleReject(u.id)}
                      className="text-xs text-rose-400 font-bold self-start"
                    >
                      Confirm reject
                    </button>
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
      ) : tab === "roles" ? (
        <RoleManagementPanel staffUser={staffUser} />
      ) : tab === "customers" && showCustomers ? (
        <CustomerProfileStaff staffUser={staffUser} />
      ) : tab === "cleanup" ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Remove seeded demo staff accounts from production. Invoices, quotations, payment history,
            and audit logs are preserved — only login accounts are deleted.
          </p>
          <div className="grid sm:grid-cols-2 gap-2 text-[10px] text-slate-500 font-mono">
            {DEMO_SEED_USER_MATCHERS.map((d) => (
              <span key={d.label} className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                {d.label}
              </span>
            ))}
          </div>
          {demoLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
          ) : demoUsers.length === 0 ? (
            <p className="text-sm text-emerald-400 font-mono">No demo seed users found in database.</p>
          ) : (
            <ul className="space-y-2">
              {demoUsers.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3"
                >
                  <input
                    type="checkbox"
                    checked={selectedDemoIds.includes(u.id)}
                    onChange={(e) => {
                      setSelectedDemoIds((prev) =>
                        e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                      );
                    }}
                  />
                  <div>
                    <p className="text-sm font-bold text-white">{u.name}</p>
                    <p className="text-xs text-slate-500 font-mono">
                      @{u.username} · {u.role} · {u.id}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={!demoUsers.length}
            onClick={() => {
              setCleanupConfirm("");
              setCleanupOpen(true);
            }}
            className="inline-flex items-center gap-2 bg-rose-700/80 hover:bg-rose-600 text-white text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" /> Delete selected demo users
          </button>
        </div>
      ) : tab === "users" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-2 pr-4">User</th>
                <th className="text-left py-2 pr-4">Role</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-left py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const deleteGate = canDeleteUser(u, staffUser.id);
                  const protectedUser = isPermanentlyProtectedUser(u);
                  return (
                    <tr key={u.id} className="border-b border-slate-900">
                      <td className="py-2 pr-4">
                        <span className="text-white font-sans font-semibold">{u.name}</span>
                        <br />
                        <span className="text-slate-500">@{u.username}</span>
                        {u.customerId && (
                          <span className="block text-[10px] text-slate-600">customer: {u.customerId}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-slate-300">{u.role}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={
                            u.accountStatus === "Approved"
                              ? "text-emerald-400"
                              : u.accountStatus === "Pending"
                                ? "text-amber-400"
                                : "text-rose-400"
                          }
                        >
                          {u.accountStatus || "Approved"}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-3 items-center">
                          {u.id !== staffUser.id && !protectedUser && (
                            <button
                              type="button"
                              onClick={() => handleSuspend(u)}
                              className="text-amber-400 hover:underline"
                            >
                              {u.accountStatus === "Suspended" ? "Reinstate" : "Suspend"}
                            </button>
                          )}
                          {deleteGate.allowed ? (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteConfirm("");
                                setDeleteTarget(u);
                              }}
                              className="text-rose-400 hover:underline inline-flex items-center gap-1"
                            >
                              <Trash2 className="h-3 w-3" /> Delete
                            </button>
                          ) : protectedUser ? (
                            <span className="text-slate-600 text-[10px]">Protected</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="bg-slate-950 text-slate-400">
                <th className="text-left p-3 sticky left-0 bg-slate-950">
                  <Table className="inline h-3 w-3 mr-1" />
                  Role
                </th>
                {allPermKeys.map((p) => (
                  <th key={p} className="p-2 text-center whitespace-nowrap">
                    {matrix?.permissionLabels?.[p] || p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(matrix?.roles || APP_ROLES).map((role: string) => (
                <tr key={role} className="border-t border-slate-900">
                  <td className="p-3 font-bold text-white sticky left-0 bg-slate-900">{role}</td>
                  {allPermKeys.map((p) => {
                    const has = (matrix?.permissions?.[role] || []).includes(p);
                    return (
                      <td key={p} className="p-2 text-center">
                        {has ? (
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-500 inline" />
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-3 text-[10px] text-slate-500">
            Admin-only roles: {ADMIN_ONLY_CREATE_ROLES.join(", ")}
          </p>
        </div>
      )}

      <AppModal open={createOpen} onClose={() => setCreateOpen(false)} panelClassName="max-w-md">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-3">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-amber-500" />
            Create staff user
          </h3>
          <select
            value={createForm.role}
            onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
          >
            {APP_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            placeholder="Name"
            value={createForm.name}
            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
          />
          <input
            placeholder="Email"
            type="email"
            value={createForm.email}
            onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
          />
          <input
            placeholder="Username"
            value={createForm.username}
            onChange={(e) =>
              setCreateForm({ ...createForm, username: e.target.value.toLowerCase() })
            }
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={createForm.password}
            onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="text-xs text-slate-400 px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={createSaving}
              onClick={handleCreate}
              className="bg-amber-500 text-slate-950 text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {createSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </AppModal>

      {deleteTarget && (
        <AppModal
          open
          onClose={() => {
            setDeleteTarget(null);
            setDeleteConfirm("");
          }}
          panelClassName="max-w-md"
        >
          <div className="bg-slate-900 border border-rose-900/50 rounded-2xl p-6 w-full space-y-3">
            <h3 className="font-bold text-rose-300 flex items-center gap-2">
              <Trash2 className="h-5 w-5" /> Permanently delete user
            </h3>
            <p className="text-sm text-slate-300">
              Delete <strong className="text-white">{deleteTarget.name}</strong> (@{deleteTarget.username})?
              This cannot be undone.
            </p>
            {deleteTarget.customerId && (
              <p className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                This portal user is linked to customer record {deleteTarget.customerId}. The customer
                record, invoices, and documents will remain; only the login account will be removed
                and the link cleared.
              </p>
            )}
            {isHighValueProtectedUser(deleteTarget) && (
              <p className="text-xs text-rose-300/90">
                Warning: this is a senior staff account. Confirm carefully.
              </p>
            )}
            <p className="text-xs text-slate-500">Type DELETE to permanently remove this user.</p>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="Type DELETE"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirm("");
                }}
                className="text-xs text-slate-400 px-4 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteSaving || deleteConfirm.trim().toUpperCase() !== "DELETE"}
                onClick={handleDelete}
                className="bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-40"
              >
                {deleteSaving ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </AppModal>
      )}

      {cleanupOpen && (
        <AppModal
          open
          onClose={() => {
            setCleanupOpen(false);
            setCleanupConfirm("");
          }}
          panelClassName="max-w-md"
        >
          <div className="bg-slate-900 border border-rose-900/50 rounded-2xl p-6 w-full space-y-3">
            <h3 className="font-bold text-rose-300 flex items-center gap-2">
              <Trash2 className="h-5 w-5" /> Delete demo users
            </h3>
            <p className="text-sm text-slate-300">
              Permanently remove {selectedDemoIds.length} demo account(s)? Historical invoices and
              audit logs will keep creator names.
            </p>
            <p className="text-xs text-slate-500">Type DELETE to permanently remove this user.</p>
            <input
              value={cleanupConfirm}
              onChange={(e) => setCleanupConfirm(e.target.value)}
              placeholder="Type DELETE"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setCleanupOpen(false);
                  setCleanupConfirm("");
                }}
                className="text-xs text-slate-400 px-4 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={cleanupSaving || cleanupConfirm.trim().toUpperCase() !== "DELETE"}
                onClick={handleCleanup}
                className="bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-40"
              >
                {cleanupSaving ? "Deleting…" : "Delete demo users"}
              </button>
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}
