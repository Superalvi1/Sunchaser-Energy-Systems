import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Download,
  Loader2,
  MapPin,
  Plus,
  Send,
  Truck,
} from "lucide-react";
import type { User } from "../types";
import {
  buildOtpWhatsAppText,
  isChallanLocked,
  RECEIVER_RELATIONS,
  type DeliveryChallan,
  type InvoiceDeliverySummary,
} from "../lib/deliveryManagement";
import {
  captureAdminDeliverySignature,
  createAdminDeliveryChallan,
  deliveryCertificateUrl,
  fetchAdminDeliveriesForInvoice,
  sendAdminDeliveryOtp,
  updateAdminDeliveryChallan,
  updateAdminDeliveryChallanStatus,
  uploadAdminDeliveryPhoto,
  verifyAdminDeliveryChallan,
  verifyAdminDeliveryOtp,
} from "../services/api";

type Props = {
  staffUser: User;
  invoiceId: string;
  invoiceNumber?: string;
  customerName?: string;
  onBack?: () => void;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  out_for_delivery: "Out for Delivery",
  delivered_pending_verification: "Pending Verification",
  verified_received: "Verified Received",
  disputed: "Disputed",
  cancelled: "Cancelled",
};

function SignaturePad({ onSave }: { onSave: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, []);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        className="border border-slate-300 rounded-lg bg-white w-full touch-none"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div className="flex gap-2">
        <button type="button" className="text-xs font-bold text-slate-600" onClick={clear}>
          Clear
        </button>
        <button
          type="button"
          className="text-xs font-bold text-violet-700"
          onClick={save}
        >
          Save Signature
        </button>
      </div>
    </div>
  );
}

export default function DeliveryChallanPanel({
  staffUser,
  invoiceId,
  invoiceNumber,
  customerName,
  onBack,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<InvoiceDeliverySummary | null>(null);
  const [challans, setChallans] = useState<DeliveryChallan[]>([]);
  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [activeChallan, setActiveChallan] = useState<DeliveryChallan | null>(null);
  const [createLines, setCreateLines] = useState<
    { invoiceItemId: string; itemName: string; invoiceQty: number; previouslyDelivered: number; deliverNow: string; inventoryItemId: string; serialNumber: string; selected: boolean }[]
  >([]);
  const [otpInput, setOtpInput] = useState("");
  const [otpDisplay, setOtpDisplay] = useState<string | null>(null);
  const [checklist, setChecklist] = useState({ receivedMaterial: false, quantityCorrect: false, conditionAcceptable: false });
  const [receiver, setReceiver] = useState({ name: "", phone: "", cnic: "", relation: "owner" });

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const data = await fetchAdminDeliveriesForInvoice(staffUser, invoiceId);
      setSummary(data.summary);
      setChallans(data.challans || []);
      const lines = data.summary?.lineSummaries || [];
      setCreateLines(
        lines.map((l: any) => ({
          invoiceItemId: l.invoiceItemId,
          itemName: l.itemName,
          invoiceQty: l.invoiceQty,
          previouslyDelivered: l.invoiceQty - l.remainingQty,
          deliverNow: l.remainingQty > 0 ? String(l.remainingQty) : "",
          inventoryItemId: "",
          serialNumber: "",
          selected: l.remainingQty > 0,
        }))
      );
    } catch (err: any) {
      setMsg(err.message || "Failed to load deliveries.");
    } finally {
      setLoading(false);
    }
  }, [staffUser, invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  const openChallan = (ch: DeliveryChallan) => {
    setActiveChallan(ch);
    setReceiver({
      name: ch.receiverName || "",
      phone: ch.receiverPhone || "",
      cnic: ch.receiverCnic || "",
      relation: ch.receiverRelation || "owner",
    });
    setView("detail");
  };

  const handleCreate = async () => {
    const items = createLines
      .filter((l) => l.selected && Number(l.deliverNow) > 0)
      .map((l) => ({
        invoiceItemId: l.invoiceItemId,
        itemName: l.itemName,
        invoiceQty: l.invoiceQty,
        deliverNowQty: Number(l.deliverNow),
        inventoryItemId: l.inventoryItemId || null,
        serialNumber: l.serialNumber,
      }));
    if (!items.length) {
      setMsg("Select at least one item with deliver quantity.");
      return;
    }
    setSaving(true);
    try {
      const { challan } = await createAdminDeliveryChallan(staffUser, {
        invoiceId,
        deliveryTitle: `Delivery — ${invoiceNumber || invoiceId}`,
        items,
      });
      await load();
      openChallan(challan);
      setMsg("Delivery challan created.");
    } catch (err: any) {
      setMsg(err.message || "Create failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleSendOtp = async () => {
    if (!activeChallan) return;
    setSaving(true);
    try {
      const data = await sendAdminDeliveryOtp(staffUser, activeChallan.id);
      setOtpDisplay(data.otp);
      setActiveChallan(data.challan);
      setMsg("OTP generated. Copy to WhatsApp.");
    } catch (err: any) {
      setMsg(err.message || "OTP failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!activeChallan) return;
    setSaving(true);
    try {
      const data = await verifyAdminDeliveryOtp(staffUser, activeChallan.id, {
        code: otpInput,
        verifiedByPhone: receiver.phone,
      });
      setActiveChallan(data.challan);
      setMsg("OTP verified.");
    } catch (err: any) {
      setMsg(err.message || "Invalid OTP.");
    } finally {
      setSaving(false);
    }
  };

  const handleSignature = async (dataUrl: string) => {
    if (!activeChallan) return;
    setSaving(true);
    try {
      const data = await captureAdminDeliverySignature(staffUser, activeChallan.id, { signatureDataUrl: dataUrl });
      setActiveChallan(data.challan);
      setMsg("Signature saved.");
    } catch (err: any) {
      setMsg(err.message || "Signature failed.");
    } finally {
      setSaving(false);
    }
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>, photoType: string) => {
    if (!activeChallan || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = async () => {
      setSaving(true);
      try {
        const data = await uploadAdminDeliveryPhoto(staffUser, activeChallan!.id, {
          base64Data: reader.result,
          fileName: file.name,
          mimeType: file.type,
          photoType,
        });
        setActiveChallan(data.challan);
        setMsg("Photo uploaded.");
      } catch (err: any) {
        setMsg(err.message || "Upload failed.");
      } finally {
        setSaving(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const captureGps = () => {
    if (!navigator.geolocation) {
      setMsg("GPS not available.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!activeChallan) return;
        try {
          const data = await updateAdminDeliveryChallan(staffUser, activeChallan.id, {
            gpsLat: pos.coords.latitude,
            gpsLng: pos.coords.longitude,
          });
          setActiveChallan(data.challan);
          setMsg("GPS captured.");
        } catch (err: any) {
          setMsg(err.message || "GPS save failed.");
        }
      },
      () => setMsg("Could not get GPS location.")
    );
  };

  const handleVerifyDelivery = async () => {
    if (!activeChallan) return;
    setSaving(true);
    try {
      await updateAdminDeliveryChallan(staffUser, activeChallan.id, {
        receiverName: receiver.name,
        receiverPhone: receiver.phone,
        receiverCnic: receiver.cnic,
        receiverRelation: receiver.relation,
        status: "delivered_pending_verification",
      });
      const data = await verifyAdminDeliveryChallan(staffUser, activeChallan.id, {
        ...checklist,
        receiverName: receiver.name,
        receiverPhone: receiver.phone,
        receiverCnic: receiver.cnic,
        receiverRelation: receiver.relation,
      });
      setActiveChallan(data.challan);
      await load();
      setMsg("Delivery verified. Certificate generated.");
    } catch (err: any) {
      setMsg(err.message || "Verification failed.");
    } finally {
      setSaving(false);
    }
  };

  const locked = activeChallan ? isChallanLocked(activeChallan.status) : false;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading deliveries…
      </div>
    );
  }

  return (
    <div className="space-y-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} className="text-slate-500 hover:text-slate-800">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <Truck className="h-4 w-4 text-violet-600" /> Material Deliveries
            </h3>
            <p className="text-[10px] text-slate-500">
              Invoice {invoiceNumber || invoiceId} · {customerName || "Customer"}
            </p>
          </div>
        </div>
        {view === "list" && (
          <button
            type="button"
            onClick={() => setView("create")}
            className="inline-flex items-center gap-1 bg-violet-600 text-white text-xs font-bold px-3 py-2 rounded-lg"
          >
            <Plus className="h-3.5 w-3.5" /> Create Delivery Challan
          </button>
        )}
      </div>

      {msg && <div className="text-xs text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">{msg}</div>}

      {summary && view === "list" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="text-slate-500">Delivered</div>
            <div className="text-lg font-black text-emerald-700">{summary.deliveredPercent}%</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="text-slate-500">Challans</div>
            <div className="text-lg font-black">{summary.challanCount}</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="text-slate-500">Verified</div>
            <div className="text-lg font-black text-emerald-600">{summary.verifiedCount}</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="text-slate-500">Remaining Qty</div>
            <div className="text-lg font-black text-amber-700">{summary.remainingQty}</div>
          </div>
        </div>
      )}

      {view === "list" && (
        <div className="space-y-2">
          {challans.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">No delivery challans yet.</p>
          ) : (
            challans.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => openChallan(ch)}
                className="w-full text-left border border-slate-200 rounded-xl p-3 bg-white hover:border-violet-400 transition"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-slate-800 text-sm">{ch.challanNumber}</div>
                    <div className="text-[10px] text-slate-500">{ch.deliveryTitle || ch.deliveryDate}</div>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {STATUS_LABELS[ch.status] || ch.status}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {(ch.items || []).length} item(s) · {(ch.items || []).reduce((s, i) => s + i.deliverNowQty, 0)} units
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {view === "create" && (
        <div className="space-y-3 border border-slate-200 rounded-xl p-4 bg-white">
          <h4 className="text-xs font-bold uppercase text-slate-500">Select items for this delivery</h4>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left p-1" />
                <th className="text-left p-1">Item</th>
                <th className="text-right p-1">Invoice Qty</th>
                <th className="text-right p-1">Prev. Delivered</th>
                <th className="text-right p-1">Deliver Now</th>
                <th className="text-left p-1">Serial #</th>
              </tr>
            </thead>
            <tbody>
              {createLines.map((line, idx) => (
                <tr key={line.invoiceItemId} className="border-t border-slate-100">
                  <td className="p-1">
                    <input
                      type="checkbox"
                      checked={line.selected}
                      disabled={line.previouslyDelivered >= line.invoiceQty}
                      onChange={(e) =>
                        setCreateLines((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, selected: e.target.checked } : r))
                        )
                      }
                    />
                  </td>
                  <td className="p-1 font-medium">{line.itemName}</td>
                  <td className="p-1 text-right">{line.invoiceQty}</td>
                  <td className="p-1 text-right">{line.previouslyDelivered}</td>
                  <td className="p-1">
                    <input
                      type="number"
                      className="w-16 border rounded px-1 py-0.5 text-right"
                      value={line.deliverNow}
                      max={line.invoiceQty - line.previouslyDelivered}
                      onChange={(e) =>
                        setCreateLines((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, deliverNow: e.target.value } : r))
                        )
                      }
                    />
                  </td>
                  <td className="p-1">
                    <input
                      className="w-full border rounded px-1 py-0.5"
                      value={line.serialNumber}
                      onChange={(e) =>
                        setCreateLines((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, serialNumber: e.target.value } : r))
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2 justify-end">
            <button type="button" className="text-xs font-bold text-slate-600" onClick={() => setView("list")}>
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleCreate}
              className="bg-violet-600 text-white text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin inline" /> : "Create Challan"}
            </button>
          </div>
        </div>
      )}

      {view === "detail" && activeChallan && (
        <div className="space-y-4 border border-slate-200 rounded-xl p-4 bg-white">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <div className="font-bold text-slate-900">{activeChallan.challanNumber}</div>
              <div className="text-[10px] text-slate-500">{STATUS_LABELS[activeChallan.status]}</div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs font-bold text-violet-700 flex items-center gap-1"
                onClick={() => window.open(deliveryCertificateUrl(activeChallan.id, staffUser), "_blank")}
              >
                <Download className="h-3.5 w-3.5" /> Certificate
              </button>
              <button type="button" className="text-xs text-slate-500" onClick={() => setView("list")}>
                Back to list
              </button>
            </div>
          </div>

          <table className="w-full text-[11px] border border-slate-100 rounded-lg overflow-hidden">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-2">Item</th>
                <th className="text-right p-2">Deliver</th>
                <th className="text-right p-2">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {(activeChallan.items || []).map((it) => (
                <tr key={it.id} className="border-t border-slate-100">
                  <td className="p-2">{it.itemName}</td>
                  <td className="p-2 text-right font-mono">{it.deliverNowQty}</td>
                  <td className="p-2 text-right font-mono">{it.remainingQtyAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!locked && (
            <>
              <div className="flex flex-wrap gap-2">
                {(["draft", "out_for_delivery", "delivered_pending_verification"] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      const data = await updateAdminDeliveryChallanStatus(staffUser, activeChallan.id, st);
                      setActiveChallan(data.challan);
                    }}
                    className={`text-[10px] font-bold px-2 py-1 rounded border ${
                      activeChallan.status === st ? "bg-violet-100 border-violet-400" : "border-slate-200"
                    }`}
                  >
                    {STATUS_LABELS[st]}
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                <input className="border rounded px-2 py-1.5" placeholder="Receiver name" value={receiver.name} onChange={(e) => setReceiver((r) => ({ ...r, name: e.target.value }))} />
                <input className="border rounded px-2 py-1.5" placeholder="Receiver phone" value={receiver.phone} onChange={(e) => setReceiver((r) => ({ ...r, phone: e.target.value }))} />
                <input className="border rounded px-2 py-1.5" placeholder="CNIC (optional)" value={receiver.cnic} onChange={(e) => setReceiver((r) => ({ ...r, cnic: e.target.value }))} />
                <select className="border rounded px-2 py-1.5" value={receiver.relation} onChange={(e) => setReceiver((r) => ({ ...r, relation: e.target.value }))}>
                  {RECEIVER_RELATIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-bold uppercase text-slate-500">OTP Verification</div>
                <button type="button" onClick={handleSendOtp} disabled={saving} className="inline-flex items-center gap-1 text-xs font-bold text-violet-700">
                  <Send className="h-3.5 w-3.5" /> Generate OTP
                </button>
                {otpDisplay && (
                  <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 font-mono">
                    OTP: <strong>{otpDisplay}</strong>
                    <div className="text-[10px] text-slate-600 mt-1 whitespace-pre-wrap">
                      {buildOtpWhatsAppText({ ...activeChallan, otpCode: otpDisplay }, customerName || "")}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <input className="border rounded px-2 py-1 text-xs flex-1" placeholder="Enter OTP" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} />
                  <button type="button" onClick={handleVerifyOtp} disabled={saving} className="text-xs font-bold bg-slate-800 text-white px-3 rounded">Verify</button>
                </div>
                {activeChallan.otpVerifiedAt && (
                  <div className="text-[10px] text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> OTP verified</div>
                )}
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">Digital Signature</div>
                {!activeChallan.signatureImageUrl ? (
                  <SignaturePad onSave={handleSignature} />
                ) : (
                  <img src={activeChallan.signatureImageUrl} alt="Signature" className="max-h-24 border rounded" />
                )}
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">Photos</div>
                <div className="flex flex-wrap gap-2">
                  {["material", "serial", "vehicle", "site", "receiver"].map((t) => (
                    <label key={t} className="text-[10px] font-bold border border-slate-200 rounded px-2 py-1 cursor-pointer hover:bg-slate-50">
                      <Camera className="h-3 w-3 inline mr-1" />{t}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhoto(e, t)} />
                    </label>
                  ))}
                </div>
                {(activeChallan.photos || []).length > 0 && (
                  <div className="text-[10px] text-slate-500 mt-1">{activeChallan.photos!.length} photo(s) uploaded</div>
                )}
              </div>

              <button type="button" onClick={captureGps} className="inline-flex items-center gap-1 text-xs font-bold text-slate-700">
                <MapPin className="h-3.5 w-3.5" /> Capture GPS
              </button>
              {activeChallan.gpsLat != null && (
                <div className="text-[10px] text-slate-500">{activeChallan.gpsAddress || `${activeChallan.gpsLat}, ${activeChallan.gpsLng}`}</div>
              )}

              <div className="space-y-1 text-xs">
                <label className="flex items-center gap-2"><input type="checkbox" checked={checklist.receivedMaterial} onChange={(e) => setChecklist((c) => ({ ...c, receivedMaterial: e.target.checked }))} /> I received listed material</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={checklist.quantityCorrect} onChange={(e) => setChecklist((c) => ({ ...c, quantityCorrect: e.target.checked }))} /> Quantity is correct</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={checklist.conditionAcceptable} onChange={(e) => setChecklist((c) => ({ ...c, conditionAcceptable: e.target.checked }))} /> Material condition is acceptable</label>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={handleVerifyDelivery}
                className="w-full bg-emerald-600 text-white text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" /> Verify Delivery Received
              </button>
            </>
          )}

          {locked && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              This challan is locked ({STATUS_LABELS[activeChallan.status]}).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
