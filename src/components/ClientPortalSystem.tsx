import React, { useEffect, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { User } from "../types";
import { fetchCustomerPortalSystem } from "../services/api";

interface ClientPortalSystemProps {
  user: User;
}

export default function ClientPortalSystem({ user }: ClientPortalSystemProps) {
  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCustomerPortalSystem(user.id, user.username)
      .then((d) => setSystem(d.system))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user.id, user.username]);

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin mx-auto" />
      </div>
    );
  }

  if (error) return <p className="text-sm text-rose-400 text-center">{error}</p>;

  const rows = [
    ["System size", system?.systemSizeKw != null ? `${system.systemSizeKw} kW` : "—"],
    ["System type", system?.systemType || "—"],
    ["Panels", system?.panelBrand ? `${system.panelBrand} · ${system.panelQuantity || "?"} × ${system.panelWattage || "?"}W` : "—"],
    ["Inverter", system?.inverterBrand ? `${system.inverterBrand} · ${system.inverterSizeKw || "?"} kW` : "—"],
    ["Battery", system?.batteryBrand ? `${system.batteryBrand} · ${system.batteryCapacityKwh || "?"} kWh` : "—"],
    ["Structure", system?.structureType || "—"],
    ["Installation", system?.installationDate || "—"],
    ["Warranty", system?.warrantyStart && system?.warrantyEnd ? `${system.warrantyStart} → ${system.warrantyEnd}` : "—"],
    ["Net metering", system?.netMeteringStatus || "—"],
    ["Meter / Consumer", [system?.meterNumber, system?.consumerNumber].filter(Boolean).join(" / ") || "—"],
    ["Sanctioned load", system?.sanctionedLoadKw != null ? `${system.sanctionedLoadKw} kW` : "—"],
    ["Site", system?.siteAddress || "—"],
  ];

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 px-1 flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-500" /> My system details
      </h3>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl divide-y divide-slate-800">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 px-4 py-3 text-sm">
            <span className="text-slate-500 font-mono text-xs">{label}</span>
            <span className="text-slate-100 text-right">{value}</span>
          </div>
        ))}
      </div>
      {system?.notes && (
        <p className="text-xs text-slate-400 px-1 font-mono">{system.notes}</p>
      )}
    </section>
  );
}
