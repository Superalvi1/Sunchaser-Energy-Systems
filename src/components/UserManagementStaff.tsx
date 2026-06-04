import React, { useEffect, useState } from "react";
import {
  Users,
  Loader2,
  CheckCircle,
  XCircle,
  Shield,
  UserPlus,
  Table,
  Settings2,
  UserCircle,
} from "lucide-react";
import RoleManagementPanel from "./RoleManagementPanel";
import CustomerProfileStaff from "./CustomerProfileStaff";
import type { User } from "../types";
import {
  fetchAdminUsers,
  fetchPendingUsers,
  approveAdminUser,
  rejectAdminUser,
  createAdminUser,
  updateAdminUser,
  fetchRolesMatrix,
} from "../services/api";
import { isSuperAdmin, canManageCustomers, APP_ROLES, ADMIN_ONLY_CREATE_ROLES } from "../lib/roles";
import type { PermissionKey } from "../lib/roles";

interface UserManagementStaffProps {
  staffUser: User;
}

type Tab = "pending" | "users" | "roles" | "customers" | "matrix";

export default function UserManagementStaff({ staffUser }: UserManagementStaffProps) {
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
      setUsers(all.users);
      setPending(pend.users);
      setMatrix(mx);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

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
      setMsg("User approved.");
      await load();
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectAdminUser(staffUser.id, staffUser.username, id, rejectReason);
      setRejectId(null);
      setRejectReason("");
      setMsg("User rejected.");
      await load();
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  const handleCreate = async () => {
    try {
      await createAdminUser(staffUser.id, staffUser.username, createForm);
      setCreateOpen(false);
      setMsg("User created.");
      await load();
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  const handleSuspend = async (u: User) => {
    try {
      await updateAdminUser(staffUser.id, staffUser.username, u.id, {
        accountStatus: u.accountStatus === "Suspended" ? "Approved" : "Suspended",
      });
      await load();
    } catch (err: any) {
      setMsg(err.message);
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
        {(["pending", "users", "roles", ...(showCustomers ? (["customers"] as Tab[]) : []), "matrix"] as Tab[]).map((t) => (
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
                ? "All users"
                : t === "roles"
                  ? "Roles"
                  : t === "customers"
                    ? "Customer profiles"
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
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-900">
                  <td className="py-2 pr-4">
                    <span className="text-white font-sans font-semibold">{u.name}</span>
                    <br />
                    <span className="text-slate-500">@{u.username}</span>
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
                    {u.username !== staffUser.username && (
                      <button
                        type="button"
                        onClick={() => handleSuspend(u)}
                        className="text-amber-400 hover:underline"
                      >
                        {u.accountStatus === "Suspended" ? "Reinstate" : "Suspend"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
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

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
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
                onClick={handleCreate}
                className="bg-amber-500 text-slate-950 text-xs font-bold px-4 py-2 rounded-lg"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
