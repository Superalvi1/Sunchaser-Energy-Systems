import React, { useEffect, useState } from "react";
import { Activity, Loader2, Wifi, WifiOff, AlertTriangle, Plus } from "lucide-react";
import { User } from "../types";
import { fetchAdminEnergyMonitoring, upsertAdminEnergyDevice } from "../services/api";
import { ENERGY_BRANDS } from "../lib/clientPortalEnergy";

interface EnergyMonitoringStaffProps {
  staffUser: User;
}

export default function EnergyMonitoringStaff({ staffUser }: EnergyMonitoringStaffProps) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<{
    onlineCount: number;
    offlineCount: number;
    openAlerts: number;
    customers: any[];
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [brand, setBrand] = useState<string>(ENERGY_BRANDS[0]);
  const [deviceSerial, setDeviceSerial] = useState("");
  const [plantId, setPlantId] = useState("");
  const [unitRate, setUnitRate] = useState("55");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchAdminEnergyMonitoring(staffUser.id, staffUser.username);
      setSummary(data);
    } catch {
      setSummary({ onlineCount: 0, offlineCount: 0, openAlerts: 0, customers: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [staffUser.id, staffUser.username]);

  const registerDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim() || !deviceSerial.trim()) {
      setMsg("Customer ID and device serial are required.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await upsertAdminEnergyDevice(staffUser.id, staffUser.username, {
        customerId: customerId.trim(),
        brand,
        deviceSerial: deviceSerial.trim(),
        plantId: plantId.trim() || undefined,
        unitRatePkr: Number(unitRate) || 55,
      });
      setMsg("Energy device registered.");
      setDeviceSerial("");
      setPlantId("");
      await load();
    } catch (err: any) {
      setMsg(err.message || "Registration failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-slate-100">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Activity className="w-5 h-5 text-emerald-400" />
        Energy Monitoring
      </h3>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <Wifi className="w-4 h-4 text-emerald-500 mb-2" />
            <p className="text-[10px] text-slate-500 uppercase font-mono">Online</p>
            <p className="text-xl font-extrabold">{summary.onlineCount}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <WifiOff className="w-4 h-4 text-slate-500 mb-2" />
            <p className="text-[10px] text-slate-500 uppercase font-mono">Offline</p>
            <p className="text-xl font-extrabold">{summary.offlineCount}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <AlertTriangle className="w-4 h-4 text-rose-400 mb-2" />
            <p className="text-[10px] text-slate-500 uppercase font-mono">Open alerts</p>
            <p className="text-xl font-extrabold">{summary.openAlerts}</p>
          </div>
        </div>
      )}

      <form onSubmit={registerDevice} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-amber-400 flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> Register customer inverter
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm"
            placeholder="Customer ID (e.g. cust-101)"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          />
          <select
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          >
            {ENERGY_BRANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <input
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm"
            placeholder="Device serial"
            value={deviceSerial}
            onChange={(e) => setDeviceSerial(e.target.value)}
          />
          <input
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm"
            placeholder="Plant ID (optional)"
            value={plantId}
            onChange={(e) => setPlantId(e.target.value)}
          />
          <input
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm"
            placeholder="Tariff PKR/kWh"
            value={unitRate}
            onChange={(e) => setUnitRate(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Register device"}
        </button>
        {msg && <p className="text-xs text-amber-300">{msg}</p>}
      </form>

      {loading ? (
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      ) : (
        <div className="space-y-4">
          {(summary?.customers || []).map((c: any) => (
            <div key={c.customerId} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="font-bold text-sm">
                {c.customerName || c.customerId}{" "}
                <span className="text-slate-500 font-mono text-[10px]">{c.customerId}</span>
              </p>
              <div className="mt-2 space-y-1">
                {(c.devices || []).map((d: any) => (
                  <p key={d.id} className="text-xs text-slate-400 font-mono">
                    {d.brand} · {d.deviceSerial} · {d.status}
                    {d.lastSync ? ` · sync ${new Date(d.lastSync).toLocaleString()}` : " · never synced"}
                  </p>
                ))}
              </div>
              {(c.alerts || []).length > 0 && (
                <div className="mt-2 space-y-1">
                  {c.alerts.map((a: any) => (
                    <p key={a.id} className="text-xs text-rose-300">
                      [{a.alertType}] {a.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
          {(summary?.customers?.length || 0) === 0 && (
            <p className="text-sm text-slate-500">No registered energy devices yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
