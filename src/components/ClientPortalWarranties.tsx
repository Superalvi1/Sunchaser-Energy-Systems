import React, { useEffect, useState } from "react";
import { Loader2, Shield, Send, Package, Camera, ImageIcon } from "lucide-react";
import { User } from "../types";
import {
  fetchCustomerPortalWarranties,
  submitCustomerWarrantyClaim,
  fetchCustomerEquipment,
  fetchCustomerInstallationPhotos,
  fetchCustomerProjectDeliveryMe,
  fetchCustomerWarrantyHandoverMe,
  warrantyHandoverPdfUrl,
} from "../services/api";
import { WARRANTY_COMPONENT_TYPES } from "../lib/clientPortalPhase2";
import { EQUIPMENT_TYPES } from "../lib/clientPortalPakistan";

interface ClientPortalWarrantiesProps {
  user: User;
}

function statusColor(status: string) {
  if (status === "Active") return "text-emerald-400 border-emerald-900/50 bg-emerald-950/30";
  if (status === "Expiring Soon") return "text-amber-400 border-amber-900/50 bg-amber-950/30";
  if (status === "Expired") return "text-rose-400 border-rose-900/50 bg-rose-950/30";
  return "text-slate-500 border-slate-800 bg-slate-950/50";
}

export default function ClientPortalWarranties({ user }: ClientPortalWarrantiesProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [installedRegistry, setInstalledRegistry] = useState<any[]>([]);
  const [handover, setHandover] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [component, setComponent] = useState(WARRANTY_COMPONENT_TYPES[0].label);
  const [equipmentId, setEquipmentId] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [voiceNoteUrl, setVoiceNoteUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [warr, equip, inst, delivery, handoverRes] = await Promise.all([
        fetchCustomerPortalWarranties(user.id, user.username),
        fetchCustomerEquipment(user.id, user.username),
        fetchCustomerInstallationPhotos(user.id, user.username),
        fetchCustomerProjectDeliveryMe(user.id, user.username).catch(() => null),
        fetchCustomerWarrantyHandoverMe(user.id, user.username).catch(() => null),
      ]);
      setCards(warr.cards || []);
      setEquipment(equip.equipment || []);
      setPhotos(inst.photos || []);
      setInstalledRegistry(delivery?.installedEquipment || []);
      setHandover(handoverRes);
    } catch (err: any) {
      setError(err.message || "Unable to load warranties.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user.id, user.username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const selected = equipment.find((eq) => eq.id === equipmentId);
      await submitCustomerWarrantyClaim(user.id, user.username, {
        component: selected?.equipmentLabel || component,
        equipmentId: equipmentId || undefined,
        equipmentType: selected?.equipmentType,
        issueDescription,
        photoUrl: photoUrl || undefined,
        videoUrl: videoUrl || undefined,
        voiceNoteUrl: voiceNoteUrl || undefined,
      });
      setSubmitMsg("Warranty claim submitted. A support ticket was created for our team.");
      setIssueDescription("");
      setPhotoUrl("");
      setVideoUrl("");
      setVoiceNoteUrl("");
      setEquipmentId("");
      setShowForm(false);
    } catch (err: any) {
      setSubmitMsg(err.message || "Failed to submit claim.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin mx-auto" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-rose-400 text-center">{error}</p>;
  }

  return (
    <section className="space-y-6">
      <div>
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 px-1 mb-3">
          My Warranty
        </h3>
        {handover?.handover && (
          <div className="mb-4 bg-slate-900 border border-amber-900/40 rounded-2xl p-4 space-y-2">
            <p className="text-sm font-bold text-amber-400">Warranty handover</p>
            <p className="text-xs text-slate-400">
              Stage: {handover.handover.completionStage}
              {handover.handover.installationDate
                ? ` · Installed ${handover.handover.installationDate}`
                : ""}
            </p>
            {handover.handover.warrantyStart && (
              <p className="text-xs text-slate-300">
                Coverage {handover.handover.warrantyStart} → {handover.handover.warrantyEnd || "—"}
              </p>
            )}
            {handover.handover.canDownloadPdf && handover.deliveryId ? (
              <a
                href={warrantyHandoverPdfUrl(handover.deliveryId, {
                  portalUserId: user.id,
                  portalUsername: user.username,
                })}
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold"
              >
                Download warranty handover PDF
              </a>
            ) : (
              <p className="text-[10px] text-slate-500">
                Handover PDF available when installation proof is complete.
                {handover.handover.missing?.length
                  ? ` Pending: ${handover.handover.missing.join(", ")}`
                  : ""}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3">
          {cards.map((card) => {
            const w = card.warranty;
            const status = w?.status || "No data available";
            return (
              <div key={card.type} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-amber-500" />
                    <p className="text-sm font-bold text-white">{card.label}</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg border ${statusColor(status)}`}>
                    {status}
                  </span>
                </div>
                {w ? (
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
                    <div>
                      <dt className="text-slate-600">Brand / model</dt>
                      <dd className="text-slate-300">{[w.brand, w.model].filter(Boolean).join(" ") || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-600">Serial</dt>
                      <dd className="text-slate-300">{w.serialNumber || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-600">Expiry</dt>
                      <dd className="text-slate-300">{w.endDate || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-600">Remaining</dt>
                      <dd className="text-amber-400/90">{w.remainingLabel}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-xs text-slate-500 mt-2 font-mono">No data available</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {installedRegistry.length > 0 && (
        <div>
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 px-1 mb-3 flex items-center gap-2">
            <Package className="w-3.5 h-3.5" /> Installed equipment registry
          </h3>
          <div className="space-y-2">
            {installedRegistry.map((eq) => (
              <div key={eq.id} className="bg-slate-900 border border-amber-900/30 rounded-xl p-3 text-xs">
                <p className="font-bold text-white">{eq.equipmentType}</p>
                <p className="text-slate-400 mt-1">
                  {[eq.brand, eq.model].filter(Boolean).join(" · ")}
                  {eq.serialNumber ? ` · S/N ${eq.serialNumber}` : ""}
                </p>
                {(eq.warrantyStartDate || eq.warrantyEndDate) && (
                  <p className="text-slate-500 mt-1">
                    Warranty {eq.warrantyStartDate || "—"} → {eq.warrantyEndDate || "—"}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 px-1 mb-3 flex items-center gap-2">
          <Package className="w-3.5 h-3.5" /> Equipment registry
        </h3>
        {equipment.length === 0 ? (
          <p className="text-xs text-slate-500 font-mono px-1">No equipment registered yet.</p>
        ) : (
          <div className="space-y-2">
            {equipment.map((eq) => (
              <div key={eq.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs">
                <p className="font-bold text-white">{eq.equipmentLabel}</p>
                <p className="text-slate-400 mt-1">
                  {[eq.brand, eq.model].filter(Boolean).join(" · ") || "—"}
                  {eq.serialNumber ? ` · S/N ${eq.serialNumber}` : ""}
                </p>
                {eq.warrantyEnd && <p className="text-slate-500 mt-1">Warranty until {eq.warrantyEnd}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 px-1 mb-3 flex items-center gap-2">
          <Camera className="w-3.5 h-3.5" /> Installation photos
        </h3>
        {photos.length === 0 ? (
          <p className="text-xs text-slate-500 font-mono px-1">No installation photos yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="aspect-video bg-slate-950 flex items-center justify-center">
                  {p.photoUrl ? (
                    <img src={p.photoUrl} alt={p.categoryLabel} className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-slate-700" />
                  )}
                </div>
                <p className="text-[10px] font-bold text-slate-400 px-2 py-1.5">{p.categoryLabel}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm py-3 rounded-xl flex items-center justify-center gap-2"
        >
          <Send className="w-4 h-4" />
          Request Warranty Claim
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-white">Warranty claim</p>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Equipment / component</label>
            <select
              value={equipmentId}
              onChange={(e) => {
                setEquipmentId(e.target.value);
                const eq = equipment.find((x) => x.id === e.target.value);
                if (eq) setComponent(eq.equipmentLabel);
              }}
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            >
              <option value="">Select from registry or use list below</option>
              {equipment.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.equipmentLabel} — {eq.brand || ""} {eq.model || ""}
                </option>
              ))}
            </select>
            {!equipmentId && (
              <select
                value={component}
                onChange={(e) => setComponent(e.target.value)}
                className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              >
                {WARRANTY_COMPONENT_TYPES.map((c) => (
                  <option key={c.type} value={c.label}>
                    {c.label}
                  </option>
                ))}
                {EQUIPMENT_TYPES.map((c) => (
                  <option key={c.key} value={c.label}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Issue description</label>
            <textarea
              required
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              rows={4}
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <input
            placeholder="Photo URL"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            placeholder="Video URL (optional)"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            placeholder="Voice note URL (optional, future)"
            value={voiceNoteUrl}
            onChange={(e) => setVoiceNoteUrl(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-xl border border-slate-700 text-slate-400 text-sm font-bold">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="flex-1 py-2 rounded-xl bg-amber-500 text-slate-950 text-sm font-extrabold disabled:opacity-50">
              {submitting ? "Sending…" : "Submit claim"}
            </button>
          </div>
        </form>
      )}

      {submitMsg && <p className="text-xs text-center text-amber-400 font-mono">{submitMsg}</p>}
    </section>
  );
}
