import React, { useCallback, useEffect, useState } from "react";
import { Loader2, ChevronRight, Package } from "lucide-react";
import { User } from "../types";
import {
  fetchTechnicalProjectDeliveriesMe,
  fetchTechnicalProjectDeliveryById,
  postTechnicalDeliveryInstalledEquipment,
  postTechnicalDeliveryPhoto,
  patchTechnicalDeliveryStatus,
} from "../services/api";
import { DELIVERY_SAFETY_CHECKLIST, INSTALLATION_PHOTO_CATEGORIES } from "../lib/projectDelivery";

export default function TechnicalDeliveryPanel({ user }: { user: User }) {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [safety, setSafety] = useState<Record<string, boolean>>({});
  const [eqBrand, setEqBrand] = useState("GoodWe");
  const [eqModel, setEqModel] = useState("GW10K-ET");
  const [eqSerial, setEqSerial] = useState("");
  const [photoUrl, setPhotoUrl] = useState("https://example.com/inverter-install.jpg");

  const load = useCallback(async () => {
    setLoading(true);
    setSyncError(null);
    try {
      const data = await fetchTechnicalProjectDeliveriesMe(user.id, user.username);
      setDeliveries(data.deliveries || []);
    } catch {
      setSyncError("Internet required to sync job updates.");
    } finally {
      setLoading(false);
    }
  }, [user.id, user.username]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    try {
      const data = await fetchTechnicalProjectDeliveryById(user.id, user.username, id);
      setDetail(data);
      setSafety((data.delivery?.safetyChecklist as Record<string, boolean>) || {});
    } catch {
      setSyncError("Internet required to sync job updates.");
    }
  };

  const setStatus = async (status: string) => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await patchTechnicalDeliveryStatus(user.id, user.username, selectedId, {
        status,
        safetyChecklist: safety,
      });
      await open(selectedId);
      await load();
    } catch {
      setSyncError("Internet required to sync job updates.");
    } finally {
      setSaving(false);
    }
  };

  const saveEquipment = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await postTechnicalDeliveryInstalledEquipment(user.id, user.username, selectedId, {
        equipmentType: "Inverter",
        brand: eqBrand,
        model: eqModel,
        serialNumber: eqSerial || `SN-${Date.now()}`,
        capacity: "10kW",
        quantity: 1,
      });
      await open(selectedId);
    } catch {
      setSyncError("Internet required to sync job updates.");
    } finally {
      setSaving(false);
    }
  };

  const savePhoto = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await postTechnicalDeliveryPhoto(user.id, user.username, selectedId, {
        photoCategory: "Inverter photo",
        photoUrl,
      });
      await open(selectedId);
    } catch {
      setSyncError("Internet required to sync job updates.");
    } finally {
      setSaving(false);
    }
  };

  if (selectedId && detail) {
    const d = detail.delivery;
    return (
      <div className="space-y-4 pb-8">
        <button type="button" onClick={() => setSelectedId(null)} className="text-amber-400 text-sm font-bold">
          ← Deliveries
        </button>
        {syncError && <p className="text-rose-300 text-sm">{syncError}</p>}
        <h2 className="text-lg font-extrabold">{d.projectTitle}</h2>
        <p className="text-xs text-slate-400">{d.deliveryStatus} · {d.installationAddress || "—"}</p>
        <div className="grid grid-cols-2 gap-2">
          {["Material Delivered", "Installation In Progress", "Installation Completed", "Handover Completed"].map(
            (s) => (
              <button
                key={s}
                type="button"
                disabled={saving}
                onClick={() => setStatus(s)}
                className="py-2 rounded-xl bg-slate-800 text-[10px] font-bold"
              >
                {s}
              </button>
            )
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
          <p className="text-xs font-bold text-amber-400">Installed equipment</p>
          <input className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-sm" value={eqBrand} onChange={(e) => setEqBrand(e.target.value)} placeholder="Brand" />
          <input className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-sm" value={eqModel} onChange={(e) => setEqModel(e.target.value)} placeholder="Model" />
          <input className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-sm" value={eqSerial} onChange={(e) => setEqSerial(e.target.value)} placeholder="Serial" />
          <button type="button" onClick={saveEquipment} className="w-full py-2 bg-amber-500 text-slate-950 font-bold rounded-xl text-sm">
            Add inverter
          </button>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
          <p className="text-xs font-bold text-amber-400">Photo URL</p>
          <input className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-sm" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} />
          <button type="button" onClick={savePhoto} className="w-full py-2 bg-slate-800 font-bold rounded-xl text-sm">
            Upload inverter photo
          </button>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
          {DELIVERY_SAFETY_CHECKLIST.map((item) => (
            <label key={item.key} className="flex gap-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={!!safety[item.key]}
                onChange={(e) => setSafety((s) => ({ ...s, [item.key]: e.target.checked }))}
              />
              {item.label}
            </label>
          ))}
        </div>
        <p className="text-[10px] text-slate-500">
          Photos: {detail.photos?.length || 0} · Installed: {detail.installedEquipment?.length || 0}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-slate-300 flex items-center gap-2">
        <Package className="h-4 w-4 text-amber-500" /> Assigned deliveries
      </h2>
      {syncError && <p className="text-rose-300 text-sm">{syncError}</p>}
      {loading ? (
        <Loader2 className="h-8 w-8 animate-spin text-amber-500 mx-auto" />
      ) : deliveries.length === 0 ? (
        <p className="text-sm text-slate-500">No deliveries assigned yet.</p>
      ) : (
        <ul className="space-y-2">
          {deliveries.map((d) => (
            <li key={d.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="font-bold">{d.projectTitle}</p>
              <p className="text-xs text-amber-400">{d.deliveryStatus}</p>
              <button
                type="button"
                onClick={() => open(d.id)}
                className="mt-2 w-full py-3 rounded-xl bg-amber-500 text-slate-950 font-extrabold text-sm flex justify-center gap-1"
              >
                Open <ChevronRight className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
