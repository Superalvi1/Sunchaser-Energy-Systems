import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import AppLogo from "./AppLogo";
import { RECEIVER_RELATIONS } from "../lib/deliveryManagement";
import { qrCodeImageUrl } from "../lib/deliveryQr";
import {
  capturePublicDeliverySignature,
  disputePublicDeliveryChallan,
  fetchPublicDeliveryVerification,
  publicDeliveryCertificateUrl,
  sendPublicDeliveryOtp,
  submitPublicDeliveryVerification,
  uploadPublicDeliveryPhoto,
  verifyPublicDeliveryOtp,
} from "../services/api";

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
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
  }, []);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={400}
        height={140}
        className="border border-slate-300 rounded-xl bg-white w-full touch-none"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="text-xs font-semibold text-slate-600"
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
            if (!canvas || !ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="text-xs font-semibold text-amber-700"
          onClick={() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            onSave(canvas.toDataURL("image/png"));
          }}
        >
          Save Signature
        </button>
      </div>
    </div>
  );
}

type Props = { token: string };

export default function DeliveryVerifyPage({ token }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [mode, setMode] = useState<"choose" | "received" | "dispute">("choose");
  const [receiver, setReceiver] = useState({ name: "", phone: "", relation: "owner" });
  const [otpInput, setOtpInput] = useState("");
  const [otpDev, setOtpDev] = useState<string | null>(null);
  const [checklist, setChecklist] = useState({ receivedMaterial: false, quantityCorrect: false, conditionAcceptable: false });
  const [disputeComments, setDisputeComments] = useState("");
  const [disputeItems, setDisputeItems] = useState<Record<string, "missing" | "damaged">>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchPublicDeliveryVerification(token);
      setData(payload);
    } catch (e: any) {
      setError(e.message || "Unable to load verification page.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const readFileBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handlePhoto = async (file: File, photoType: string) => {
    setSaving(true);
    setMsg(null);
    try {
      const base64Data = await readFileBase64(file);
      await uploadPublicDeliveryPhoto(token, { base64Data, photoType, fileName: file.name, mimeType: file.type });
      await load();
      setMsg("Photo uploaded.");
    } catch (e: any) {
      setMsg(e.message || "Photo upload failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleSendOtp = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await sendPublicDeliveryOtp(token);
      if (res.otp) setOtpDev(res.otp);
      setMsg("OTP sent. Check WhatsApp/SMS or ask the delivery team.");
      await load();
    } catch (e: any) {
      setMsg(e.message || "Could not send OTP.");
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyOtp = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await verifyPublicDeliveryOtp(token, { code: otpInput, verifiedByPhone: receiver.phone });
      setMsg("OTP verified.");
      await load();
    } catch (e: any) {
      setMsg(e.message || "Invalid OTP.");
    } finally {
      setSaving(false);
    }
  };

  const handleSignature = async (dataUrl: string) => {
    setSaving(true);
    try {
      await capturePublicDeliverySignature(token, dataUrl);
      setMsg("Signature saved.");
      await load();
    } catch (e: any) {
      setMsg(e.message || "Signature failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitReceived = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await submitPublicDeliveryVerification(token, {
        receiverName: receiver.name,
        receiverPhone: receiver.phone,
        receiverRelation: receiver.relation,
        receivedMaterial: checklist.receivedMaterial,
        quantityCorrect: checklist.quantityCorrect,
        conditionAcceptable: checklist.conditionAcceptable,
      });
      await load();
      setMsg("Thank you! Delivery verified successfully.");
      setMode("choose");
    } catch (e: any) {
      setMsg(e.message || "Verification failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitDispute = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const items = Object.entries(disputeItems).map(([itemId, issueType]) => {
        const line = data?.challan?.items?.find((it: any) => it.id === itemId);
        return { itemId, itemName: line?.itemName, issueType };
      });
      await disputePublicDeliveryChallan(token, { comments: disputeComments, items });
      await load();
      setMsg("Dispute submitted. Our team will contact you.");
      setMode("choose");
    } catch (e: any) {
      setMsg(e.message || "Could not submit dispute.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <AppLogo className="h-12 mx-auto" />
          <p className="text-red-400">{error || "Link not found."}</p>
        </div>
      </div>
    );
  }

  const { access, challan, invoice, verificationUrl, certificateUrl } = data;
  const qrUrl = verificationUrl ? qrCodeImageUrl(verificationUrl, 160) : "";

  if (access === "expired") {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <AppLogo className="h-12 mx-auto" />
          <h1 className="text-xl font-bold">Link Expired</h1>
          <p className="text-slate-400">This verification link has expired. Please contact Sunchaser Energy Systems for a new link.</p>
        </div>
      </div>
    );
  }

  if (access === "cancelled") {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <AppLogo className="h-12 mx-auto" />
          <h1 className="text-xl font-bold">Delivery Cancelled</h1>
          <p className="text-slate-400">This delivery challan was cancelled and cannot be verified.</p>
        </div>
      </div>
    );
  }

  if (access === "verified_readonly" || access === "disputed_readonly") {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-4 pb-12">
        <div className="max-w-lg mx-auto space-y-6">
          <div className="text-center pt-6">
            <AppLogo className="h-12 mx-auto mb-4" />
            <h1 className="text-xl font-bold">{challan.challanNumber}</h1>
            <p className="text-sm text-slate-400 mt-1">
              {access === "verified_readonly" ? "Verified Received" : "Disputed"} · {invoice.customerName}
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2 text-sm">
            {(challan.items || []).map((it: any) => (
              <div key={it.id} className="flex justify-between gap-2">
                <span>{it.itemName}</span>
                <span className="text-amber-400 font-mono">{it.deliverNowQty}</span>
              </div>
            ))}
          </div>
          {access === "verified_readonly" && certificateUrl && (
            <a
              href={publicDeliveryCertificateUrl(token)}
              target="_blank"
              rel="noreferrer"
              className="block w-full text-center bg-amber-500 text-slate-950 font-bold py-3 rounded-xl"
            >
              Download Certificate
            </a>
          )}
          {challan.disputeReason && (
            <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl p-4">{challan.disputeReason}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 pb-12">
      <div className="max-w-lg mx-auto space-y-5">
        <div className="text-center pt-4">
          <AppLogo className="h-12 mx-auto mb-3" />
          <h1 className="text-lg font-bold">Material Delivery Verification</h1>
          <p className="text-xs text-slate-400 mt-1">Sunchaser Energy Systems</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-sm space-y-2">
          <div><span className="text-slate-500">Challan</span> <strong>{challan.challanNumber}</strong></div>
          <div><span className="text-slate-500">Invoice</span> {invoice.invoiceNumber}</div>
          <div><span className="text-slate-500">Customer</span> {invoice.customerName}</div>
          <div><span className="text-slate-500">Site</span> {invoice.customerAddress}</div>
          <div><span className="text-slate-500">Date</span> {challan.deliveryDate || "—"}</div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <h2 className="text-xs font-bold uppercase text-slate-400 mb-3">Delivered Items</h2>
          <ul className="space-y-2 text-sm">
            {(challan.items || []).map((it: any) => (
              <li key={it.id} className="flex justify-between gap-2 border-b border-white/5 pb-2">
                <span>{it.itemName}{it.serialNumber ? ` · ${it.serialNumber}` : ""}</span>
                <span className="text-amber-400 font-mono shrink-0">×{it.deliverNowQty}</span>
              </li>
            ))}
          </ul>
        </div>

        {msg && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{msg}</p>}

        {mode === "choose" && (
          <div className="grid gap-3">
            <button type="button" onClick={() => setMode("received")} className="bg-emerald-600 text-white font-bold py-3 rounded-xl">
              A. Everything Received
            </button>
            <button type="button" onClick={() => setMode("dispute")} className="bg-red-600/90 text-white font-bold py-3 rounded-xl">
              B. Report Missing / Damaged Items
            </button>
          </div>
        )}

        {mode === "received" && (
          <div className="space-y-4 bg-white/5 border border-white/10 rounded-2xl p-4">
            <h2 className="font-bold text-sm">Confirm Receipt</h2>
            <div className="grid gap-2 text-sm">
              <input className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2" placeholder="Receiver name" value={receiver.name} onChange={(e) => setReceiver((r) => ({ ...r, name: e.target.value }))} />
              <input className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2" placeholder="Receiver phone" value={receiver.phone} onChange={(e) => setReceiver((r) => ({ ...r, phone: e.target.value }))} />
              <select className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2" value={receiver.relation} onChange={(e) => setReceiver((r) => ({ ...r, relation: e.target.value }))}>
                {RECEIVER_RELATIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <button type="button" disabled={saving} onClick={handleSendOtp} className="text-xs font-bold text-amber-400">Send OTP</button>
              {otpDev && <p className="text-xs font-mono bg-slate-900 p-2 rounded">Dev OTP: {otpDev}</p>}
              <div className="flex gap-2">
                <input className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="Enter OTP" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} />
                <button type="button" disabled={saving} onClick={handleVerifyOtp} className="bg-slate-700 px-3 rounded-lg text-xs font-bold">Verify</button>
              </div>
              {challan.otpVerifiedAt && <p className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> OTP verified</p>}
            </div>

            <div>
              <p className="text-xs text-slate-400 mb-2">Digital signature</p>
              {!challan.signatureImageUrl ? (
                <SignaturePad onSave={handleSignature} />
              ) : (
                <img src={challan.signatureImageUrl} alt="Signature" className="max-h-24 border border-white/10 rounded" />
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {(["material", "receiver"] as const).map((t) => (
                <label key={t} className="text-xs border border-white/10 rounded-lg px-3 py-2 cursor-pointer">
                  <Upload className="h-3 w-3 inline mr-1" />{t}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handlePhoto(e.target.files[0], t)} />
                </label>
              ))}
            </div>

            <div className="space-y-2 text-xs">
              <label className="flex gap-2"><input type="checkbox" checked={checklist.receivedMaterial} onChange={(e) => setChecklist((c) => ({ ...c, receivedMaterial: e.target.checked }))} /> I received the listed material</label>
              <label className="flex gap-2"><input type="checkbox" checked={checklist.quantityCorrect} onChange={(e) => setChecklist((c) => ({ ...c, quantityCorrect: e.target.checked }))} /> Quantity is correct</label>
              <label className="flex gap-2"><input type="checkbox" checked={checklist.conditionAcceptable} onChange={(e) => setChecklist((c) => ({ ...c, conditionAcceptable: e.target.checked }))} /> Material condition is acceptable</label>
            </div>

            <button type="button" disabled={saving} onClick={handleSubmitReceived} className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl">
              Submit Verification
            </button>
            <button type="button" className="w-full text-xs text-slate-400" onClick={() => setMode("choose")}>Back</button>
          </div>
        )}

        {mode === "dispute" && (
          <div className="space-y-4 bg-white/5 border border-white/10 rounded-2xl p-4">
            <h2 className="font-bold text-sm">Report Issue</h2>
            <div className="space-y-2 text-sm">
              {(challan.items || []).map((it: any) => (
                <label key={it.id} className="flex items-center justify-between gap-2 border-b border-white/5 pb-2">
                  <span>{it.itemName}</span>
                  <select
                    className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs"
                    value={disputeItems[it.id] || ""}
                    onChange={(e) => {
                      const v = e.target.value as "" | "missing" | "damaged";
                      setDisputeItems((prev) => {
                        const next = { ...prev };
                        if (!v) delete next[it.id];
                        else next[it.id] = v;
                        return next;
                      });
                    }}
                  >
                    <option value="">OK</option>
                    <option value="missing">Missing</option>
                    <option value="damaged">Damaged</option>
                  </select>
                </label>
              ))}
            </div>
            <textarea className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm min-h-[80px]" placeholder="Comments" value={disputeComments} onChange={(e) => setDisputeComments(e.target.value)} />
            <label className="text-xs border border-white/10 rounded-lg px-3 py-2 inline-flex cursor-pointer">
              <Upload className="h-3 w-3 mr-1" /> Upload proof photo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handlePhoto(e.target.files[0], "damaged")} />
            </label>
            <button type="button" disabled={saving} onClick={handleSubmitDispute} className="w-full bg-red-600 text-white font-bold py-3 rounded-xl">
              Submit Dispute
            </button>
            <button type="button" className="w-full text-xs text-slate-400" onClick={() => setMode("choose")}>Back</button>
          </div>
        )}

        {qrUrl && (
          <div className="text-center text-xs text-slate-500 pt-4">
            <img src={qrUrl} alt="QR" className="mx-auto mb-2 rounded-lg border border-white/10" width={120} height={120} />
            Secure verification link
          </div>
        )}
      </div>
    </div>
  );
}
