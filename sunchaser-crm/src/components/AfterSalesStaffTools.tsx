import React, { useState } from "react";
import { Wrench, Camera, Package, ClipboardList } from "lucide-react";
import { User } from "../types";
import {
  upsertAdminPortalProfile,
  createAdminCustomerEquipment,
  createAdminInstallationPhoto,
  createAdminAfterSalesServiceLog,
  listAdminAfterSalesServiceLogs,
} from "../services/api";
import {
  EQUIPMENT_TYPES,
  INSTALLATION_PHOTO_CATEGORIES,
  AFTER_SALES_SERVICE_TYPES,
} from "../lib/clientPortalPakistan";

interface AfterSalesStaffToolsProps {
  staffUser: User;
}

export default function AfterSalesStaffTools({ staffUser }: AfterSalesStaffToolsProps) {
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [trackerType, setTrackerType] = useState<"residential" | "industrial">("residential");
  const [freeMonths, setFreeMonths] = useState("6");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [equipType, setEquipType] = useState(EQUIPMENT_TYPES[0].key);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");

  const [photoCategory, setPhotoCategory] = useState(INSTALLATION_PHOTO_CATEGORIES[0].key);
  const [photoUrl, setPhotoUrl] = useState("");
  const [voiceNoteUrl, setVoiceNoteUrl] = useState("");

  const [serviceType, setServiceType] = useState(AFTER_SALES_SERVICE_TYPES[0]);
  const [componentChanged, setComponentChanged] = useState("");
  const [newDetails, setNewDetails] = useState("");
  const [technician, setTechnician] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [underFree, setUnderFree] = useState(true);
  const [charge, setCharge] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [beforePhoto, setBeforePhoto] = useState("");
  const [afterPhoto, setAfterPhoto] = useState("");

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      await upsertAdminPortalProfile(staffUser.id, staffUser.username, {
        customerId: customerId.trim(),
        projectId: projectId || undefined,
        trackerType,
        freeServiceMonths: Number(freeMonths),
      });
      setMsg("Portal profile saved (tracker type + free service period).");
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      await createAdminCustomerEquipment(staffUser.id, staffUser.username, {
        customerId: customerId.trim(),
        projectId: projectId || undefined,
        equipmentType: equipType,
        brand,
        model,
        serialNumber: serial,
      });
      setMsg("Equipment record added.");
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addPhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim() || !photoUrl.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      await createAdminInstallationPhoto(staffUser.id, staffUser.username, {
        customerId: customerId.trim(),
        projectId: projectId || undefined,
        photoCategory,
        photoUrl,
        voiceNoteUrl: voiceNoteUrl || undefined,
      });
      setMsg("Installation photo linked.");
      setPhotoUrl("");
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addServiceLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      await createAdminAfterSalesServiceLog(staffUser.id, staffUser.username, {
        customerId: customerId.trim(),
        projectId: projectId || undefined,
        serviceType,
        componentChanged,
        newComponentDetails: newDetails,
        technicianName: technician || staffUser.name,
        serviceDate: serviceDate || undefined,
        underFreeService: underFree,
        chargeAmount: charge ? Number(charge) : 0,
        customerVisibleNotes: customerNotes,
        internalNotes,
        beforePhotoUrl: beforePhoto || undefined,
        afterPhotoUrl: afterPhoto || undefined,
        voiceNoteUrl: voiceNoteUrl || undefined,
      });
      const list = await listAdminAfterSalesServiceLogs(
        staffUser.id,
        staffUser.username,
        customerId.trim()
      );
      setMsg(`Service log saved. ${list.logs?.length || 0} log(s) for customer.`);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 text-slate-100">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Wrench className="w-5 h-5 text-amber-500" />
        Pakistan After-Sales Tools
      </h3>
      {msg && <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-900/40 rounded-xl px-3 py-2">{msg}</p>}

      <form onSubmit={saveProfile} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold flex items-center gap-2">
          <ClipboardList className="w-4 h-4" /> Customer / project type
        </p>
        <input
          required
          placeholder="Customer ID"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <input
          placeholder="Project ID (optional)"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <select
            value={trackerType}
            onChange={(e) => setTrackerType(e.target.value as "residential" | "industrial")}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          >
            <option value="residential">Residential tracker</option>
            <option value="industrial">Industrial tracker</option>
          </select>
          <select
            value={freeMonths}
            onChange={(e) => setFreeMonths(e.target.value)}
            className="w-28 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          >
            <option value="6">6 mo free</option>
            <option value="12">12 mo free</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-extrabold"
        >
          Save profile
        </button>
      </form>

      <form onSubmit={addEquipment} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold flex items-center gap-2">
          <Package className="w-4 h-4" /> Equipment registry
        </p>
        <select
          value={equipType}
          onChange={(e) => setEquipType(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        >
          {EQUIPMENT_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-2">
          <input placeholder="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
          <input placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
          <input placeholder="Serial" value={serial} onChange={(e) => setSerial(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
        </div>
        <button type="submit" disabled={loading || !customerId} className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-bold">
          Add equipment
        </button>
      </form>

      <form onSubmit={addPhoto} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold flex items-center gap-2">
          <Camera className="w-4 h-4" /> Installation photo
        </p>
        <select
          value={photoCategory}
          onChange={(e) => setPhotoCategory(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        >
          {INSTALLATION_PHOTO_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          required
          placeholder="Photo URL"
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <input
          placeholder="Voice note URL (optional, future)"
          value={voiceNoteUrl}
          onChange={(e) => setVoiceNoteUrl(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <button type="submit" disabled={loading || !customerId} className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-bold">
          Add photo
        </button>
      </form>

      <form onSubmit={addServiceLog} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold">After-sales service log</p>
        <select
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        >
          {AFTER_SALES_SERVICE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input placeholder="Component changed" value={componentChanged} onChange={(e) => setComponentChanged(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
        <input placeholder="New component details" value={newDetails} onChange={(e) => setNewDetails(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
          <input placeholder="Technician" value={technician} onChange={(e) => setTechnician(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={underFree} onChange={(e) => setUnderFree(e.target.checked)} />
          Under free service period
        </label>
        {!underFree && (
          <input placeholder="Charge amount PKR" value={charge} onChange={(e) => setCharge(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
        )}
        <textarea placeholder="Customer-visible notes" value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} rows={2} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
        <textarea placeholder="Internal notes (staff only)" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Before photo URL" value={beforePhoto} onChange={(e) => setBeforePhoto(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
          <input placeholder="After photo URL" value={afterPhoto} onChange={(e) => setAfterPhoto(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm" />
        </div>
        <button type="submit" disabled={loading || !customerId} className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-extrabold">
          Log service visit
        </button>
      </form>
    </div>
  );
}
