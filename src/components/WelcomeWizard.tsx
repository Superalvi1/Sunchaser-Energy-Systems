import React, { useState } from "react";
import { Sun, ChevronRight, ChevronLeft, Shield, BookOpen } from "lucide-react";

type WizardVariant = "customer" | "staff" | "technical";

interface WelcomeWizardProps {
  variant: WizardVariant;
  roleLabel?: string;
  onComplete: () => void | Promise<void>;
  onSkip?: () => void;
}

const CUSTOMER_STEPS = [
  {
    title: "Welcome to Sunchaser Customer Portal",
    body: "Your home for solar savings, system health, and after-sales support — all in one place.",
  },
  {
    title: "Your Solar Dashboard",
    body: "Track estimated savings, live system status, and warranty coverage from your home screen.",
  },
  {
    title: "Documents & Warranty",
    body: "Download invoices, view warranty cards, and keep equipment records handy for service visits.",
  },
  {
    title: "Support & Service",
    body: "Open support tickets, submit warranty claims, and book cleaning or inspection visits.",
  },
  {
    title: "Energy Monitor & Care Plans",
    body: "Monitor inverter production and subscribe to maintenance packages with visit credits.",
  },
];

const STAFF_STEPS = [
  {
    title: "Welcome to Sunchaser CRM",
    body: "Secure workspace for sales, operations, and customer success teams.",
  },
  {
    title: "Your role dashboard",
    body: "Your tabs and tools are tailored to your role — managers see pipelines, advisors see sizing tools.",
  },
  {
    title: "How to manage jobs & customers",
    body: "Update leads, schedule surveys, and keep project stages accurate for the whole team.",
  },
  {
    title: "How to update tickets & service logs",
    body: "Assign technicians, log visits, and attach photos so customers see progress in their portal.",
  },
  {
    title: "Data safety reminder",
    body: "Only upload real customer and project data. Never share login credentials outside Sunchaser.",
  },
];

const TECH_STEPS = [
  {
    title: "Welcome to Sunchaser Field Portal",
    body: "Simple job list for surveys, installations, and service visits — built for mobile use on site.",
  },
  {
    title: "Today's jobs",
    body: "See assigned visits, priority, and site address. Tap a job to open full details.",
  },
  {
    title: "Update status on site",
    body: "Mark En Route, Started, and Completed. Add notes and photo URLs as you work.",
  },
  {
    title: "Safety checklist",
    body: "Confirm breakers, earthing, inverter checks, and DB photos before completing a job.",
  },
  {
    title: "Stay connected",
    body: "Internet is required to sync updates. If the API fails, retry when you have signal.",
  },
];

export default function WelcomeWizard({
  variant,
  roleLabel,
  onComplete,
  onSkip,
}: WelcomeWizardProps) {
  const steps =
    variant === "customer" ? CUSTOMER_STEPS : variant === "technical" ? TECH_STEPS : STAFF_STEPS;
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const isLast = index >= steps.length - 1;
  const step = steps[index];

  const finish = async () => {
    setBusy(true);
    try {
      await onComplete();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="px-4 py-6 border-b border-slate-800">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="bg-gradient-to-tr from-amber-400 to-orange-500 p-2 rounded-xl">
            <Sun className="h-6 w-6 text-slate-950" />
          </div>
          <div>
            <p className="text-[10px] font-mono text-amber-400 uppercase tracking-widest">Welcome guide</p>
            <h1 className="text-lg font-bold">Sunchaser Energy</h1>
            {roleLabel && <p className="text-xs text-slate-400">{roleLabel}</p>}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center px-4 py-8 max-w-lg mx-auto w-full">
        <div className="flex gap-1.5 mb-8 justify-center">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-8 bg-amber-500" : "w-3 bg-slate-700"}`}
            />
          ))}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center gap-2 text-amber-400">
            {variant === "customer" ? <BookOpen className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
            <span className="text-[10px] font-mono uppercase">
              Step {index + 1} of {steps.length}
            </span>
          </div>
          <h2 className="text-xl font-extrabold leading-snug">{step.title}</h2>
          <p className="text-sm text-slate-300 leading-relaxed">{step.body}</p>
        </div>

        <div className="flex flex-col gap-3 mt-8">
          {isLast ? (
            <button
              type="button"
              disabled={busy}
              onClick={finish}
              className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-base disabled:opacity-50"
            >
              {variant === "customer" ? "Go to Dashboard" : "Start working"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIndex((i) => i + 1)}
              className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-base flex items-center justify-center gap-2"
            >
              Next <ChevronRight className="h-5 w-5" />
            </button>
          )}
          <div className="flex gap-3">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                className="flex-1 py-3 rounded-2xl border border-slate-700 text-slate-300 font-semibold flex items-center justify-center gap-1"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            )}
            {onSkip && !isLast && (
              <button
                type="button"
                onClick={onSkip}
                className="flex-1 py-3 rounded-2xl border border-slate-700 text-slate-400 text-sm"
              >
                Skip for now
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
