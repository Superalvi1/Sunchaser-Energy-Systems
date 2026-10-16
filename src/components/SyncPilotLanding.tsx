import { ArrowRight, Building2, Check, FileText, FolderOpen, Receipt, Users } from "lucide-react";

type Props = { onSignIn: () => void };

const features = [
  { icon: Building2, title: "Your company workspace", text: "Keep your team, customers, branding and prices together in a separate company workspace." },
  { icon: FileText, title: "Quotations that look like you", text: "Prepare itemised solar quotations with your name, terms and prices, then download a PDF." },
  { icon: Receipt, title: "Invoices and payment balances", text: "Turn an agreed quotation into an invoice and see partial payments and the balance due." },
  { icon: FolderOpen, title: "Customer documents", text: "Keep the customer's supporting files beside their records and download them when needed." },
];

const steps = ["Add an enquiry", "Prepare a quotation", "Create an invoice", "Record the payment"];

export default function SyncPilotLanding({ onSignIn }: Props) {
  return (
    <div className="mx-auto max-w-6xl space-y-14 py-6 md:py-12" data-testid="sync-product-landing">
      <section className="grid items-center gap-10 lg:grid-cols-2" aria-labelledby="sync-hero">
        <div className="space-y-6">
          <p className="inline-flex rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300">Sunchaser Sync · Solar CRM pilot</p>
          <h2 id="sync-hero" className="text-4xl font-extrabold leading-tight tracking-tight text-white md:text-5xl">From solar enquiry<br />to a clear payment balance.</h2>
          <p className="max-w-lg text-base leading-7 text-slate-300">Manage customers, branded quotations, invoices and documents in one workspace built for your solar business.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={onSignIn} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 font-bold text-slate-950 transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">
              Sign in to your workspace <ArrowRight size={18} aria-hidden="true" />
            </button>
            <a href="#sync-workflow" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-600 px-6 font-semibold text-slate-200 transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">View the workflow</a>
          </div>
          <p className="text-sm leading-6 text-slate-400">Company setup and pilot plans are arranged with your operator.</p>
        </div>
        <figure className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-xl shadow-black/20">
          <figcaption className="flex items-center justify-between gap-3 border-b border-slate-700 px-6 py-5">
            <span className="font-semibold text-white">A customer record, kept together</span>
            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">Sample data</span>
          </figcaption>
          <div className="space-y-6 p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-400/10 text-amber-300"><Users size={21} aria-hidden="true" /></span>
              <div><p className="font-bold text-white">Demo Customer A</p><p className="text-sm text-slate-400">5 kW solar installation · Example only</p></div>
            </div>
            <ul className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
              {["Quotation prepared", "Invoice created", "Payment recorded", "Document attached"].map((text) => <li key={text} className="flex items-center gap-2"><Check size={16} className="shrink-0 text-emerald-400" aria-hidden="true" />{text}</li>)}
            </ul>
            <table className="w-full text-sm">
              <caption className="sr-only">Illustrative invoice amounts in Pakistani rupees</caption>
              <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th scope="col" className="pb-3 font-medium">Invoice summary</th><th scope="col" className="pb-3 text-right font-medium">PKR</th></tr></thead>
              <tbody className="divide-y divide-slate-800">
                <tr><th scope="row" className="py-3 text-left font-medium text-slate-300">Invoice total</th><td className="py-3 text-right tabular-nums text-white">350,000</td></tr>
                <tr><th scope="row" className="py-3 text-left font-medium text-slate-300">Payment recorded</th><td className="py-3 text-right tabular-nums text-emerald-300">100,000</td></tr>
                <tr><th scope="row" className="pt-4 text-left text-base font-bold text-white">Balance due</th><td className="pt-4 text-right text-xl font-bold tabular-nums text-amber-300">250,000</td></tr>
              </tbody>
            </table>
            <p className="text-xs leading-5 text-slate-500">Illustrative figures. This is not a quotation or payment request.</p>
          </div>
        </figure>
      </section>
      <section aria-labelledby="sync-features" className="space-y-5">
        <h2 id="sync-features" className="text-2xl font-bold text-white">The everyday work, in one place.</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map(({ icon: Icon, title, text }) => <article key={title} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><Icon size={22} className="mb-4 text-amber-300" aria-hidden="true" /><h3 className="mb-2 text-lg font-bold text-white">{title}</h3><p className="text-sm leading-6 text-slate-400">{text}</p></article>)}
        </div>
      </section>
      <section id="sync-workflow" aria-labelledby="sync-workflow-title" className="scroll-mt-24 rounded-3xl border border-slate-700 bg-slate-900 p-6 md:p-8">
        <h2 id="sync-workflow-title" className="text-2xl font-bold text-white">A workflow your team can follow.</h2>
        <ol className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => <li key={step} className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-amber-400/30 text-sm font-bold text-amber-300">{index + 1}</span><span className="font-medium text-slate-200">{step}</span></li>)}
        </ol>
        <p className="mt-6 max-w-3xl text-sm leading-6 text-slate-400">Start with your company details, staff and prices. Use a sample customer to practise the quotation and invoice flow before adding your client records.</p>
        <button type="button" onClick={onSignIn} className="mt-6 inline-flex min-h-11 items-center gap-2 font-bold text-amber-300 hover:text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">Open your workspace <ArrowRight size={17} aria-hidden="true" /></button>
      </section>
    </div>
  );
}
