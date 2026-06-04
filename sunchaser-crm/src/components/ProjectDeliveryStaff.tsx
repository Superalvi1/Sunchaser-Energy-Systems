import React, { useEffect, useState } from "react";
import { Loader2, Package, Plus } from "lucide-react";
import { User } from "../types";
import {
  fetchAdminProjectDeliveries,
  createAdminProjectDelivery,
  addAdminProjectDeliveryItems,
  fetchStaffProjectPayments,
} from "../services/api";
import WhatsAppActionButton from "./WhatsAppActionButton";
import { PLANNED_ITEM_CATEGORIES, SYSTEM_TYPES, PROJECT_TYPES } from "../lib/projectDelivery";

interface ProjectDeliveryStaffProps {
  staffUser: User;
}

export default function ProjectDeliveryStaff({ staffUser }: ProjectDeliveryStaffProps) {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("cust-101");
  const [projectTitle, setProjectTitle] = useState("Sunchaser Solar Delivery");
  const [systemType, setSystemType] = useState<string>(SYSTEM_TYPES[0]);
  const [projectType, setProjectType] = useState<string>(PROJECT_TYPES[0]);
  const [systemSizeKw, setSystemSizeKw] = useState("10");
  const [technicianUserId, setTechnicianUserId] = useState("");
  const [address, setAddress] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [paymentByDelivery, setPaymentByDelivery] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    try {
      const rows = await fetchAdminProjectDeliveries(staffUser.id, staffUser.username);
      const arr = Array.isArray(rows) ? rows : [];
      setList(arr);
      const payMap: Record<string, any> = {};
      for (const d of arr.slice(0, 10)) {
        try {
          const pay = await fetchStaffProjectPayments(staffUser.id, staffUser.username, d.id);
          if (pay.finance) payMap[d.id] = pay.finance;
        } catch {
          /* ignore */
        }
      }
      setPaymentByDelivery(payMap);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [staffUser.id]);

  const handleCreate = async () => {
    setMsg(null);
    try {
      const created = await createAdminProjectDelivery(staffUser.id, staffUser.username, {
        customerId,
        projectTitle,
        systemType,
        projectType,
        systemSizeKw: Number(systemSizeKw),
        assignedTechnicianUserId: technicianUserId || undefined,
        installationAddress: address,
        expectedInstallationDate: expectedDate || undefined,
        deliveryStatus: "Order Confirmed",
      });
      await addAdminProjectDeliveryItems(staffUser.id, staffUser.username, created.id, [
        {
          itemCategory: "Panels",
          brand: "Longi",
          model: "Hi-MO6",
          quantity: 18,
          wattage: "580W",
        },
        {
          itemCategory: "Inverter",
          brand: "GoodWe",
          model: "GW10K-ET",
          quantity: 1,
          capacity: "10kW",
        },
      ]);
      setMsg(`Created delivery ${created.id}`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Package className="h-6 w-6 text-amber-500" />
        <h2 className="text-xl font-extrabold">Project Delivery</h2>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 grid gap-3 text-sm">
        <p className="text-xs text-slate-400 font-mono uppercase">Create delivery project</p>
        <input
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
          placeholder="Customer ID (e.g. cust-101)"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        />
        <input
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
          placeholder="Project title"
          value={projectTitle}
          onChange={(e) => setProjectTitle(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
            value={systemType}
            onChange={(e) => setSystemType(e.target.value)}
          >
            {SYSTEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
            value={projectType}
            onChange={(e) => setProjectType(e.target.value)}
          >
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <input
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
          placeholder="System size kW"
          value={systemSizeKw}
          onChange={(e) => setSystemSizeKw(e.target.value)}
        />
        <input
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
          placeholder="Assigned technician user ID (e.g. u-10)"
          value={technicianUserId}
          onChange={(e) => setTechnicianUserId(e.target.value)}
        />
        <input
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
          placeholder="Installation address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <input
          type="date"
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
          value={expectedDate}
          onChange={(e) => setExpectedDate(e.target.value)}
        />
        <button
          type="button"
          onClick={handleCreate}
          className="py-3 rounded-xl bg-amber-500 text-slate-950 font-extrabold flex items-center justify-center gap-2"
        >
          <Plus className="h-4 w-4" /> Create with planned materials
        </button>
        {msg && <p className="text-xs text-amber-400">{msg}</p>}
      </div>

      {loading ? (
        <Loader2 className="h-8 w-8 animate-spin text-amber-500 mx-auto" />
      ) : (
        <ul className="space-y-2 text-sm">
          {list.slice(0, 20).map((d) => {
            const fin = paymentByDelivery[d.id];
            return (
              <li key={d.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                <p className="font-bold">{d.projectTitle}</p>
                <p className="text-slate-400 text-xs">
                  {d.customerId} · {d.deliveryStatus} · {d.systemSizeKw ?? "—"} kW
                </p>
                {fin && (
                  <p className="text-xs text-emerald-400/90 font-mono">
                    Sale PKR {(fin.saleValue || 0).toLocaleString()} · Paid PKR{" "}
                    {(fin.advanceReceived || 0).toLocaleString()} · Balance PKR{" "}
                    {(fin.balanceRemaining || 0).toLocaleString()} · {fin.paymentStatus}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <WhatsAppActionButton
                    staffUser={staffUser}
                    phone="923001234567"
                    messageType="installation_scheduled"
                    vars={{ projectTitle: d.projectTitle, date: d.expectedInstallationDate }}
                    customerId={d.customerId}
                    projectDeliveryId={d.id}
                  />
                  <WhatsAppActionButton
                    staffUser={staffUser}
                    phone="923001234567"
                    messageType="payment_balance_reminder"
                    vars={{ balance: fin?.balanceRemaining ?? 0 }}
                    customerId={d.customerId}
                    projectDeliveryId={d.id}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
