import React, { useEffect, useState } from "react";
import { Link2, Loader2, Search, AlertTriangle } from "lucide-react";
import type { User } from "../types";
import { useToast } from "../lib/toast";
import {
  fetchCustomerLinkDuplicates,
  fetchCustomerLinkSearchCustomers,
  fetchCustomerLinkSearchUsers,
  linkCustomerPortalAccounts,
} from "../services/api";

interface CustomerLinkingStaffProps {
  staffUser: User;
}

export default function CustomerLinkingStaff({ staffUser }: CustomerLinkingStaffProps) {
  const toast = useToast();
  const [custQuery, setCustQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);

  const loadDuplicates = async () => {
    try {
      const res = await fetchCustomerLinkDuplicates(staffUser);
      setDuplicates(res.duplicates || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load duplicate report.");
    }
  };

  useEffect(() => {
    void loadDuplicates();
  }, [staffUser.id]);

  const searchCustomers = async () => {
    setLoading(true);
    try {
      const res = await fetchCustomerLinkSearchCustomers(staffUser, custQuery);
      setCustomers(res.customers || []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetchCustomerLinkSearchUsers(staffUser, userQuery);
      setUsers(res.users || []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runLink = async (confirmOverride = false) => {
    if (!selectedCustomer?.id || !selectedUser?.userId) {
      toast.error("Select both a customer and a portal user.");
      return;
    }
    setLinking(true);
    try {
      const res = await linkCustomerPortalAccounts(staffUser, {
        customerId: selectedCustomer.id,
        userId: selectedUser.userId,
        confirmOverride,
      });
      if (res.needsConfirmation) {
        setPendingWarnings(res.warnings || []);
        return;
      }
      toast.success(res.message || "Accounts linked.");
      setPendingWarnings(null);
      await Promise.all([searchCustomers(), searchUsers(), loadDuplicates()]);
    } catch (err: any) {
      toast.error(err.message || "Link failed.");
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="space-y-6 text-xs font-sans">
      <div className="border-b border-neutral-800 pb-3">
        <h3 className="text-sm font-black font-mono uppercase tracking-wider text-amber-400 flex items-center gap-2">
          <Link2 className="h-4 w-4" /> Customer Linking Center
        </h3>
        <p className="text-neutral-450 mt-1">
          Search CRM customers and portal users, then link accounts without SQL access. Duplicate detection is read-only.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
          <h4 className="font-bold text-neutral-200 font-mono uppercase text-[10px]">CRM Customer</h4>
          <div className="flex gap-2">
            <input
              value={custQuery}
              onChange={(e) => setCustQuery(e.target.value)}
              placeholder="Name, phone, email, or SES code…"
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-200 font-mono"
            />
            <button
              type="button"
              onClick={() => void searchCustomers()}
              className="bg-amber-500 text-neutral-950 font-bold px-3 rounded-xl flex items-center gap-1"
            >
              <Search className="h-3.5 w-3.5" /> Search
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {customers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCustomer(c)}
                className={`w-full text-left p-2 rounded-xl border ${
                  selectedCustomer?.id === c.id
                    ? "border-amber-500 bg-amber-500/10"
                    : "border-neutral-800 bg-neutral-950"
                }`}
              >
                <p className="font-bold text-neutral-100">{c.name}</p>
                <p className="text-[10px] text-neutral-500 font-mono">
                  {c.customerCode || "no code"} · {c.phone || "no phone"} · user: {c.userId || "none"}
                </p>
              </button>
            ))}
          </div>
        </section>

        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
          <h4 className="font-bold text-neutral-200 font-mono uppercase text-[10px]">Portal User</h4>
          <div className="flex gap-2">
            <input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Username, name, or email…"
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-200 font-mono"
            />
            <button
              type="button"
              onClick={() => void searchUsers()}
              className="bg-amber-500 text-neutral-950 font-bold px-3 rounded-xl flex items-center gap-1"
            >
              <Search className="h-3.5 w-3.5" /> Search
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {users.map((u) => (
              <button
                key={u.userId}
                type="button"
                onClick={() => setSelectedUser(u)}
                className={`w-full text-left p-2 rounded-xl border ${
                  selectedUser?.userId === u.userId
                    ? "border-amber-500 bg-amber-500/10"
                    : "border-neutral-800 bg-neutral-950"
                }`}
              >
                <p className="font-bold text-neutral-100">{u.name} (@{u.username})</p>
                <p className="text-[10px] text-neutral-500 font-mono">
                  {u.email} · customer_id: {u.customerId || "none"}
                </p>
              </button>
            ))}
          </div>
        </section>
      </div>

      {(selectedCustomer || selectedUser) && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-[11px]">
          <div>
            <p className="text-neutral-500 uppercase text-[10px] mb-1">Selected customer</p>
            {selectedCustomer ? (
              <>
                <p className="text-neutral-100 font-bold">{selectedCustomer.name}</p>
                <p className="text-neutral-400">ID: {selectedCustomer.id}</p>
                <p className="text-neutral-400">Code: {selectedCustomer.customerCode || "—"}</p>
                <p className="text-neutral-400">customers.user_id: {selectedCustomer.userId || "null"}</p>
              </>
            ) : (
              <p className="text-neutral-500">None selected</p>
            )}
          </div>
          <div>
            <p className="text-neutral-500 uppercase text-[10px] mb-1">Selected portal user</p>
            {selectedUser ? (
              <>
                <p className="text-neutral-100 font-bold">{selectedUser.name}</p>
                <p className="text-neutral-400">ID: {selectedUser.userId}</p>
                <p className="text-neutral-400">users.customer_id: {selectedUser.customerId || "null"}</p>
              </>
            ) : (
              <p className="text-neutral-500">None selected</p>
            )}
          </div>
        </div>
      )}

      {pendingWarnings && pendingWarnings.length > 0 && (
        <div className="bg-rose-950/30 border border-rose-800/50 rounded-2xl p-4 space-y-2">
          <p className="text-rose-300 font-bold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Confirm relink
          </p>
          <ul className="list-disc pl-5 text-rose-200/90 space-y-1">
            {pendingWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => void runLink(true)}
              disabled={linking}
              className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-4 py-2 rounded-xl"
            >
              Link These Accounts Anyway
            </button>
            <button
              type="button"
              onClick={() => setPendingWarnings(null)}
              className="bg-neutral-800 text-neutral-200 px-4 py-2 rounded-xl"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={linking || !selectedCustomer || !selectedUser}
        onClick={() => void runLink(false)}
        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold px-5 py-2.5 rounded-xl flex items-center gap-2"
      >
        {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        Link These Accounts
      </button>

      <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
        <h4 className="font-bold text-neutral-200 font-mono uppercase text-[10px]">
          Duplicate detection (read-only)
        </h4>
        {duplicates.length === 0 ? (
          <p className="text-neutral-500">No duplicate customer pairs detected.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] font-mono">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-450">
                  <th className="py-2 pr-2">Customer A</th>
                  <th className="py-2 pr-2">Customer B</th>
                  <th className="py-2 pr-2">Reason</th>
                  <th className="py-2">Portal links</th>
                </tr>
              </thead>
              <tbody>
                {duplicates.map((d, i) => (
                  <tr key={i} className="border-b border-neutral-850 text-neutral-300">
                    <td className="py-2 pr-2">
                      {d.customerA.name}
                      <span className="block text-[10px] text-neutral-500">{d.customerA.id}</span>
                    </td>
                    <td className="py-2 pr-2">
                      {d.customerB.name}
                      <span className="block text-[10px] text-neutral-500">{d.customerB.id}</span>
                    </td>
                    <td className="py-2 pr-2">
                      {d.reason}
                      <span className="block text-[10px] text-neutral-500">{d.matchValue}</span>
                    </td>
                    <td className="py-2 text-[10px]">
                      A: {d.customerA.linkedUsername || "none"}
                      <br />
                      B: {d.customerB.linkedUsername || "none"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(loading || linking) && (
        <p className="text-neutral-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Working…
        </p>
      )}
    </div>
  );
}
