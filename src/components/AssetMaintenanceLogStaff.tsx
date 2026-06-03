import React, { useState } from "react";
import { ClipboardList, History } from "lucide-react";
import { User } from "../types";
import {
  createAdminMaintenanceRecord,
  listAdminAfterSalesServiceLogs,
  upsertAdminPortalProfile,
} from "../services/api";
import { SERVICE_HISTORY_TYPES } from "../lib/clientPortalServiceHistory";

interface AssetMaintenanceLogStaffProps {
  staffUser: User;
}

export default function AssetMaintenanceLogStaff({ staffUser }: AssetMaintenanceLogStaffProps) {
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [serviceType, setServiceType] = useState(SERVICE_HISTORY_TYPES[0]);
  const [serviceDate, setServiceDate] = useState("");
  const [technician, setTechnician] = useState("");
  const [description, setDescription] = useState("");
  const [replacementParts, setReplacementParts] = useState("");
  const [warrantyCovered, setWarrantyCovered] = useState(true);
  const [laborCost, setLaborCost] = useState("");
  const [partsCost, setPartsCost] = useState("");
  const [performancePct, setPerformancePct] = useState("");
  const [beforePhoto, setBeforePhoto] = useState("");
  const [afterPhoto, setAfterPhoto] = useState("");
  const [nextServiceDate, setNextServiceDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim()) {
      setMsg("Customer ID is required.");
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      await createAdminMaintenanceRecord(staffUser.id, staffUser.username, {
        customerId: customerId.trim(),
        projectId: projectId || undefined,
        serviceType,
        serviceDate: serviceDate || undefined,
        technicianName: technician || staffUser.name,
        description,
        replacementParts: replacementParts || undefined,
        warrantyCovered,
        laborCost: laborCost ? Number(laborCost) : 0,
        partsCost: partsCost ? Number(partsCost) : 0,
        performanceImprovementPct: performancePct ? Number(performancePct) : undefined,
        beforePhotoUrl: beforePhoto || undefined,
        afterPhotoUrl: afterPhoto || undefined,
      });
      if (nextServiceDate) {
        await upsertAdminPortalProfile(staffUser.id, staffUser.username, {
          customerId: customerId.trim(),
          nextRecommendedServiceDate: nextServiceDate,
        });
      }
      const list = await listAdminAfterSalesServiceLogs(
        staffUser.id,
        staffUser.username,
        customerId.trim()
      );
      setMsg(`Maintenance record saved. ${list.logs?.length || 0} records on file for this customer.`);
    } catch (err: any) {
      setMsg(err.message || "Failed to save record.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 text-slate-100">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <History className="w-5 h-5 text-amber-500" />
        Asset &amp; Maintenance Log
      </h3>
      <p className="text-xs text-slate-500">
        Permanent service history for customers. Records appear in the customer Service History tab.
      </p>

      <form onSubmit={submit} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
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
        <select
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        >
          {SERVICE_HISTORY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            placeholder="Technician name"
            value={technician}
            onChange={(e) => setTechnician(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <textarea
          required
          placeholder="Description of work performed"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <input
          placeholder="Replacement parts (optional)"
          value={replacementParts}
          onChange={(e) => setReplacementParts(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={warrantyCovered}
            onChange={(e) => setWarrantyCovered(e.target.checked)}
          />
          Warranty covered (no charge to customer)
        </label>
        {!warrantyCovered && (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              placeholder="Labor cost PKR"
              value={laborCost}
              onChange={(e) => setLaborCost(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Parts cost PKR"
              value={partsCost}
              onChange={(e) => setPartsCost(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            />
          </div>
        )}
        <input
          type="number"
          step="0.1"
          placeholder="Performance improvement %"
          value={performancePct}
          onChange={(e) => setPerformancePct(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <input
          placeholder="Before photo URL"
          value={beforePhoto}
          onChange={(e) => setBeforePhoto(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <input
          placeholder="After photo URL"
          value={afterPhoto}
          onChange={(e) => setAfterPhoto(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <input
          type="date"
          placeholder="Next recommended service"
          value={nextServiceDate}
          onChange={(e) => setNextServiceDate(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 text-sm font-extrabold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <ClipboardList className="w-4 h-4" />
          {loading ? "Saving…" : "Create service record"}
        </button>
        {msg && <p className="text-xs text-slate-400">{msg}</p>}
      </form>
    </div>
  );
}
