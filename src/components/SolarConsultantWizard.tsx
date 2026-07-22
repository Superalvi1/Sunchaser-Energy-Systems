import React, { useState, useEffect, useRef } from "react";
import {
  Sun,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Zap,
  Battery,
  Shield,
  CheckCircle2,
  DollarSign,
  HelpCircle,
  MessageSquare,
  X,
  Send,
  Loader2,
  MapPin,
  FileText,
  Building,
  Check,
  RotateCcw,
  Home,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { calculateSizingRecommendations, type SizingRecommendation } from "../lib/solarSizingEngine";
import { submitPublicLead } from "../services/api";

// Steps Definition
const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "intent", label: "Intent" },
  { id: "property", label: "Property" },
  { id: "bill", label: "Electricity Bill" },
  { id: "roof", label: "Roof" },
  { id: "connection", label: "Connection" },
  { id: "load-shedding", label: "Load Shedding" },
  { id: "recommendation", label: "Recommendation" },
  { id: "proposal-cta", label: "Proposal CTA" },
  { id: "crm-submit", label: "CRM Submission" },
];

export interface SolarConsultantWizardProps {
  onBackToLanding: () => void;
}

export default function SolarConsultantWizard({ onBackToLanding }: SolarConsultantWizardProps) {
  // Wizard state
  const [stepIndex, setStepIndex] = useState(0);

  // User input states
  const [intent, setIntent] = useState("");
  const [propertyType, setPropertyType] = useState("Residential");
  const [location, setLocation] = useState("");
  const [monthlyBill, setMonthlyBill] = useState<string>("");
  const [monthlyUnits, setMonthlyUnits] = useState<string>("");
  const [roofType, setRoofType] = useState("Flat Concrete");
  const [shading, setShading] = useState("Low");
  const [utilityProvider, setUtilityProvider] = useState("");
  const [connectionPhase, setConnectionPhase] = useState("Single Phase");
  const [loadSheddingHours, setLoadSheddingHours] = useState("None");

  // Custom Sizing Toggles (for Proposal CTA step)
  const [customBatteryCount, setCustomBatteryCount] = useState<number>(-1);
  const [panelTier, setPanelTier] = useState<"standard" | "premium" | "ultra">("premium");

  // Lead Submission Form States
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [notes, setNotes] = useState("");

  // System states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submittedLeadId, setSubmittedLeadId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Shared AI chatbot drawer states
  const [showAiChat, setShowAiChat] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessages, setAiMessages] = useState<Array<{ sender: "user" | "ai"; text: string }>>([
    {
      sender: "ai",
      text: "Hello! I am Sunchaser AI, your virtual solar partner. Ask me anything about your current selections, technical specifications, or energy calculations!",
    },
  ]);
  const aiScrollRef = useRef<HTMLDivElement>(null);

  // Autofill unit estimate based on location & bill
  const handleBillBlur = () => {
    const billNum = parseFloat(monthlyBill);
    if (!isNaN(billNum) && billNum > 0 && !monthlyUnits) {
      const loc = location.toLowerCase();
      const isPakistan =
        loc.includes("pakistan") ||
        loc.includes("karachi") ||
        loc.includes("lahore") ||
        loc.includes("islamabad") ||
        loc.includes("pk");
      const rate = isPakistan ? 50 : 0.25;
      setMonthlyUnits(Math.round(billNum / rate).toString());
    }
  };

  // Run Sizing calculations based on inputs
  const rawRecommendation = calculateSizingRecommendations({
    monthlyBill: parseFloat(monthlyBill) || 0,
    monthlyUnits: parseFloat(monthlyUnits) || undefined,
    location,
    loadSheddingHours,
    roofType,
    shading,
  });

  // Calculate final customized recommendation based on overrides
  const getCustomizedRecommendation = (): SizingRecommendation => {
    const rec = { ...rawRecommendation };
    if (customBatteryCount !== -1) {
      rec.batteryCount = customBatteryCount;
      rec.batteryCapacitykWh = customBatteryCount * 13.5;
      rec.inverterType =
        customBatteryCount > 0 ? "Sunchaser Smart Hybrid Inverter" : "Enphase IQ8 Smart Microinverters";
    }

    // Cost multiplier based on panel efficiency selection
    let costMultiplier = 1.0;
    if (panelTier === "standard") costMultiplier = 0.9;
    if (panelTier === "ultra") costMultiplier = 1.15;

    const baseCost = rec.systemSizekW * (rec.isPakistan ? 220000 : 2500) * costMultiplier;
    const batteryCost = rec.batteryCount * (rec.isPakistan ? 1500000 : 8000);
    rec.upfrontCost = Math.round(baseCost + batteryCost);
    rec.taxCredit = Math.round(rec.upfrontCost * 0.3);
    rec.netInvestment = rec.upfrontCost - rec.taxCredit;
    return rec;
  };

  const finalRec = getCustomizedRecommendation();

  // Reset custom overrides when load shedding/location changes
  useEffect(() => {
    setCustomBatteryCount(-1);
  }, [loadSheddingHours, location]);

  // Form Validation per step
  const validateStep = (index: number): boolean => {
    setValidationError(null);

    if (index === 1 && !intent) {
      setValidationError("Please select your primary goal.");
      return false;
    }
    if (index === 2) {
      if (!location.trim()) {
        setValidationError("Please enter your city / location.");
        return false;
      }
    }
    if (index === 3) {
      const billNum = parseFloat(monthlyBill);
      if (isNaN(billNum) || billNum <= 0) {
        setValidationError("Please enter a valid monthly bill amount greater than 0.");
        return false;
      }
    }
    if (index === 5) {
      if (!utilityProvider.trim()) {
        setValidationError("Please enter your utility provider name.");
        return false;
      }
    }
    if (index === 9) {
      if (!fullName.trim()) {
        setValidationError("Please enter your full name.");
        return false;
      }
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setValidationError("Please enter a valid email address.");
        return false;
      }
      if (!phone.trim() || !/^[+\d][\d\s().-]{6,24}$/.test(phone)) {
        setValidationError("Please enter a valid contact phone number.");
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep(stepIndex)) {
      setStepIndex((idx) => idx + 1);
    }
  };

  const handleBack = () => {
    setValidationError(null);
    if (stepIndex > 0) {
      setStepIndex((idx) => idx - 1);
    } else {
      onBackToLanding();
    }
  };

  // Keyboard navigation support for options lists
  const handleOptionKeyDown = (e: React.KeyboardEvent, selectFn: () => void) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectFn();
    }
  };

  // Submit Lead to CRM API (using secure API key)
  const handleSubmitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep(stepIndex)) return;

    setIsSubmitting(true);
    setValidationError(null);

    // Compile lead details description notes
    const systemNotes = `
[Solar Consultant System Specs]
- Primary Goal: ${intent}
- Property Type: ${propertyType}
- Roof Type: ${roofType}
- Shading: ${shading}
- Utility: ${utilityProvider}
- Connection Phase: ${connectionPhase}
- Load Shedding: ${loadSheddingHours}
- Recommended System: ${finalRec.systemSizekW} kW (${finalRec.panelsCount} panels)
- Inverter: ${finalRec.inverterType}
- Battery Setup: ${finalRec.batteryCount}x Sunchaser Core (${finalRec.batteryCapacitykWh} kWh)
- Panel Efficiency: ${panelTier.toUpperCase()}
- Calculated Payback: ${finalRec.paybackYears} years
- Additional Notes: ${notes || "None"}
    `.trim();

    try {
      const response = await submitPublicLead({
        name: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        address: streetAddress.trim() || undefined,
        city: location.trim(),
        location: location.trim(),
        monthlyBill: parseFloat(monthlyBill) || undefined,
        monthlyUnits: parseFloat(monthlyUnits) || undefined,
        notes: systemNotes,
        leadSource: "Solar Consultant Wizard",
      });

      if (response.success) {
        setSubmittedLeadId(response.leadId);
        setSubmitSuccess(true);
      }
    } catch (err: any) {
      console.error(err);
      setValidationError(err.message || "Failed to submit lead to Sunchaser. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Trigger Gemini AI Chat API
  const handleAiChatSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim() || aiLoading) return;

    const userText = aiInput.trim();
    setAiInput("");
    setAiMessages((prev) => [...prev, { sender: "user", text: userText }]);
    setAiLoading(true);

    try {
      // Pre-inject wizard context into the history request to implement shared state
      const locationContext = location ? `located in ${location}` : "unknown location";
      const billContext = monthlyBill ? `monthly bill of ${finalRec.currency}${monthlyBill}` : "unspecified electricity bill";
      const loadContext = `daily load shedding is ${loadSheddingHours} hours`;
      const systemContext = `Sized Solar System recommendation: ${finalRec.systemSizekW}kW solar array (${finalRec.panelsCount} panels), inverter: ${finalRec.inverterType}, batteries count: ${finalRec.batteryCount} Sunchaser Core batteries.`;

      const systemContextPrompt = `CONTEXT WARNING (Guest user: ${propertyType} property ${locationContext}, ${billContext}, ${loadContext}, roof type ${roofType}, shading ${shading}. Recommended solar setup is: ${systemContext}). Please refer to this context when answering the customer's query.`;

      const chatHistory = [
        { sender: "Agent", text: `${systemContextPrompt} Understood. I will answer customer questions dynamically based on these exact variables.` },
        ...aiMessages.map((msg) => ({
          sender: msg.sender === "user" ? ("Customer" as const) : ("Agent" as const),
          text: msg.text,
        })),
      ];

      // We call the existing public Gemini chat endpoint via fetch
      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          history: chatHistory,
        }),
      });

      if (!res.ok) throw new Error("AI chatbot failed to respond.");
      const data = await res.json();
      setAiMessages((prev) => [...prev, { sender: "ai", text: data.text }]);
    } catch (err) {
      console.error(err);
      setAiMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          text: "I apologize, my communication core is operating under safe limits. Sunchaser IQ8 microinverters remain fully available in local mode.",
        },
      ]);
    } finally {
      setAiLoading(false);
    }
  };

  // Scroll AI messages to bottom
  useEffect(() => {
    aiScrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages]);

  // Accessibility Focus Trap/Helper for Esc Key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showAiChat) {
        setShowAiChat(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAiChat]);

  const activeStep = STEPS[stepIndex]!;
  const percentComplete = Math.round(((stepIndex + 1) / STEPS.length) * 100);

  // Transition variants
  const variants = {
    enter: { opacity: 0, x: 15 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -15 },
  };

  return (
    <div className="relative min-h-[580px] bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col justify-between overflow-hidden">
      
      {/* Top Progress bar and Title */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-amber-500 animate-spin-slow" />
            <span className="text-[10px] font-mono tracking-wider font-extrabold uppercase text-amber-400">
              Solar Sizing Consultant
            </span>
          </div>
          <span className="text-xs font-mono font-bold text-slate-400" aria-live="polite">
            Step {stepIndex + 1} of {STEPS.length}
          </span>
        </div>
        
        {/* Progress Tracker Bar */}
        <div className="w-full bg-slate-850 h-2 rounded-full overflow-hidden mb-6 relative">
          <div
            className="bg-gradient-to-r from-amber-400 to-orange-500 h-full rounded-full transition-all duration-300"
            style={{ width: `${percentComplete}%` }}
          />
        </div>
      </div>

      {/* Screen Form Content */}
      <div className="flex-1 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeStep.id}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.18 }}
            className="space-y-4"
          >
            {validationError && (
              <div
                role="alert"
                className="bg-red-950/40 border border-red-900/50 p-4 rounded-xl text-xs text-red-300 flex items-center gap-2"
              >
                <X className="h-4 w-4 shrink-0 text-red-400" onClick={() => setValidationError(null)} />
                <span>{validationError}</span>
              </div>
            )}

            {/* SCREEN 1: WELCOME */}
            {activeStep.id === "welcome" && (
              <div className="text-center py-6 space-y-4">
                <div className="mx-auto bg-amber-500/10 border border-amber-500/25 h-16 w-16 rounded-3xl flex items-center justify-center text-amber-400">
                  <Sparkles className="h-8 w-8 animate-pulse" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">
                  Design Your Premium Clean Energy Future
                </h2>
                <p className="text-slate-300 text-sm max-w-md mx-auto leading-relaxed">
                  Calculate custom-engineered solar arrays, select stackable Sunchaser Core storage configurations, and map financial savings in under 2 minutes.
                </p>
                <div className="pt-2">
                  <span className="inline-flex items-center gap-1.5 bg-slate-950 border border-slate-800/80 px-3.5 py-1.5 rounded-full text-[10px] font-mono font-bold text-amber-400">
                    ⚡ 30% Federal ITC Tax Credit Supported
                  </span>
                </div>
              </div>
            )}

            {/* SCREEN 2: INTENT */}
            {activeStep.id === "intent" && (
              <div className="space-y-4">
                <div className="text-center md:text-left">
                  <h2 className="text-lg md:text-xl font-extrabold text-white">What is your solar goal?</h2>
                  <p className="text-xs text-slate-400 mt-1">This optimizes your hardware specs and backup system selections.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Solar Goal">
                  {[
                    { id: "Lower Bills", label: "Lower Bills & Savings", desc: "Maximize net metering solar equity" },
                    { id: "Grid Backup", label: "Outage Protection & Backup", desc: "Sunchaser Core smart battery arrays" },
                    { id: "Carbon Offset", label: "Carbon Footprint", desc: "Commit to absolute clean production" },
                    { id: "Property Value", label: "Property Value & ROI", desc: "Premium tier asset integration" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={intent === opt.id}
                      onClick={() => setIntent(opt.id)}
                      onKeyDown={(e) => handleOptionKeyDown(e, () => setIntent(opt.id))}
                      className={`text-left p-4 rounded-2xl border transition hover:bg-slate-850 cursor-pointer ${
                        intent === opt.id
                          ? "border-amber-500 bg-amber-500/5 text-white"
                          : "border-slate-800 bg-slate-950 text-slate-300"
                      }`}
                    >
                      <span className="block text-sm font-bold">{opt.label}</span>
                      <span className="block text-[10px] text-slate-500 mt-0.5">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* SCREEN 3: PROPERTY */}
            {activeStep.id === "property" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg md:text-xl font-extrabold text-white">Tell us about your property</h2>
                  <p className="text-xs text-slate-400 mt-1">Property type and geographic location dictate solar sizing rates.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-2 font-bold">Property Classification</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "Residential", label: "Home", icon: Home },
                        { id: "Commercial", label: "Business", icon: Building },
                        { id: "Industrial", label: "Industry", icon: Zap },
                      ].map((type) => {
                        const Icon = type.icon;
                        return (
                          <button
                            key={type.id}
                            type="button"
                            onClick={() => setPropertyType(type.id)}
                            className={`py-3 px-2.5 rounded-xl border flex flex-col items-center gap-1.5 text-xs transition cursor-pointer hover:bg-slate-850 ${
                              propertyType === type.id
                                ? "border-amber-500 bg-amber-500/5 text-white font-bold"
                                : "border-slate-800 bg-slate-950 text-slate-400"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            <span>{type.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="geo-location" className="text-xs font-mono text-slate-400 block mb-2 font-bold">
                      City, Region or Country
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-500" />
                      <input
                        id="geo-location"
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-650 focus-visible:outline-2 focus-visible:outline-amber-500"
                        placeholder="e.g. Karachi, Pakistan or Los Angeles, CA"
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SCREEN 4: ELECTRICITY BILL */}
            {activeStep.id === "bill" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg md:text-xl font-extrabold text-white">Your energy metrics</h2>
                  <p className="text-xs text-slate-400 mt-1">Specify average bill or consumed units to auto-configure system scale.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="bill-amount" className="text-xs font-mono text-slate-400 block mb-2 font-bold">
                      Average Monthly Bill
                    </label>
                    <input
                      id="bill-amount"
                      type="number"
                      value={monthlyBill}
                      onChange={(e) => setMonthlyBill(e.target.value)}
                      onBlur={handleBillBlur}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-amber-500"
                      placeholder="e.g. 45000 (PKR) or 250 (USD)"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="bill-units" className="text-xs font-mono text-slate-400 block mb-2 font-bold">
                      Monthly Energy Units (kWh) <span className="text-[10px] text-slate-500 font-normal">(optional)</span>
                    </label>
                    <input
                      id="bill-units"
                      type="number"
                      value={monthlyUnits}
                      onChange={(e) => setMonthlyUnits(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-amber-500"
                      placeholder="Estimate autofills on blur"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* SCREEN 5: ROOF PROFILE */}
            {activeStep.id === "roof" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg md:text-xl font-extrabold text-white">Your roof characteristics</h2>
                  <p className="text-xs text-slate-400 mt-1">Structure details dictate structure costing multipliers and solar yields.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-2 font-bold">Roofing Material Structure</label>
                    <div className="grid grid-cols-2 gap-2">
                      {["Flat Concrete", "Sloped Tin / Metal", "Tile Roof", "Ground Mount / Open Land"].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setRoofType(type)}
                          className={`py-3 px-3 rounded-xl border text-xs text-left transition cursor-pointer hover:bg-slate-850 ${
                            roofType === type
                              ? "border-amber-500 bg-amber-500/5 text-white font-bold"
                              : "border-slate-800 bg-slate-950 text-slate-400"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-2 font-bold">Shading Assessment</label>
                    <div className="grid grid-cols-4 gap-2">
                      {["None", "Low", "Medium", "Heavy"].map((shd) => (
                        <button
                          key={shd}
                          type="button"
                          onClick={() => setShading(shd)}
                          className={`py-2.5 px-1 rounded-xl border text-xs transition text-center cursor-pointer hover:bg-slate-850 ${
                            shading === shd
                              ? "border-amber-500 bg-amber-500/5 text-white font-bold"
                              : "border-slate-800 bg-slate-950 text-slate-400"
                          }`}
                        >
                          {shd}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SCREEN 6: CONNECTION */}
            {activeStep.id === "connection" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg md:text-xl font-extrabold text-white">Utility grid connections</h2>
                  <p className="text-xs text-slate-400 mt-1">Grid parameters map solar authorization and meter rules.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="utility-prov" className="text-xs font-mono text-slate-400 block mb-2 font-bold">
                      Utility Provider Name
                    </label>
                    <input
                      id="utility-prov"
                      type="text"
                      value={utilityProvider}
                      onChange={(e) => setUtilityProvider(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-amber-500"
                      placeholder="e.g. K-Electric, LESCO, PG&E, National Grid"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-2 font-bold">Electrical Connection Phase</label>
                    <div className="grid grid-cols-2 gap-2">
                      {["Single Phase", "Three Phase"].map((ph) => (
                        <button
                          key={ph}
                          type="button"
                          onClick={() => setConnectionPhase(ph)}
                          className={`py-3 px-3 rounded-xl border text-xs transition text-center cursor-pointer hover:bg-slate-850 ${
                            connectionPhase === ph
                              ? "border-amber-500 bg-amber-500/5 text-white font-bold"
                              : "border-slate-800 bg-slate-950 text-slate-400"
                          }`}
                        >
                          {ph}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SCREEN 7: LOAD SHEDDING */}
            {activeStep.id === "load-shedding" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg md:text-xl font-extrabold text-white">Outages & grid reliability</h2>
                  <p className="text-xs text-slate-400 mt-1">Outage frequency defines backup lithium battery configurations.</p>
                </div>

                <div>
                  <label className="text-xs font-mono text-slate-400 block mb-2 font-bold">Daily Load Shedding Duration</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: "None", label: "Stable Grid", desc: "No outage drops" },
                      { id: "1-2", label: "1 - 2 Hours", desc: "Mild outage gaps" },
                      { id: "3-5", label: "3 - 5 Hours", desc: "Frequent outages" },
                      { id: "6+", label: "6+ Hours / Off-grid", desc: "Severe instability" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setLoadSheddingHours(opt.id)}
                        className={`text-left p-4 rounded-xl border transition cursor-pointer hover:bg-slate-850 ${
                          loadSheddingHours === opt.id
                            ? "border-amber-500 bg-amber-500/5 text-white font-bold"
                            : "border-slate-800 bg-slate-950 text-slate-400"
                        }`}
                      >
                        <span className="block text-xs font-bold">{opt.label}</span>
                        <span className="block text-[10px] text-slate-500 mt-0.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SCREEN 8: RECOMMENDATION SCREEN */}
            {activeStep.id === "recommendation" && (
              <div className="space-y-3.5 text-xs text-slate-350">
                <div className="text-center mb-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 mb-1.5">
                    <Check className="h-4 w-4" />
                  </span>
                  <h2 className="text-lg md:text-xl font-extrabold text-white">Your custom solar sizing plan</h2>
                  <p className="text-[10px] text-slate-500">Based on your monthly energy and shading inputs.</p>
                </div>

                <div className="bg-slate-950/80 border border-slate-850 p-4 rounded-2xl space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                      <Sun className="h-4 w-4 text-amber-500" /> Recommended Array
                    </span>
                    <strong className="text-white font-mono">{finalRec.systemSizekW} kW</strong>
                  </div>
                  <div className="flex justify-between items-center text-[11px] pt-1.5 border-t border-slate-900">
                    <span className="text-slate-500">Premium Panels (400W)</span>
                    <span className="text-slate-300 font-mono">{finalRec.panelsCount} units</span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-500">Inverter Topology</span>
                    <span className="text-slate-300 truncate max-w-[200px]">{finalRec.inverterType}</span>
                  </div>
                  {finalRec.batteryCount > 0 ? (
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-500">Sunchaser Core Batteries</span>
                      <span className="text-slate-300 font-mono">
                        {finalRec.batteryCount}x ({finalRec.batteryCapacitykWh} kWh)
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="bg-slate-950/80 border border-slate-850 p-4 rounded-2xl space-y-2 font-mono">
                  <div className="flex justify-between text-slate-400">
                    <span>Gross System Cost</span>
                    <span>
                      {finalRec.currency}
                      {finalRec.upfrontCost.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-emerald-400 text-[10px]">
                    <span>30% Federal ITC Credit Deduction</span>
                    <span>
                      -{finalRec.currency}
                      {finalRec.taxCredit.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-white text-xs font-bold pt-1.5 border-t border-slate-900">
                    <span>Net Investment</span>
                    <span>
                      {finalRec.currency}
                      {finalRec.netInvestment.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-amber-400 pt-1.5 border-t border-slate-900 font-sans text-[11px]">
                    <span className="font-semibold flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-amber-500" /> Yearly Savings
                    </span>
                    <strong className="font-mono">
                      {finalRec.currency}
                      {finalRec.yearlySavings.toLocaleString()}/yr
                    </strong>
                  </div>
                  <div className="flex justify-between text-slate-300 text-[11px]">
                    <span>Amortization Payback Duration</span>
                    <span className="font-bold text-white">{finalRec.paybackYears} Years</span>
                  </div>
                </div>
              </div>
            )}

            {/* SCREEN 9: PROPOSAL CTA */}
            {activeStep.id === "proposal-cta" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-base md:text-lg font-extrabold text-white">Customize your installation profile</h2>
                  <p className="text-[10px] text-slate-400 mt-1">Adjust battery backup or panel efficiency to refine pricing math.</p>
                </div>

                <div className="space-y-4">
                  {/* Dynamic panel selection */}
                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-2 font-bold">Solar Panels Quality Tier</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "standard", label: "Standard", desc: "-10% Cost" },
                        { id: "premium", label: "Premium IQ", desc: "Base Cost" },
                        { id: "ultra", label: "Ultra High", desc: "+15% Cost" },
                      ].map((tier) => (
                        <button
                          key={tier.id}
                          type="button"
                          onClick={() => setPanelTier(tier.id as any)}
                          className={`py-2 px-1 rounded-xl border flex flex-col items-center gap-0.5 text-xs transition cursor-pointer hover:bg-slate-850 ${
                            panelTier === tier.id
                              ? "border-amber-500 bg-amber-500/5 text-white font-bold"
                              : "border-slate-800 bg-slate-950 text-slate-400"
                          }`}
                        >
                          <span className="text-[11px]">{tier.label}</span>
                          <span className="text-[9px] text-slate-500">{tier.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Battery override selector */}
                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-2 font-bold">
                      Sunchaser Core Batteries (13.5 kWh)
                    </label>
                    <div className="flex items-center gap-2">
                      {[0, 1, 2, 3].map((bCount) => {
                        const recCount = finalRec.batteryCount;
                        const active =
                          customBatteryCount === -1 ? recCount === bCount : customBatteryCount === bCount;
                        return (
                          <button
                            key={bCount}
                            type="button"
                            onClick={() => setCustomBatteryCount(bCount)}
                            className={`flex-1 py-2 rounded-xl border text-xs text-center transition cursor-pointer hover:bg-slate-850 ${
                              active
                                ? "border-amber-500 bg-amber-500/5 text-white font-bold"
                                : "border-slate-800 bg-slate-950 text-slate-400"
                            }`}
                          >
                            {bCount} {bCount === 0 ? "None" : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Live Cost Box */}
                  <div className="bg-slate-950 border border-slate-850 p-3 rounded-2xl flex justify-between items-center text-xs font-mono">
                    <span className="text-slate-500 font-sans">Estimated Net Cost:</span>
                    <strong className="text-white text-sm">
                      {finalRec.currency}
                      {finalRec.netInvestment.toLocaleString()}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* SCREEN 10: CRM SUBMISSION */}
            {activeStep.id === "crm-submit" && !submitSuccess && (
              <form onSubmit={handleSubmitLead} className="space-y-3.5">
                <div>
                  <h2 className="text-lg md:text-xl font-extrabold text-white">Secure your solar proposal</h2>
                  <p className="text-xs text-slate-400 mt-1">Submit details to dispatch our survey engineers for custom quotes.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label htmlFor="lead-name" className="text-xs font-mono text-slate-400 block mb-1.5 font-bold">Full Name *</label>
                    <input
                      id="lead-name"
                      type="text"
                      autocomplete="name"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3 text-xs text-slate-100 placeholder:text-slate-700 focus-visible:outline-2 focus-visible:outline-amber-500"
                      placeholder="Your Name"
                    />
                  </div>

                  <div>
                    <label htmlFor="lead-email" className="text-xs font-mono text-slate-400 block mb-1.5 font-bold">Email Address *</label>
                    <input
                      id="lead-email"
                      type="email"
                      autocomplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3 text-xs text-slate-100 placeholder:text-slate-700 focus-visible:outline-2 focus-visible:outline-amber-500"
                      placeholder="name@email.com"
                    />
                  </div>

                  <div>
                    <label htmlFor="lead-phone" className="text-xs font-mono text-slate-400 block mb-1.5 font-bold">Phone Number *</label>
                    <input
                      id="lead-phone"
                      type="tel"
                      autocomplete="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3 text-xs text-slate-100 placeholder:text-slate-700 focus-visible:outline-2 focus-visible:outline-amber-500"
                      placeholder="e.g. +92 300 1234567"
                    />
                  </div>

                  <div>
                    <label htmlFor="lead-address" className="text-xs font-mono text-slate-400 block mb-1.5 font-bold">Street Address</label>
                    <input
                      id="lead-address"
                      type="text"
                      autocomplete="street-address"
                      value={streetAddress}
                      onChange={(e) => setStreetAddress(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3 text-xs text-slate-100 placeholder:text-slate-700 focus-visible:outline-2 focus-visible:outline-amber-500"
                      placeholder="Property Site Address"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="lead-notes" className="text-xs font-mono text-slate-400 block mb-1.5 font-bold">Additional Notes</label>
                  <textarea
                    id="lead-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 placeholder:text-slate-700 min-h-[60px] max-h-[100px] focus-visible:outline-2 focus-visible:outline-amber-500"
                    placeholder="Specific requests, shade obstacles, special schedules..."
                  />
                </div>
              </form>
            )}

            {/* SCREEN 10 SUCCESS SCREEN */}
            {submitSuccess && (
              <div className="text-center py-8 space-y-4">
                <div className="mx-auto bg-emerald-500/10 border border-emerald-500/25 h-16 w-16 rounded-full flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="h-9 w-9 animate-bounce" />
                </div>
                <h2 className="text-2xl font-extrabold text-white">Consultation File Submitted</h2>
                <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl max-w-sm mx-auto space-y-2 font-mono text-xs">
                  <div className="text-slate-500">Lead Record Reference:</div>
                  <strong className="text-amber-500 text-sm tracking-wider select-all">{submittedLeadId}</strong>
                  <div className="text-slate-600 text-[10px] pt-1">Stored in Sunchaser database core.</div>
                </div>
                <p className="text-slate-350 text-xs max-w-md mx-auto leading-relaxed">
                  Thank you! Our engineering team will review your local shading and electrical phase configurations to generate a finalized cost blueprint. Sunchaser sales advisors will follow up shortly.
                </p>
                <div className="pt-4">
                  <button
                    type="button"
                    onClick={onBackToLanding}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs transition cursor-pointer"
                  >
                    Return to Homepage
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Buttons Bar */}
      {!submitSuccess && (
        <div className="flex justify-between items-center gap-3 pt-6 border-t border-slate-800 mt-6 select-none">
          <button
            type="button"
            onClick={handleBack}
            className="py-3 px-4 rounded-xl border border-slate-800 text-slate-400 hover:text-white transition flex items-center gap-1 cursor-pointer text-xs font-semibold"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>

          {activeStep.id === "crm-submit" ? (
            <button
              type="submit"
              disabled={isSubmitting}
              onClick={handleSubmitLead}
              className="py-3 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 hover:opacity-95 font-extrabold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/10 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Submitting Lead...
                </>
              ) : (
                <>
                  Generate CRM File <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              className="py-3 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center gap-1 cursor-pointer shadow-md shadow-amber-500/15"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Floating AI Chat Assistant Trigger Button */}
      <div className="absolute bottom-6 right-6">
        <button
          type="button"
          onClick={() => setShowAiChat(true)}
          className="bg-gradient-to-br from-amber-500 to-amber-600 text-slate-950 p-3.5 rounded-2xl shadow-xl shadow-amber-500/10 hover:scale-105 hover:shadow-amber-500/20 transition-all flex items-center gap-2 cursor-pointer border border-amber-400/25"
          title="Ask Sunchaser AI"
        >
          <MessageSquare className="h-5 w-5 animate-pulse" />
          <span className="text-xs font-bold font-mono">Ask AI</span>
        </button>
      </div>

      {/* Sliding AI chat drawer overlay */}
      <AnimatePresence>
        {showAiChat && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-[2px] z-[100] flex justify-end">
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="w-full max-w-sm h-full bg-slate-900 border-l border-slate-800 flex flex-col justify-between"
              role="dialog"
              aria-modal="true"
              aria-label="Solar AI Assistant"
            >
              {/* AI Chat Header */}
              <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/60">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-xl">
                    <Sparkles className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white tracking-tight">Solar AI Assistant</h3>
                    <p className="text-[9px] text-amber-400 font-mono uppercase mt-0.5">Shared AI State Active</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAiChat(false)}
                  className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-850 transition"
                  aria-label="Close chat"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              {/* AI Chat History */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-[11px] leading-relaxed">
                {aiMessages.map((msg, i) => {
                  const isUser = msg.sender === "user";
                  return (
                    <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2.5 ${
                          isUser
                            ? "bg-amber-500/15 text-amber-50 border border-amber-500/25 rounded-tr-sm"
                            : "bg-slate-950 text-slate-350 border border-slate-850 rounded-tl-sm"
                        }`}
                      >
                        <p className="whitespace-pre-line">{msg.text}</p>
                      </div>
                    </div>
                  );
                })}

                {aiLoading && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl border border-slate-850 bg-slate-950 px-3 py-2 text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                      Thinking…
                    </div>
                  </div>
                )}
                <div ref={aiScrollRef} />
              </div>

              {/* AI Chat Form */}
              <form onSubmit={handleAiChatSend} className="p-3 border-t border-slate-800 bg-slate-950">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    disabled={aiLoading}
                    placeholder="Ask about sizing or specs..."
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-900 py-2.5 px-3.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500/40 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={aiLoading || !aiInput.trim()}
                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition cursor-pointer"
                    aria-label="Send message"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </form>

            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
    </div>
  );
}
