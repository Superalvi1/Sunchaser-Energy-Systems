import React, { useEffect, useState } from "react";
import { Loader2, Plus, Copy, Trash2, Save } from "lucide-react";
import type { User } from "../types";
import {
  fetchAdminRoles,
  createAdminRole,
  updateAdminRole,
  cloneAdminRole,
  deleteAdminRole,
} from "../services/api";
import { ALL_PERMISSION_KEYS, PERMISSION_LABELS, type PermissionKey } from "../lib/roles";

interface RoleManagementPanelProps {
  staffUser: User;
}

export default function RoleManagementPanel({ staffUser }: RoleManagementPanelProps) {
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPerms, setEditPerms] = useState<Set<PermissionKey>>(new Set());
  const [newRoleName, setNewRoleName] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchAdminRoles(staffUser);
      setRoles(data.roles || []);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [staffUser.id]);

  const selectRole = (r: any) => {
    setSelectedId(r.id);
    setEditName(r.name);
    setEditPerms(new Set(r.permissions || []));
  };

  const togglePerm = (key: PermissionKey) => {
    setEditPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const saveRole = async () => {
    if (!selectedId) return;
    try {
      await updateAdminRole(staffUser, selectedId, {
        name: editName,
        permissions: [...editPerms],
      });
      setMsg("Role saved.");
      await load();
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  const addRole = async () => {
    if (!newRoleName.trim()) return;
    try {
      await createAdminRole(staffUser, { name: newRoleName.trim(), permissions: [] });
      setNewRoleName("");
      setMsg("Role created.");
      await load();
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  const cloneRole = async (id: string, name: string) => {
    const cloneName = prompt("New role name", `${name} Copy`);
    if (!cloneName) return;
    try {
      await cloneAdminRole(staffUser, id, cloneName);
      setMsg("Role cloned.");
      await load();
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  const removeRole = async (id: string, isSystem: boolean) => {
    if (isSystem) {
      setMsg("System roles cannot be deleted.");
      return;
    }
    if (!confirm("Delete this custom role?")) return;
    try {
      await deleteAdminRole(staffUser, id);
      setSelectedId(null);
      setMsg("Role deleted.");
      await load();
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  if (loading) return <Loader2 className="h-8 w-8 animate-spin text-amber-500" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-3">
        <div className="flex gap-2">
          <input
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="New custom role name"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addRole}
            className="bg-amber-500 text-slate-950 p-2 rounded-xl"
            title="Create role"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <ul className="space-y-1 max-h-96 overflow-y-auto">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => selectRole(r)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm border ${
                  selectedId === r.id
                    ? "border-amber-500 bg-amber-500/10 text-white"
                    : "border-slate-800 bg-slate-950 text-slate-300"
                }`}
              >
                {r.name}
                {r.isSystem && (
                  <span className="ml-2 text-[10px] text-slate-500 font-mono">system</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-4">
        {msg && <p className="text-xs text-amber-400 font-mono">{msg}</p>}
        {!selectedId ? (
          <p className="text-sm text-slate-500">Select a role to edit permissions module-by-module.</p>
        ) : (
          <>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              disabled={roles.find((r) => r.id === selectedId)?.isSystem}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm font-bold"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_PERMISSION_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-xs bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={editPerms.has(key)}
                    onChange={() => togglePerm(key)}
                  />
                  {PERMISSION_LABELS[key]}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveRole}
                className="flex items-center gap-1 bg-amber-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl"
              >
                <Save className="h-3.5 w-3.5" /> Save permissions
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = roles.find((x) => x.id === selectedId);
                  if (r) cloneRole(r.id, r.name);
                }}
                className="flex items-center gap-1 bg-slate-800 text-xs px-3 py-2 rounded-xl"
              >
                <Copy className="h-3.5 w-3.5" /> Clone
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = roles.find((x) => x.id === selectedId);
                  if (r) removeRole(r.id, r.isSystem);
                }}
                className="flex items-center gap-1 bg-rose-900/40 text-rose-400 text-xs px-3 py-2 rounded-xl"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
