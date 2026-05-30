import React, { useState, useEffect } from "react";
import { 
  Sun, DollarSign, Calendar, FileText, UploadCloud, 
  CheckCircle, ArrowRight, Activity, HelpCircle, Send, Inbox, Loader2, Download,
  ShoppingBag, Smartphone, ShieldCheck, AlertCircle, Wrench, MapPin, Mic, Play,
  PlusCircle, Undo2, User, Image, Video, Bell, CreditCard, ChevronRight, Check
} from "lucide-react";
import { Lead, Ticket, NetMeteringLog } from "../types";
import { 
  placeMultiBusinessOrder, 
  createAdvancedComplaintTicket, 
  submitWarrantyClaim, 
  markNotificationAsRead,
  currencySymbol
} from "../services/api";

interface CustomerPortalProps {
  leads: Lead[];
  tickets: Ticket[];
  netMeteringList: NetMeteringLog[];
  onAddLead: (data: any) => void;
  onAcceptQuote: (leadId: string, quoteId: string) => void;
  onCreateTicket: (ticketData: any) => void;
  onReplyTicket: (ticketId: string, text: string) => void;
  categories: any[];
  products: any[];
  orders: any[];
  warranties: any[];
  notifications: any[];
  onRefreshState: () => void;
}

export default function CustomerPortal({
  leads,
  tickets,
  netMeteringList,
  onAddLead,
  onAcceptQuote,
  onCreateTicket,
  onReplyTicket,
  categories,
  products,
  orders,
  warranties,
  notifications,
  onRefreshState
}: CustomerPortalProps) {
  // Portal Layout Toggle: "mobile" (interactive device frame mockup!) or "desktop" (standard layout)
  const [interfaceLayout, setInterfaceLayout] = useState<"desktop" | "mobile">("mobile");
  
  // Mobile app simulator nav tabs
  const [activeMobileTab, setActiveMobileTab] = useState<"home" | "shop" | "orders" | "solar" | "warranties" | "support" | "alerts">("home");

  // Filter Categories State
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  // Shop state flow
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [checkoutProduct, setCheckoutProduct] = useState<any | null>(null);
  const [checkoutAddress, setCheckoutAddress] = useState<string>("742 Evergreen Terrace, Springfield");
  const [checkoutPhone, setCheckoutPhone] = useState<string>("+1 (555) 349-2091");
  const [orderPlacing, setOrderPlacing] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);

  // Warranty claim state flow
  const [claimWarranty, setClaimWarranty] = useState<any | null>(null);
  const [claimTitle, setClaimTitle] = useState("");
  const [claimDesc, setClaimDesc] = useState("");
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);

  // Multi-media Complaint Form state
  const [voiceRecordingState, setVoiceRecordingState] = useState<"idle" | "recording" | "done">("idle");
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  const [uploadedVideos, setUploadedVideos] = useState<string[]>([]);
  const [simulatedVoiceUrl, setSimulatedVoiceUrl] = useState<string | null>(null);
  const [gpsLocation, setGpsLocation] = useState<string>("");
  const [preferredVisitTime, setPreferredVisitTime] = useState<string>("");
  const [complaintProduct, setComplaintProduct] = useState<string>("");
  const [complaintSubject, setComplaintSubject] = useState("");
  const [complaintDesc, setComplaintDesc] = useState("");
  const [complaintPriority, setComplaintPriority] = useState<"Low" | "Medium" | "High">("Medium");
  const [submittingComplaint, setSubmittingComplaint] = useState(false);
  const [complaintSuccess, setComplaintSuccess] = useState<string | null>(null);

  // Active Ticket chat details states
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [ticketReplyText, setTicketReplyText] = useState("");

  // Calculators legacy state (retained)
  const [monthlyBill, setMonthlyBill] = useState<number>(220);
  const [roofSpace, setRoofSpace] = useState<number>(900);
  const [shading, setShading] = useState<'None' | 'Low' | 'Medium' | 'High'>('Low');
  const [leadCreated, setLeadCreated] = useState(false);
  const [onboardName, setOnboardName] = useState("John Miller");
  const [onboardEmail, setOnboardEmail] = useState("john.miller@gmail.com");
  const [onboardPhone, setOnboardPhone] = useState("+1 (555) 349-2091");
  const [onboardAddress, setOnboardAddress] = useState("742 Evergreen Terrace, Springfield");
  const [surveyDate, setSurveyDate] = useState("");
  const [surveyBooked, setSurveyBooked] = useState(false);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [billUploading, setBillUploading] = useState(false);
  const [billAnalyzed, setBillAnalyzed] = useState(false);
  const [roofFile, setRoofFile] = useState<File | null>(null);
  const [roofUploading, setRoofUploading] = useState(false);

  const handleBillSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setBillFile(file);
      setBillUploading(true);
      setTimeout(() => {
        setBillUploading(false);
        setBillAnalyzed(true);
      }, 1500);
    }
  };

  const handleBillDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setBillFile(file);
      setBillUploading(true);
      setTimeout(() => {
        setBillUploading(false);
        setBillAnalyzed(true);
      }, 1500);
    }
  };

  // Sunchaser Solar math equations
  const calculatedSystemSize = Math.min((roofSpace / 100) * 0.9, (monthlyBill / 28)).toFixed(1);
  const systemSizetable = Number(calculatedSystemSize) < 3 ? 4 : Number(calculatedSystemSize);
  const panelCount = Math.round((systemSizetable * 1000) / 400);
  const upfrontCostEstimate = systemSizetable * 2420;
  const standardFederalITC = upfrontCostEstimate * 0.3;
  const netSunchaserInvestment = upfrontCostEstimate - standardFederalITC;
  
  let shadingMultiplier = 1;
  if (shading === 'None') shadingMultiplier = 1.05;
  if (shading === 'Low') shadingMultiplier = 0.95;
  if (shading === 'Medium') shadingMultiplier = 0.8;
  if (shading === 'High') shadingMultiplier = 0.5;

  const estimatedAnnualProduction = Math.round(systemSizetable * 1550 * shadingMultiplier);
  const estimatedAnnualSavings = Math.round((estimatedAnnualProduction * 0.24));
  const paybackPeriodYears = (netSunchaserInvestment / (estimatedAnnualSavings || 1)).toFixed(1);
  const lifetimeYieldSavings = estimatedAnnualSavings * 25;

  // Sync state values with props when leads array changes
  const userLead = leads.find((l) => l.email.toLowerCase() === onboardEmail.toLowerCase());

  // Count unread alerts
  const unreadAlertsCount = notifications.filter((n) => !n.read).length;

  const handleOnboardingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onboardName || !onboardEmail) return;
    onAddLead({
      name: onboardName,
      email: onboardEmail,
      phone: onboardPhone,
      address: onboardAddress,
      monthlyBill,
      roofSpace,
      shading,
      notes: "Submitted via Sunchaser Instant Interactive Sizing Calculator."
    });
    setLeadCreated(true);
  };

  const simulateBillAnalysis = () => {
    setBillUploading(true);
    setBillAnalyzed(false);
    setTimeout(() => {
      setBillUploading(false);
      setBillAnalyzed(true);
      setMonthlyBill(285);
      setRoofSpace(1150);
    }, 2800);
  };

  const simulateRecordVoice = () => {
    if (voiceRecordingState === "idle") {
      setVoiceRecordingState("recording");
      setTimeout(() => {
        setVoiceRecordingState("done");
        setSimulatedVoiceUrl("https://sunchaser.co/assets/voice-complaint-memo.mp3");
      }, 3000);
    } else {
      setVoiceRecordingState("idle");
      setSimulatedVoiceUrl(null);
    }
  };

  const captureSimulatedMedia = (type: "photo" | "video") => {
    const rNum = Math.floor(100 + Math.random() * 900);
    if (type === "photo") {
      setUploadedPhotos(prev => [...prev, `https://images.unsplash.com/photo-1542496658-e33a6d0d50f6?w=400&q=80&rand=${rNum}`]);
    } else {
      setUploadedVideos(prev => [...prev, `https://sunchaser.co/assets/damage-proof-simulation-${rNum}.mp4`]);
    }
  };

  const autoMockGPSLocation = () => {
    setGpsLocation("Latitude: 37.7749° N, Longitude: 122.4194° W (Sunchaser Automated GPS Cache)");
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutProduct) return;
    setOrderPlacing(true);
    try {
      const orderPayload = {
        customerName: onboardName,
        email: onboardEmail,
        phone: checkoutPhone,
        address: checkoutAddress,
        orderType: checkoutProduct.category === "Solar Systems" ? "Solar Project" : "Product",
        status: "Pending",
        items: [
          {
            productId: checkoutProduct.id,
            productName: checkoutProduct.name,
            quantity: 1,
            price: checkoutProduct.price - (checkoutProduct.discount || 0)
          }
        ],
        totalCost: checkoutProduct.price - (checkoutProduct.discount || 0),
        installationRequired: checkoutProduct.installationRequired
      };
      const res = await placeMultiBusinessOrder(orderPayload);
      setOrderSuccess(`Successful Purchase! Your order ID ${res.id} has been securely cached.`);
      setCheckoutProduct(null);
      setTimeout(() => {
        onRefreshState();
        setActiveMobileTab("orders");
        setOrderSuccess(null);
      }, 2500);
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setOrderPlacing(false);
    }
  };

  const handleWarrantyClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimWarranty || !claimTitle) return;
    setClaimSubmitting(true);
    try {
      await submitWarrantyClaim(claimWarranty.id, claimTitle, claimDesc);
      setClaimSuccess(`Warranty Claim Successfully Filed for ${claimWarranty.productName}! Our team is reviewing.`);
      setClaimTitle("");
      setClaimDesc("");
      setTimeout(() => {
        setClaimWarranty(null);
        onRefreshState();
        setClaimSuccess(null);
      }, 2500);
    } catch (err: any) {
      alert("Claim submission rejected: " + err.message);
    } finally {
      setClaimSubmitting(false);
    }
  };

  const handleComplaintsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintSubject || !complaintDesc) return;
    setSubmittingComplaint(true);
    try {
      const advancedPayload = {
        customerName: onboardName,
        email: onboardEmail,
        subject: complaintSubject,
        description: complaintDesc,
        priority: complaintPriority,
        productSelection: complaintProduct || "Unspecified Hardware",
        photos: uploadedPhotos,
        videos: uploadedVideos,
        voiceNoteUrl: simulatedVoiceUrl || "",
        location: gpsLocation || onboardAddress,
        preferredVisitTime: preferredVisitTime || "June 3, 2026, 09:00 AM"
      };
      await createAdvancedComplaintTicket(advancedPayload);
      setComplaintSuccess(`Diagnostic Support Ticket registered! Maintenance department scheduled alert dispatcher.`);
      setComplaintSubject("");
      setComplaintDesc("");
      setUploadedPhotos([]);
      setUploadedVideos([]);
      setSimulatedVoiceUrl(null);
      setGpsLocation("");
      setPreferredVisitTime("");
      setTimeout(() => {
        onRefreshState();
        onRefreshState(); // extra backup
        setActiveMobileTab("support");
        setComplaintSuccess(null);
      }, 2500);
    } catch (err: any) {
      alert("Error creating complaint: " + err.message);
    } finally {
      setSubmittingComplaint(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    await markNotificationAsRead(id);
    onRefreshState();
  };

  const filteredProducts = selectedCategory === "All" 
    ? products 
    : products.filter(p => p.category === selectedCategory);

  return (
    <div id="customer-identity-workspace" className="space-y-6">
      
      {/* Dynamic View Header Line offering Workspace layouts */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-amber-500" /> Sunchaser Customer Hub & App
          </h2>
          <p className="text-slate-400 text-xs">
            Toggle between the mobile smartphone framework or standard desktop control cockpit in under 2 seconds.
          </p>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded-2xl flex">
          <button
            onClick={() => setInterfaceLayout("mobile")}
            className={`px-4 py-2 rounded-xl text-xs font-semibold font-sans transition flex items-center gap-1.5 cursor-pointer ${
              interfaceLayout === "mobile" ? "bg-amber-500 text-slate-950 font-bold" : "text-slate-400 hover:text-white"
            }`}
          >
            <Smartphone className="h-4.5 w-4.5" /> Mobile App Simulator
          </button>
          <button
            onClick={() => setInterfaceLayout("desktop")}
            className={`px-4 py-2 rounded-xl text-xs font-semibold font-sans transition flex items-center gap-1.5 cursor-pointer ${
              interfaceLayout === "desktop" ? "bg-amber-500 text-slate-950 font-bold" : "text-slate-400 hover:text-white"
            }`}
          >
            <Sun className="h-4.5 w-4.5" /> Full Desktop Grid
          </button>
        </div>
      </div>

      {/* SUCCESS BANNER GLOBAL OVERLAYS */}
      {orderSuccess && (
        <div className="bg-emerald-500 text-neutral-950 p-4 rounded-2xl text-center text-xs font-bold font-mono shadow-lg animate-pulse">
         ✓ {orderSuccess}
        </div>
      )}
      {claimSuccess && (
        <div className="bg-emerald-555 bg-emerald-500 text-neutral-950 p-4 rounded-2xl text-center text-xs font-bold font-mono shadow-lg animate-pulse">
         ✓ {claimSuccess}
        </div>
      )}
      {complaintSuccess && (
        <div className="bg-emerald-500 text-neutral-950 p-4 rounded-2xl text-center text-xs font-bold font-mono shadow-lg animate-pulse">
         ✓ {complaintSuccess}
        </div>
      )}

      {/* Checkout product modal panel */}
      {checkoutProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-start">
              <h3 className="text-base font-bold text-white">Sunchaser Seamless Checkout</h3>
              <button onClick={() => setCheckoutProduct(null)} className="text-slate-500 hover:text-slate-350 text-xs">Cancel</button>
            </div>
            
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex gap-3">
              <img src={checkoutProduct.images[0]} className="w-16 h-16 rounded-xl object-cover" referrerPolicy="no-referrer" />
              <div>
                <span className="text-xs text-slate-400 block font-semibold">{checkoutProduct.brand} {checkoutProduct.model}</span>
                <span className="text-sm font-bold text-white block">{checkoutProduct.name}</span>
                <span className="text-xs text-amber-500 font-mono font-bold">{currencySymbol}{(checkoutProduct.price - (checkoutProduct.discount || 0)).toLocaleString()}</span>
              </div>
            </div>

            <form onSubmit={handleCheckoutSubmit} className="space-y-3 font-sans text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold text-[11px]">Delivery/Installation Location</label>
                <input
                  type="text"
                  required
                  value={checkoutAddress}
                  onChange={(e) => setCheckoutAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-semibold text-[11px]">Contact Mobile Phone</label>
                <input
                  type="text"
                  required
                  value={checkoutPhone}
                  onChange={(e) => setCheckoutPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                />
              </div>

              {checkoutProduct.installationRequired && (
                <div className="bg-amber-500/10 border border-amber-500/20 py-2.5 px-3 rounded-xl flex items-start gap-2">
                  <Wrench className="h-4.5 w-4.5 text-amber-500 shrink-0 mt-0.5" />
                  <span className="text-[10px] text-amber-300">
                    * Certified Professional Installation is bundled for this product. Sunchaser surveyors will synchronize.
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={orderPlacing}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-extrabold py-3 rounded-xl transition cursor-pointer text-xs uppercase"
              >
                {orderPlacing ? "Processing Secures..." : `Confirm Secure Purchase (${currencySymbol}${(checkoutProduct.price - (checkoutProduct.discount || 0)).toLocaleString()})`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Selected product specifications modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <span className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-md font-mono">{selectedProduct.category}</span>
              <button onClick={() => setSelectedProduct(null)} className="text-slate-500 hover:text-slate-300 text-xs font-bold">Close specs</button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <img src={selectedProduct.images[0]} className="w-full sm:w-40 sm:h-40 rounded-2xl object-cover align-top" referrerPolicy="no-referrer" />
              <div className="space-y-2 flex-grow">
                <span className="text-slate-400 font-bold text-xs">{selectedProduct.brand} / {selectedProduct.model}</span>
                <h3 className="text-lg font-extrabold text-white">{selectedProduct.name}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-mono font-bold text-amber-400">{currencySymbol}{(selectedProduct.price - (selectedProduct.discount || 0)).toLocaleString()}</span>
                  {selectedProduct.discount > 0 && (
                    <span className="text-xs text-slate-500 line-through">{currencySymbol}{selectedProduct.price.toLocaleString()}</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 font-mono space-y-1">
                  <div>SKU: <strong className="text-white">{selectedProduct.sku}</strong></div>
                  <div>Warranty Guard: <strong className="text-emerald-400">{selectedProduct.warrantyPeriod}</strong></div>
                  <div>Installs: <strong className="text-white">{selectedProduct.installationRequired ? "Bundle Covered" : "None"}</strong></div>
                </div>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl space-y-2 border border-slate-800">
              <h4 className="text-xs font-bold text-amber-500 uppercase tracking-widest font-mono">Detailed Hardware Specifications</h4>
              <div className="grid grid-cols-2 gap-3 text-xs leading-relaxed font-mono">
                {Object.entries(selectedProduct.specifications || {}).map(([k, v]: any) => (
                  <div key={k} className="border-b border-slate-900 pb-1">
                    <span className="text-slate-500 text-[10px] block">{k}</span>
                    <span className="text-slate-200">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                setCheckoutProduct(selectedProduct);
                setSelectedProduct(null);
              }}
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold py-3 rounded-xl transition text-xs uppercase"
            >
              Order & Buy Now
            </button>
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* 1. LAYOUT OPTION A: PHONE FRAME APP SIMULATOR (OUR MAIN GOAL) */}
      {/* ============================================================== */}
      {interfaceLayout === "mobile" && (
        <div className="flex justify-center items-center py-4 select-none">
          {/* Virtual Bezel Smartphone frame mockup */}
          <div className="w-[385px] h-[780px] bg-slate-950 rounded-[48px] shadow-2xl border-[11px] border-slate-900 relative flex flex-col overflow-hidden ring-4 ring-slate-800/40">
            
            {/* Camera / Speaker Notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-900 rounded-b-2xl z-30 flex items-center justify-center">
              <div className="w-3 h-3 bg-slate-950 rounded-full border border-slate-850"></div>
              <div className="w-10 h-1 bg-slate-950 rounded-full ml-3"></div>
            </div>

            {/* Mobile Top Status Line */}
            <div className="h-11 bg-slate-950 px-6 pt-3 flex justify-between items-center text-[10px] font-semibold text-slate-400 font-mono z-20">
              <span>9:41 AM ☀️</span>
              <div className="flex gap-1 items-center">
                <span>5G 📶</span>
                <span>100% 🔋</span>
              </div>
            </div>

            {/* Simulated App Notifications Count badge header icon */}
            <div className="h-12 bg-slate-900 border-b border-slate-800 px-4 flex justify-between items-center shrink-0 z-20">
              <div className="flex items-center gap-1.5">
                <Sun className="h-5 w-5 text-amber-500 animate-spin" style={{ animationDuration: '12s' }} />
                <span className="text-[13px] font-extrabold text-white tracking-tight">Sunchaser Mobile</span>
              </div>

              {/* In App Notifications Alerts Drawer Icon Selector */}
              <button 
                onClick={() => setActiveMobileTab("alerts")}
                className="relative p-1.5 bg-slate-950 border border-slate-800 rounded-xl hover:bg-slate-850 text-slate-300 transition shrink-0 cursor-pointer"
              >
                <Bell className="h-4 w-4 text-amber-500" />
                {unreadAlertsCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center animate-bounce">
                    {unreadAlertsCount}
                  </span>
                )}
              </button>
            </div>

            {/* MOCK APPLICATION BODY CONTENT FRAME (RESIZABLE VERTICAL CANVAS) */}
            <div className="flex-1 bg-slate-950 text-xs overflow-y-auto overflow-x-hidden relative text-slate-300">
              
              {/* VIEW SWITCHER TABS SECTION */}
              
              {/* TAB 1: HOME PANEL */}
              {activeMobileTab === "home" && (
                <div className="p-4 space-y-4 fade-in-entry select-text">
                  
                  {/* Customer Welcome card */}
                  <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/20 rounded-2xl p-4 relative overflow-hidden">
                    <span className="text-[10px] font-semibold text-amber-400 block uppercase font-mono tracking-widest">Logged Customer Account</span>
                    <strong className="text-base text-white block mt-0.5">{onboardName}</strong>
                    <span className="text-[10px] text-slate-400 block mt-1">{onboardAddress}</span>
                    
                    <div className="mt-3 flex gap-2">
                      <button 
                        onClick={() => setActiveMobileTab("shop")}
                        className="bg-amber-500 text-slate-950 font-bold rounded-lg px-3 py-1.5 hover:bg-amber-400 text-[10px] transition cursor-pointer"
                      >
                        Buy Products
                      </button>
                      <button 
                        onClick={() => setActiveMobileTab("solar")}
                        className="bg-slate-900 text-neutral-200 border border-slate-700/60 rounded-lg px-3 py-1.5 hover:bg-slate-800 text-[10px] transition cursor-pointer"
                      >
                        Calc Solar ROI
                      </button>
                    </div>
                  </div>

                  {/* Quick status cards */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl flex flex-col justify-between">
                      <span className="text-[10px] font-semibold text-slate-400 block block">Shop Goods</span>
                      <strong className="text-sm text-amber-400 mt-1">{products.length} Products</strong>
                      <span className="text-[9px] text-slate-500 mt-1.5">10 Categories</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl flex flex-col justify-between">
                      <span className="text-[10px] font-semibold text-slate-400 block block">Your Orders</span>
                      <strong className="text-sm text-emerald-400 mt-1">{orders.filter(o => o.email.toLowerCase() === onboardEmail.toLowerCase()).length} Placed</strong>
                      <span className="text-[9px] text-slate-500 mt-1.5">Live steppers enabled</span>
                    </div>
                  </div>

                  {/* Project Tracker Status (If user is registered in quotes pipeline) */}
                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                      <span className="font-bold text-white tracking-tight flex items-center gap-1">
                        <Activity className="h-4 w-4 text-emerald-500 animate-pulse" /> Project Tracking
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono">ID: {userLead ? userLead.id : "No Lead"}</span>
                    </div>

                    {userLead ? (
                      <div className="space-y-3 font-mono text-[10px]">
                        <div className="flex justify-between">
                          <span>Site Stage Pipeline:</span>
                          <strong className="text-amber-400 uppercase">{userLead.status}</strong>
                        </div>
                        <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                          <div 
                            className="h-full bg-emerald-500" 
                            style={{ 
                              width: (userLead.status as string) === "Installed" ? "100%" : 
                                     (userLead.status as string) === "Contracted" ? "75%" : 
                                     (userLead.status as string) === "Surveyed" ? "50%" : 
                                     (userLead.status as string) === "Proposed" ? "25%" : "10%" 
                            }}
                          ></div>
                        </div>

                        {userLead.status === "New" && (
                          <div className="text-slate-400 leading-normal bg-slate-950 p-2.5 rounded-xl border border-slate-850 font-sans">
                            * System awaiting your preferred visit schedule date slot coordinates inside the **Solar tab**!
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-slate-500 text-center py-2">
                        No active solar deployment tracks initialized. Formulate your sizing below.
                      </div>
                    )}
                  </div>

                  {/* Simulated Complaint Help widget card */}
                  <div className="bg-slate-900 border border-slate-850 p-4 rounded-2xl flex items-center gap-3">
                    <HelpCircle className="h-8 w-8 text-indigo-400 shrink-0" />
                    <div className="space-y-0.5">
                      <strong className="text-white block font-sans">Need Hardware Support?</strong>
                      <p className="text-[10px] text-slate-400 font-sans">Submit multimedia complaint tickets with automated Voice Memo & location coordinates.</p>
                      <button 
                        onClick={() => setActiveMobileTab("support")} 
                        className="text-amber-500 hover:underline inline-block font-sans text-[10px]"
                      >
                        Open Complaint Screen →
                      </button>
                    </div>
                  </div>

                </div>
              )}

              {/* TAB 2: MULTI-BUSINESS SHOP CATALOGUE */}
              {activeMobileTab === "shop" && (
                <div className="p-4 space-y-4 fade-in-entry select-text">
                  
                  {/* Category Filter Pills (Solar panels, phones, appliances, chargers, batteries) */}
                  <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none shrink-0" style={{ maxWidth: '100vw' }}>
                    {["All", ...categories.map(c => c.name)].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-semibold whitespace-nowrap border cursor-pointer transition ${
                          selectedCategory === cat 
                            ? "bg-amber-500 text-slate-950 border-amber-500 font-bold" 
                            : "bg-slate-900 hover:bg-slate-850 text-slate-400 border-slate-800"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  {/* Products listings layout */}
                  <div className="grid grid-cols-1 gap-3">
                    {filteredProducts.map((p) => (
                      <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-2xl relative overflow-hidden flex flex-col">
                        
                        {/* Discount Sticker */}
                        {p.discount > 0 && (
                          <span className="absolute top-2 left-2 z-10 bg-amber-500 text-slate-950 text-[8px] font-extrabold px-1.5 py-0.5 rounded uppercase font-mono tracking-wider">
                            Save {currencySymbol}{(p.discount).toLocaleString()}
                          </span>
                        )}

                        <img src={p.images[0]} className="w-full h-36 object-cover" referrerPolicy="no-referrer" />
                        
                        <div className="p-3.5 space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="text-[9px] text-slate-400 tracking-wider font-semibold uppercase">{p.brand}</span>
                            <span className="text-[9px] text-emerald-400 font-mono font-bold bg-emerald-500/10 px-1.5 rounded">
                              {p.stock} units
                            </span>
                          </div>
                          
                          <h4 className="font-extrabold text-white leading-snug tracking-tight text-[13px]">{p.name}</h4>
                          <span className="text-[9px] text-slate-500 block">Category: {p.category}</span>
                          
                          <div className="flex justify-between items-center pt-2 border-t border-slate-850">
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-base font-bold font-mono text-amber-500">{currencySymbol}{(p.price - p.discount).toLocaleString()}</span>
                              {p.discount > 0 && (
                                <span className="text-[10px] text-slate-500 line-through">{currencySymbol}{p.price.toLocaleString()}</span>
                              )}
                            </div>

                            <div className="flex gap-1">
                              <button
                                onClick={() => setSelectedProduct(p)}
                                className="bg-slate-950 hover:bg-slate-800 border border-slate-805 text-[9px] text-neutral-300 px-2 py-1.5 rounded-lg font-bold cursor-pointer"
                              >
                                Specs
                              </button>
                              <button
                                onClick={() => setCheckoutProduct(p)}
                                className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-[9px] px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer uppercase"
                              >
                                Buy
                              </button>
                            </div>
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>

                </div>
              )}

              {/* TAB 3: USER ORDERS STEPS TRACKING */}
              {activeMobileTab === "orders" && (
                <div className="p-4 space-y-4 fade-in-entry select-text">
                  <h3 className="text-white font-extrabold text-sm border-b border-slate-800 pb-2">Your Multi-Business Orders Log</h3>

                  {orders.filter(o => o.email.toLowerCase() === onboardEmail.toLowerCase()).length > 0 ? (
                    orders.filter(o => o.email.toLowerCase() === onboardEmail.toLowerCase()).map((order) => (
                      <div key={order.id} className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl space-y-3 font-mono text-[10px]">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-white">{order.id}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold ${
                            order.status === 'Delivered' || order.status === 'Installed' 
                              ? "bg-emerald-500/25 text-emerald-300"
                              : "bg-amber-505 bg-amber-500/10 text-amber-400"
                          }`}>
                            {order.status}
                          </span>
                        </div>

                        {/* Items list */}
                        <div className="bg-slate-950 p-2.5 rounded-xl space-y-1.5 border border-slate-850">
                          {order.items.map((item: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-slate-300">
                              <span className="font-sans font-medium line-clamp-1">{item.productName} (x{item.quantity})</span>
                              <strong>{currencySymbol}{item.price.toLocaleString()}</strong>
                            </div>
                          ))}
                        </div>

                        {/* Order timeline stepper */}
                        <div className="pt-2 border-t border-slate-850 space-y-1.5">
                          <span className="text-slate-500 text-[9px] block">Live Delivery Stepper:</span>
                          <div className="grid grid-cols-4 gap-1 text-[8px] text-center uppercase tracking-tighter">
                            <span className={`p-1 rounded ${order.status !== 'Cancelled' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'bg-slate-950 text-slate-500'}`}>Placed</span>
                            <span className={`p-1 rounded ${order.status !== 'Pending' && order.status !== 'Cancelled' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'bg-slate-950 text-slate-500'}`}>Dispatched</span>
                            <span className={`p-1 rounded ${order.status === 'Delivered' || order.status === 'Installed' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'bg-slate-950 text-slate-500'}`}>Delivered</span>
                            <span className={`p-1 rounded ${order.status === 'Installed' ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'bg-slate-950 text-slate-500'}`}>Installed</span>
                          </div>
                        </div>

                        <div className="flex justify-between text-slate-400 text-[10px] pt-1 pt-2 border-t border-slate-850">
                          <span>Purchased Date: <strong>{new Date(order.createdAt).toLocaleDateString()}</strong></span>
                          <span>Total: <strong className="text-white">{currencySymbol}{order.totalCost.toLocaleString()}</strong></span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-10 bg-slate-900 border border-slate-800 rounded-2xl text-slate-500">
                      You haven't purchased any items yet. Browse Sunchaser products in the **Shop**!
                    </div>
                  )}

                </div>
              )}

              {/* TAB 4: SOLAR GENERATION SIZING & BOOKING SURVEY */}
              {activeMobileTab === "solar" && (
                <div className="p-4 space-y-4 fade-in-entry select-text">
                  
                  {/* Solar layout sliders block */}
                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3 font-sans">
                    <h3 className="text-sm font-extrabold text-white flex items-center gap-1.5">
                      <Sun className="h-4.5 w-4.5 text-amber-500 animate-pulse" /> Sunchaser Sizing Engines
                    </h3>

                    <div className="space-y-3 pt-2 text-xs">
                      <div>
                        <div className="flex justify-between text-slate-400 mb-1">
                          <span>Home Monthly Bill:</span>
                          <strong className="text-white">{currencySymbol}{monthlyBill}</strong>
                        </div>
                        <input
                          type="range"
                          min={50}
                          max={1200}
                          step={10}
                          value={monthlyBill}
                          onChange={(e) => setMonthlyBill(Number(e.target.value))}
                          className="w-full accent-amber-500 h-1 bg-slate-955 rounded"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-slate-400 mb-1">
                          <span>Roof Dimensions Space:</span>
                          <strong className="text-white">{roofSpace} sq ft</strong>
                        </div>
                        <input
                          type="range"
                          min={200}
                          max={5000}
                          step={50}
                          value={roofSpace}
                          onChange={(e) => setRoofSpace(Number(e.target.value))}
                          className="w-full accent-amber-500 h-1 bg-slate-955 rounded"
                        />
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Solar Roof Shading:</span>
                        <select
                          value={shading}
                          onChange={(e: any) => setShading(e.target.value)}
                          className="bg-slate-950 border border-slate-800 p-1.5 rounded-lg text-white font-semibold cursor-pointer"
                        >
                          <option value="None">None - Ideal South Facing</option>
                          <option value="Low">Low - Micro Shading</option>
                          <option value="Medium">Medium - Tree Overhang</option>
                          <option value="High">High - Blocked Azimuth</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Sizing calculations outputs */}
                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl relative overflow-hidden">
                    <h4 className="font-extrabold text-white text-xs mb-3 text-amber-400">Sunchaser Recommendations</h4>
                    
                    <div className="grid grid-cols-2 gap-3 font-mono text-[10px] text-slate-400">
                      <div className="bg-slate-950 border border-slate-850 p-2 rounded-xl text-center">
                        <span className="block text-slate-500 text-[9px]">Sizing System</span>
                        <strong className="text-sm text-white block mt-0.5">{systemSizetable.toFixed(1)} kW</strong>
                      </div>
                      <div className="bg-slate-950 border border-slate-850 p-2 rounded-xl text-center">
                        <span className="block text-slate-500 text-[9px]">Panel Array</span>
                        <strong className="text-sm text-white block mt-0.5">{panelCount} Units</strong>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800/80 mt-3 font-mono text-[10px] space-y-1.5 text-slate-400 leading-snug">
                      <div className="flex justify-between">
                        <span>Federal ITC Discount 30%:</span>
                        <strong className="text-emerald-400">-{currencySymbol}{standardFederalITC.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Net Sizer Cost Estimate:</span>
                        <strong className="text-white">{currencySymbol}{netSunchaserInvestment.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between text-xs pt-1 border-t border-slate-850 text-amber-400">
                        <span>Payback Period:</span>
                        <strong>{paybackPeriodYears} Years</strong>
                      </div>
                    </div>
                  </div>

                  {/* Booking Surveyor Slot form inside phone */}
                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3">
                    <h4 className="font-extrabold text-white text-xs">Choose Site Surveyor Visit</h4>
                    
                    {!surveyBooked && (!userLead || userLead.status === "New") ? (
                      <div className="space-y-2">
                        <input
                          type="datetime-local"
                          value={surveyDate}
                          onChange={(e) => setSurveyDate(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-white font-mono text-[10px]"
                        />
                        <button
                          type="button"
                          disabled={!surveyDate}
                          onClick={() => setSurveyBooked(true)}
                          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-[10px] font-extrabold py-2 rounded-xl"
                        >
                          Book Professional Visit Slot 🗓️
                        </button>
                      </div>
                    ) : (
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-850 text-[10px] leading-relaxed relative">
                        <CheckCircle className="h-4 w-4 text-emerald-500 absolute top-2 right-2 animate-bounce" />
                        <span className="text-white block font-sans font-bold mb-1">✓ App booked successfully</span>
                        <span>Date Scheduled: <strong>{surveyDate || "June 3, 2026"}</strong></span>
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* TAB 5: ACTIVE WARRANTIES LIST & TRIGGER WORKFLOW */}
              {activeMobileTab === "warranties" && (
                <div className="p-4 space-y-4 fade-in-entry select-text">
                  <h3 className="text-white font-extrabold text-sm border-b border-slate-800 pb-2">Active Guarantee Warranties</h3>

                  {warranties.filter(w => w.email.toLowerCase() === onboardEmail.toLowerCase()).length > 0 ? (
                    warranties.filter(w => w.email.toLowerCase() === onboardEmail.toLowerCase()).map((w) => (
                      <div key={w.id} className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl space-y-2.5">
                        
                        <div className="flex justify-between items-center text-[10px] font-mono leading-none">
                          <span className="text-slate-500">ID: {w.id}</span>
                          <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2.5 py-1 rounded inline-block uppercase">
                            ● {w.status}
                          </span>
                        </div>

                        <div>
                          <h4 className="text-xs font-extrabold text-white tracking-tight">{w.productName}</h4>
                          <span className="text-[10px] text-slate-400 block mt-1 font-mono">Serial: <strong>{w.serialNumber}</strong></span>
                        </div>

                        <div className="text-[9px] font-mono text-slate-500 border-t border-slate-850/50 pt-2 grid grid-cols-2 gap-2">
                          <div>Filing: <span className="text-slate-300">{new Date(w.startDate).toLocaleDateString()}</span></div>
                          <div>Expiry: <span className="text-slate-300">{new Date(w.endDate).toLocaleDateString()}</span></div>
                        </div>

                        {/* Claim history */}
                        {w.claimHistory && w.claimHistory.length > 0 && (
                          <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-2 text-[9px] font-mono">
                            <span className="text-amber-500 block uppercase font-bold text-[8px]">Claim history Decides:</span>
                            {w.claimHistory.map((cl: any) => (
                              <div key={cl.claimId} className="border-t border-slate-900 pt-1.5 first:border-0 first:pt-0">
                                <div className="flex justify-between text-neutral-200">
                                  <strong>{cl.issueTitle} ({cl.claimId})</strong>
                                  <span className="text-amber-400">{cl.status}</span>
                                </div>
                                <p className="text-slate-500 mt-1">{cl.description}</p>
                                {cl.resolutionNotes && (
                                  <p className="text-emerald-400 mt-1 italic">Notes: {cl.resolutionNotes}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Claim Button */}
                        <button
                          onClick={() => setClaimWarranty(w)}
                          className="w-full bg-slate-950 hover:bg-slate-850 border border-slate-800 text-slate-300 text-[10px] py-1.5 rounded-lg transition mt-2 font-semibold"
                        >
                          File Warranty Claim Against Device
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-10 bg-slate-900 border border-slate-800 rounded-2xl text-slate-500">
                      No warranty coverages registered yet. Your active product orders will auto-provision once marked **Delivered** by delivery drivers.
                    </div>
                  )}

                  {/* Claim submission drawer popup overlay inside app */}
                  {claimWarranty && (
                    <div className="fixed inset-0 bg-slate-950/90 z-40 p-6 flex flex-col justify-end">
                      <div className="bg-slate-900 border border-slate-800 rounded-t-3xl p-5 space-y-4 max-w-sm mx-auto w-full select-text animate-slide-up">
                        <div className="flex justify-between items-center border-b border-slate-800 pb-2.5">
                          <strong className="text-xs text-white">Warranty Claim for {claimWarranty.productName}</strong>
                          <button onClick={() => setClaimWarranty(null)} className="text-slate-400 hover:text-white text-[10px]">Close</button>
                        </div>

                        <form onSubmit={handleWarrantyClaimSubmit} className="space-y-3">
                          <div>
                            <input
                              type="text"
                              required
                              placeholder="Issue Summary / Defect Title"
                              value={claimTitle}
                              onChange={(e) => setClaimTitle(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <textarea
                              required
                              rows={3}
                              placeholder="Describe device issue behavior or performance loss..."
                              value={claimDesc}
                              onChange={(e) => setClaimDesc(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-805 rounded-xl p-3 text-[11px] text-white"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={claimSubmitting}
                            className="w-full bg-amber-505 bg-amber-500 text-slate-950 font-extrabold text-[10px] py-2.5 rounded-xl uppercase"
                          >
                            {claimSubmitting ? "Filing Secures..." : "Submit Claim for Verification"}
                          </button>
                        </form>
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* TAB 6: MULTI-MEDIA COMPLAINT FORM & CHAT TICKETS LIST */}
              {activeMobileTab === "support" && (
                <div className="p-4 space-y-4 fade-in-entry select-text">
                  <h3 className="text-white font-extrabold text-sm border-b border-slate-800 pb-2">Support & Complaints Center</h3>

                  {/* Complaint input Form */}
                  <form onSubmit={handleComplaintsSubmit} className="bg-slate-900 border border-slate-850 p-4 rounded-2xl space-y-3 text-xs leading-none">
                    <h4 className="text-[10px] font-extrabold tracking-widest uppercase text-amber-500 font-mono">File Media Complaint</h4>
                    
                    <div>
                      <input
                        type="text"
                        required
                        placeholder="What is wrong / Issue description"
                        value={complaintSubject}
                        onChange={(e) => setComplaintSubject(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-[10px] text-white"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        value={complaintPriority}
                        onChange={(e: any) => setComplaintPriority(e.target.value)}
                        className="bg-slate-955 bg-slate-950 border border-slate-800 p-2 text-white text-[10px] rounded-xl font-semibold select-dropdown cursor-pointer"
                      >
                        <option value="Low">Priority: Low</option>
                        <option value="Medium">Priority: Medium</option>
                        <option value="High">Priority: High</option>
                      </select>
                      
                      <select
                        value={complaintProduct}
                        onChange={(e) => setComplaintProduct(e.target.value)}
                        className="bg-slate-955 bg-slate-950 border border-slate-800 p-2 text-white text-[10px] rounded-xl font-semibold select-dropdown cursor-pointer"
                      >
                        <option value="">Choose Product</option>
                        {products.map(p => (
                          <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <textarea
                        required
                        rows={3}
                        placeholder="Detail the issue..."
                        value={complaintDesc}
                        onChange={(e) => setComplaintDesc(e.target.value)}
                        className="w-full bg-slate-955 bg-slate-950 border border-slate-800 p-2.5 text-white text-[10px] rounded-xl"
                      />
                    </div>

                    {/* Speech / Media Tools Row inside app */}
                    <div className="bg-slate-955 border border-slate-850 p-2 rounded-xl flex items-center justify-between text-slate-400 font-sans">
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => captureSimulatedMedia("photo")}
                          className="p-1.5 hover:bg-slate-850 rounded-lg text-slate-300 transition"
                          title="Simulate Mobile Photo Attached"
                        >
                          <Image className="h-4 w-4 text-emerald-400" />
                        </button>
                        <button
                          type="button"
                          onClick={() => captureSimulatedMedia("video")}
                          className="p-1.5 hover:bg-slate-850 rounded-lg text-slate-300 transition"
                          title="Simulate Diagnostic Video Recording"
                        >
                          <Video className="h-4 w-4 text-indigo-400" />
                        </button>
                        <button
                          type="button"
                          onClick={autoMockGPSLocation}
                          className="p-1.5 hover:bg-slate-850 rounded-lg text-slate-300 transition"
                          title="Auto Detect GPS location coordinates"
                        >
                          <MapPin className="h-4 w-4 text-amber-500" />
                        </button>
                      </div>

                      {/* MIC VOICE NOTE RECORDER SIMULATOR */}
                      <button
                        type="button"
                        onClick={simulateRecordVoice}
                        className={`px-2 py-1 rounded-lg text-[9px] font-bold flex items-center gap-1 transition ${
                          voiceRecordingState === "recording" 
                            ? "bg-red-500 text-white animate-pulse" 
                            : voiceRecordingState === "done" 
                            ? "bg-indigo-600 text-white" 
                            : "bg-slate-900 border border-slate-800 text-slate-300"
                        }`}
                      >
                        <Mic className="h-3 w-3" />
                        <span>{voiceRecordingState === "idle" ? "Rec Voice" : voiceRecordingState === "recording" ? "Recording..." : "Voice Saved ✓"}</span>
                      </button>
                    </div>

                    {/* Display mock materials uploads summary */}
                    {(uploadedPhotos.length > 0 || uploadedVideos.length > 0 || gpsLocation || simulatedVoiceUrl) && (
                      <div className="bg-slate-950 border border-slate-850 rounded-xl p-2 font-mono text-[9px] text-slate-400 space-y-1">
                        <span className="text-[8px] text-amber-500 font-bold uppercase block header-label">SIMULATED MULTIMEDIA ATTACHMENTS:</span>
                        {uploadedPhotos.length > 0 && <div>📸 Photos attached: <span className="text-white">{uploadedPhotos.length}</span></div>}
                        {uploadedVideos.length > 0 && <div>🎥 Inquiries videos: <span className="text-white">{uploadedVideos.length}</span></div>}
                        {gpsLocation && <div className="line-clamp-1">📍 Site Space GPS: <span className="text-white">{gpsLocation}</span></div>}
                        {simulatedVoiceUrl && <div className="text-indigo-400 flex items-center gap-1"><Play className="h-3 w-3 fill-indigo-400" /> Voice Complaint note attached ({simulatedVoiceUrl.slice(-15)})</div>}
                      </div>
                    )}

                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-500 block font-mono">Technician Preferred Visit Calendar Slot:</span>
                      <input
                        type="datetime-local"
                        value={preferredVisitTime}
                        onChange={(e) => setPreferredVisitTime(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-2.5 py-1.5 text-white font-mono text-[10px]"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submittingComplaint}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl text-[10px] uppercase"
                    >
                      {submittingComplaint ? "Routing Dispatch Ticket..." : "Submit Dispatch Support Ticket"}
                    </button>
                  </form>

                  {/* Active Chats tickets Log */}
                  <div className="space-y-2.5 pt-2">
                    <span className="text-[10px] font-bold tracking-wider text-slate-500 font-mono block">Complaints Inbox thread</span>

                    {tickets.length > 0 ? (
                      tickets.map((t) => (
                        <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-[10px] font-mono shadow">
                          <div 
                            onClick={() => setActiveTicketId(activeTicketId === t.id ? null : t.id)}
                            className="p-3 bg-slate-950 hover:bg-slate-900 transition flex justify-between items-center cursor-pointer"
                          >
                            <div className="space-y-0.5 max-w-[70%]">
                              <span className="font-sans font-bold text-white block line-clamp-1">{t.subject}</span>
                              <div className="text-[9px] text-slate-500">ID: {t.id} • Tech: <strong className="text-amber-400">{t.assignedTechnician || "Awaiting Route"}</strong></div>
                            </div>

                            <span className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded ${
                              t.status === "Resolved" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
                            }`}>
                              {t.status}
                            </span>
                          </div>

                          {/* Chat feed thread */}
                          {activeTicketId === t.id && (
                            <div className="p-3 bg-slate-950 border-t border-slate-850 space-y-3">
                              
                              {/* Extra Complaints fields audit */}
                              {(t.productSelection || t.location) && (
                                <div className="bg-slate-900 rounded-xl p-2 border border-slate-850 text-[9px] text-slate-400 space-y-0.5 leading-relaxed">
                                  {t.productSelection && <div>Selected Component: <span className="text-white">{t.productSelection}</span></div>}
                                  {t.location && <div className="line-clamp-1">Deployment Location: <span className="text-white">{t.location}</span></div>}
                                  {t.preferredVisitTime && <div>Technician Schedule Slot: <span className="text-white">{t.preferredVisitTime}</span></div>}
                                </div>
                              )}

                              <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                                {t.messages.map((m: any, mIdx: number) => {
                                  const isCust = m.sender === "Customer";
                                  return (
                                    <div key={mIdx} className={`flex ${isCust ? 'justify-end' : 'justify-start'}`}>
                                      <div className={`p-2 rounded-xl text-[9px] max-w-[85%] leading-relaxed ${
                                        isCust ? 'bg-indigo-950 border border-indigo-900 text-white rounded-tr-none' : 'bg-slate-900 border border-slate-800 text-slate-300 rounded-tl-none'
                                      }`}>
                                        <div className="font-bold text-[8px] text-slate-500">{m.sender}</div>
                                        <div>{m.text}</div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {t.status !== 'Resolved' && (
                                <div className="flex gap-2.5">
                                  <input
                                    type="text"
                                    required
                                    placeholder="Reply thread as customer..."
                                    value={ticketReplyText}
                                    onChange={(e) => setTicketReplyText(e.target.value)}
                                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2 text-[10px] text-white focus:outline-none"
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && ticketReplyText) {
                                        onReplyTicket(t.id, ticketReplyText);
                                        setTicketReplyText("");
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (ticketReplyText) {
                                        onReplyTicket(t.id, ticketReplyText);
                                        setTicketReplyText("");
                                      }
                                    }}
                                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3.5 py-1.5 rounded-lg"
                                  >
                                    Send
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                        </div>
                      ))
                    ) : (
                      <div className="text-center py-6 bg-slate-905 bg-slate-900 border border-slate-800 rounded-xl text-slate-500 text-[10px]">
                        Support thread has no open tickets.
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* TAB 7: IN-APP ALERTS / NOTIFICATIONS BAR */}
              {activeMobileTab === "alerts" && (
                <div className="p-4 space-y-4 fade-in-entry select-text">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                    <h3 className="text-white font-extrabold text-sm">In-App Customer Alerts</h3>
                    {unreadAlertsCount > 0 && (
                      <span className="bg-amber-500/10 text-amber-400 text-[9px] font-bold py-0.5 px-2 rounded-full font-mono">
                        {unreadAlertsCount} Unread
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {notifications.length > 0 ? (
                      notifications.map((n) => (
                        <div 
                          key={n.id} 
                          className={`p-3.5 rounded-2xl border text-[10px] font-mono flex flex-col justify-between gap-2.5 transition relative overflow-hidden ${
                            n.read 
                              ? "bg-slate-950 border-slate-900 text-slate-500" 
                              : "bg-slate-900 border-slate-800 text-slate-200"
                          }`}
                        >
                          {!n.read && (
                            <span className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                          )}

                          <div className="space-y-0.5 pr-4">
                            <span className="text-[8px] text-slate-500 block uppercase">{new Date(n.createdAt).toLocaleString()}</span>
                            <p className="font-sans text-[11px] leading-relaxed text-slate-300">{n.message}</p>
                          </div>

                          {!n.read && (
                            <button
                              type="button"
                              onClick={() => handleMarkRead(n.id)}
                              className="text-[9px] text-amber-500 hover:underline text-left align-bottom font-sans mt-1.5 font-bold cursor-pointer"
                            >
                              Dismiss Clean Alert ✓
                            </button>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-10 bg-slate-900 border border-slate-800 rounded-2xl text-slate-500">
                        No app notifications registered yet.
                      </div>
                    )}
                  </div>

                </div>
              )}

            </div>

            {/* Simulated bottom tab bar (Home, Shop, Order, Sizing, Warranty, Complaint) */}
            <div className="h-16 bg-slate-900 border-t border-slate-800 grid grid-cols-5 gap-0.5 py-1 z-20 font-sans select-none shrink-0">
              <button 
                type="button"
                onClick={() => setActiveMobileTab("home")}
                className={`flex flex-col items-center justify-center text-[9px] font-semibold cursor-pointer ${
                  activeMobileTab === 'home' ? 'text-amber-500' : 'text-slate-400'
                }`}
              >
                <Smartphone className="h-4.5 w-4.5 mb-1 text-[11px]" />
                <span>Home</span>
              </button>
              <button 
                type="button"
                onClick={() => setActiveMobileTab("shop")}
                className={`flex flex-col items-center justify-center text-[9px] font-semibold cursor-pointer ${
                  activeMobileTab === 'shop' ? 'text-amber-500' : 'text-slate-400'
                }`}
              >
                <ShoppingBag className="h-4.5 w-4.5 mb-1" />
                <span>Shop</span>
              </button>
              <button 
                type="button"
                onClick={() => setActiveMobileTab("orders")}
                className={`flex flex-col items-center justify-center text-[9px] font-semibold cursor-pointer ${
                  activeMobileTab === 'orders' ? 'text-amber-500' : 'text-slate-400'
                }`}
              >
                <CreditCard className="h-4.5 w-4.5 mb-1" />
                <span>Orders</span>
              </button>
              <button 
                type="button"
                onClick={() => setActiveMobileTab("solar")}
                className={`flex flex-col items-center justify-center text-[9px] font-semibold cursor-pointer ${
                  activeMobileTab === 'solar' ? 'text-amber-500' : 'text-slate-400'
                }`}
              >
                <Sun className="h-4.5 w-4.5 mb-1" />
                <span>Solar</span>
              </button>
              <button 
                type="button"
                onClick={() => setActiveMobileTab("warranties")}
                className={`flex flex-col items-center justify-center text-[9px] font-semibold cursor-pointer ${
                  activeMobileTab === 'warranties' ? 'text-amber-500' : 'text-slate-400'
                }`}
              >
                <ShieldCheck className="h-4.5 w-4.5 mb-1" />
                <span>Warranty</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* 2. LAYOUT OPTION B: FULL COCKPIT SCREEN CANVAS (RETAINED) */}
      {/* ========================================================== */}
      {interfaceLayout === "desktop" && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 fade-in-entry select-text">
          
          {/* Sizing Engine Calculators (Left Column) */}
          <div className="md:col-span-4 bg-neutral-900 rounded-3xl border border-neutral-800 p-6 md:p-8 space-y-6">
            <div className="space-y-1">
              <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-3 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider">
                Interactive Engineering Matrix
              </span>
              <h3 className="text-xl font-bold font-sans text-neutral-100">Solar Engineering Sizer</h3>
              <p className="text-neutral-400 text-xs">Simulate roof arrays offset, federal clean energy incentives, and payback equations instantly.</p>
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-800 text-xs">
              
              {/* Sizing Sliders */}
              <div className="space-y-3.5">
                <div>
                  <div className="flex justify-between text-neutral-300 font-mono text-[11px] mb-1">
                    <span>Average Monthly Electric Bill</span>
                    <strong className="text-white">{currencySymbol}{monthlyBill}</strong>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={1200}
                    step={10}
                    value={monthlyBill}
                    onChange={(e) => setMonthlyBill(Number(e.target.value))}
                    className="w-full h-1 bg-neutral-950 accent-amber-500 rounded-lg cursor-pointer transition"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-neutral-300 font-mono text-[11px] mb-1">
                    <span>Available Structural Roof Area</span>
                    <strong className="text-white">{roofSpace} <span className="text-neutral-500 text-[10px]">sq ft</span></strong>
                  </div>
                  <input
                    type="range"
                    min={200}
                    max={5000}
                    step={50}
                    value={roofSpace}
                    onChange={(e) => setRoofSpace(Number(e.target.value))}
                    className="w-full h-1 bg-neutral-950 accent-amber-500 rounded-lg cursor-pointer transition"
                  />
                </div>

                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-neutral-400">Total Structural Shade Rating</span>
                  <select
                    value={shading}
                    onChange={(e: any) => setShading(e.target.value)}
                    className="bg-neutral-950 border border-neutral-800 p-1.5 rounded-xl text-white font-semibold cursor-pointer focus:border-amber-500"
                  >
                    <option value="None">None - Ideal South Orientation</option>
                    <option value="Low">Low - Micro Shading Obstructions</option>
                    <option value="Medium">Medium - Regular Cover Trees</option>
                    <option value="High">High - Heavily Blocked Sightlines</option>
                  </select>
                </div>
              </div>

              {/* Upload bills simulation */}
              <div className="pt-4 border-t border-slate-800/80 space-y-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono block">Simulate Dynamic Bill AI Upload</span>
                
                <div 
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleBillDrop}
                  className="border border-dashed border-neutral-800 rounded-2xl p-4 text-center cursor-pointer hover:border-amber-500 transition relative bg-neutral-950/40"
                >
                  <input
                    type="file"
                    id="bill-file-upload-input"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleBillSelect}
                    className="hidden"
                  />
                  <label htmlFor="bill-file-upload-input" className="cursor-pointer space-y-1.5 block">
                    <UploadCloud className="h-6 w-6 text-amber-500 mx-auto" />
                    <span className="text-[11px] text-neutral-300 block font-sans">
                      {billFile ? billFile.name : "Drag electric bill document or tap to search"}
                    </span>
                    <span className="text-[9px] text-neutral-500 block">PDF, PNG, JPG (Max 10MB)</span>
                  </label>
                </div>

                {billUploading && (
                  <div className="flex items-center gap-2 text-amber-400 font-mono text-[10px] bg-neutral-950 p-2 rounded-xl">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span>Analyzing electric load profiles...</span>
                  </div>
                )}

                {billAnalyzed && (
                  <div className="flex items-start gap-2 text-emerald-400 font-mono text-[10px] bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl">
                    <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <strong>Bill analyzed! Parameters synced:</strong>
                      <span className="block mt-0.5 text-neutral-300">New Bill rate: {currencySymbol}285, Max space: 1150 sq ft</span>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Sizing Results Cockpit (Right Column) */}
          <div className="md:col-span-8 space-y-6">
            <div className="bg-neutral-900 rounded-3xl border border-neutral-800 p-6 md:p-8 shadow-sm">
              <h3 className="text-lg font-bold text-white mb-2">Solar Projections Grid</h3>
              <p className="text-slate-400 text-xs mb-6 font-sans">Premium Sunchaser solar solution estimates based on core structural sizing equations.</p>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 text-center font-mono">
                <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-2xl">
                  <span className="text-slate-500 text-[9px] block">Recommended Size</span>
                  <span className="text-lg font-bold text-white block mt-1">{systemSizetable.toFixed(1)} kW</span>
                </div>
                <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-2xl">
                  <span className="text-slate-500 text-[9px] block">Panel Arrays</span>
                  <span className="text-lg font-bold text-amber-400 block mt-1">{panelCount} Units</span>
                </div>
                <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-2xl">
                  <span className="text-slate-500 text-[9px] block">Annual Clean Utility Savings</span>
                  <span className="text-lg font-bold text-emerald-400 block mt-1">+{currencySymbol}{estimatedAnnualSavings.toLocaleString()}</span>
                </div>
                <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-2xl">
                  <span className="text-slate-500 text-[9px] block">Net Payback years</span>
                  <span className="text-lg font-bold text-white block mt-1">{paybackPeriodYears} Years</span>
                </div>
              </div>

              {!leadCreated && !userLead ? (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6">
                  <h4 className="text-amber-400 text-xs font-bold uppercase mb-2">Claim Your Solar Clean Energy Projections</h4>
                  <form onSubmit={handleOnboardingSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs leading-none">
                    <input
                      type="text"
                      required
                      placeholder="Full Name"
                      value={onboardName}
                      onChange={(e) => setOnboardName(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white sm:col-span-1"
                    />
                    <input
                      type="email"
                      required
                      placeholder="Email Address"
                      value={onboardEmail}
                      onChange={(e) => setOnboardEmail(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white sm:col-span-1"
                    />
                    <input
                      type="text"
                      placeholder="Address"
                      value={onboardAddress}
                      onChange={(e) => setOnboardAddress(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white sm:col-span-1"
                    />
                    <button
                      type="submit"
                      className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded-xl transition cursor-pointer text-xs uppercase"
                    >
                      Save Prospect Leads
                    </button>
                  </form>
                </div>
              ) : (
                <div className="bg-emerald-500/10 border border-emerald-500/20 py-3.5 px-4 rounded-xl text-center text-xs text-emerald-300 font-semibold font-mono">
                  ✓ Sunchaser Projections Locked. Net Investment Model ID is active. Explore mobile view tab sections for products checkout, complaints tickets, in app alerts, and digital warranties claims.
                </div>
              )}
            </div>

            {/* Invoices block / Billing milestone panel */}
            <div className="bg-neutral-900 rounded-3xl border border-neutral-800 p-6 md:p-8 space-y-4">
              <h3 className="text-base font-bold text-white">Sunchaser Financial Milestone Invoices</h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {userLead && userLead.quotes && userLead.quotes.length > 0 ? (
                  userLead.quotes.map((quote) => {
                    const invoices = [
                      { num: "INV-9031", phase: "Milestone 1: 10% Downpayment Deposit", amt: quote.netCost * 0.1, status: quote.status === "Accepted" || userLead.status === "Contracted" || userLead.status === "Installed" ? "Paid" : "Unpaid" },
                      { num: "INV-9032", phase: "Milestone 2: 40% Site Permit Release", amt: quote.netCost * 0.4, status: userLead.status === "Installed" ? "Paid" : "Unpaid" },
                      { num: "INV-9033", phase: "Milestone 3: 50% Grid Connection Release", amt: quote.netCost * 0.5, status: userLead.status === "Installed" ? "Paid" : "Unpaid" }
                    ];
                    return invoices.map((inv) => (
                      <div key={inv.num} className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-4">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <span className="text-[10px] font-mono text-neutral-400">{inv.num}</span>
                            <strong className="text-xs text-neutral-200 block leading-snug">{inv.phase}</strong>
                          </div>
                          <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${
                            inv.status === "Paid" ? "bg-emerald-500/20 text-emerald-300 font-bold" : "bg-neutral-800 text-neutral-400"
                          }`}>
                            {inv.status}
                          </span>
                        </div>
                        <div className="flex justify-between items-end border-t border-slate-850 pt-3 text-[11px] font-mono">
                          <span>Total Net: <strong>{currencySymbol}{Math.round(inv.amt).toLocaleString()}</strong></span>
                        </div>
                      </div>
                    ));
                  })
                ) : (
                  <div className="col-span-3 text-slate-500 text-center py-6">
                    Calculate sizing and lock lead profiles to formulate quotation invoices.
                  </div>
                )}
              </div>
            </div>

            {/* Net Metering grid */}
            <div className="bg-neutral-900 rounded-3xl border border-neutral-800 p-6 md:p-8 space-y-4">
              <h3 className="text-base font-bold text-white flex items-center gap-1.5"><Activity className="h-4.5 w-4.5 text-emerald-500 animate-pulse" /> Sunchaser Net Metering Tracker</h3>
              
              <div className="space-y-3 pt-2">
                {netMeteringList.map((log) => (
                  <div key={log.month} className="grid grid-cols-12 gap-3 items-center text-xs font-mono text-slate-400">
                    <span className="col-span-2 text-xs font-bold text-neutral-400 font-mono">{log.month}</span>
                    <div className="col-span-12 md:col-span-10 space-y-1">
                      <div className="h-3 bg-indigo-950/80 rounded-lg overflow-hidden relative">
                        <div className="h-full bg-indigo-600" style={{ width: `${Math.min(100, (log.consumption / 1400) * 100)}%` }}></div>
                        <span className="absolute right-2 top-0 text-[9px] font-bold text-indigo-400">Grid: {log.consumption} kWh</span>
                      </div>
                      <div className="h-3 bg-amber-500/10 rounded-lg overflow-hidden relative">
                        <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, (log.generation / 1400) * 100)}%` }}></div>
                        <span className="absolute right-2 top-0 text-[9px] font-bold text-amber-400">Solar Export: {log.generation} kWh</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
