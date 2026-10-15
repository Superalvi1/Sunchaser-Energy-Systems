import React, { useEffect, useState } from 'react';
import { PANEL_CATALOG, INVERTER_CATALOG, BATTERY_CATALOG, BATTERY_ACCESSORY_CATALOG, inverterDisplayName } from '../lib/solarEquipmentCatalog';
import { SMART_QUOTE_RATE_LABELS, validateSmartQuoteSettings, type SmartQuoteSettings } from '../lib/smartQuoteSettings';
import { fetchAdminSmartQuoteSettings, saveSmartQuoteSettings } from '../services/smartQuoteSettingsApi';

type PriceGroup = 'panels' | 'inverters' | 'batteries' | 'accessories' | 'rates';
const groups: { key: PriceGroup; title: string; unit: string; items: { id: string; label: string }[] }[] = [
  { key: 'panels', title: 'Solar panels', unit: 'PKR / watt', items: PANEL_CATALOG.map(p => ({ id: p.id, label: `${p.brand} ${p.watts}W · ${p.model}` })) },
  { key: 'inverters', title: 'Inverters and bundles', unit: 'PKR / unit or complete bundle', items: INVERTER_CATALOG.map(p => ({ id: p.id, label: `${inverterDisplayName(p)}${p.bundle ? ' · includes battery' : ''}` })) },
  { key: 'batteries', title: 'Batteries', unit: 'PKR / unit', items: BATTERY_CATALOG.filter(p => !p.bundleOnly).map(p => ({ id: p.id, label: `${p.brand} ${p.capacityKwh}kWh · ${p.model}` })) },
  { key: 'accessories', title: 'Battery accessories', unit: 'PKR / unit', items: BATTERY_ACCESSORY_CATALOG.map(p => ({ id: p.id, label: `${p.brand} ${p.model}` })) },
  { key: 'rates', title: 'Structure, wiring and services', unit: 'PKR per unit shown', items: Object.entries(SMART_QUOTE_RATE_LABELS).map(([id, label]) => ({ id, label })) },
];
export default function SmartQuotePriceSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState<SmartQuoteSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [paymentText, setPaymentText] = useState('');
  const [termsText, setTermsText] = useState('');
  const accept = (settings: SmartQuoteSettings) => {
    setDraft(settings); setPaymentText(settings.document.paymentPlan.join('\n')); setTermsText(settings.document.terms.join('\n'));
    setDirty(false); onDirtyChange?.(false);
  };
  const reload = async () => {
    if (dirty && !window.confirm('Discard unsaved price changes and reload?')) return;
    setLoading(true); setError(''); setMessage('');
    try { accept(await fetchAdminSmartQuoteSettings()); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    fetchAdminSmartQuoteSettings().then(settings => { if (active) accept(settings); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const changed = () => { setDirty(true); onDirtyChange?.(true); setMessage(''); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!draft) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const lines = (s: string) => s.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const settings = validateSmartQuoteSettings({ ...draft, document: { ...draft.document, paymentPlan: lines(paymentText), terms: lines(termsText) } });
      accept(await saveSmartQuoteSettings(settings));
      setMessage('Saved. New Smart Quotes use these prices and payment terms. Refresh any quotation page already open.');
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };
  return <form onSubmit={save} className="space-y-5 text-slate-800">
    <div className="rounded-2xl border bg-white p-5">
      <h2 className="text-xl font-bold">Smart Quote Prices</h2>
      <p className="mt-2 text-sm text-slate-600">Edit selling prices used by the public Smart Quote and staff quotation builder. Existing saved quotations keep their original amounts.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" disabled={!draft || !dirty || saving || loading} className="min-h-12 rounded-xl bg-blue-700 px-5 font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save prices and terms'}</button>
        <button type="button" disabled={saving || loading} onClick={() => void reload()} className="min-h-12 rounded-xl border px-5 font-semibold">Reload saved prices</button>
        {draft && <span className="self-center text-sm text-slate-500">Version {draft.revision}{dirty ? ' · Unsaved changes' : ''}</span>}
      </div>
      {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {loading && <p role="status" className="mt-3">Loading current prices…</p>}
    </div>
    {draft && <fieldset disabled={saving || loading} className="min-w-0 space-y-5">
      <label className="block text-sm font-semibold">Find an item<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Panel, inverter, battery, cable…" className="mt-2 min-h-12 w-full rounded-xl border bg-white px-4" /></label>
      {groups.map(group => {
        const items = group.items.filter(item => `${group.title} ${item.label}`.toLowerCase().includes(search.toLowerCase()));
        if (!items.length) return null;
        return <section key={group.key} className="rounded-2xl border bg-white p-4 sm:p-5">
          <h3 className="text-lg font-bold">{group.title}</h3><p className="mb-4 text-sm text-slate-500">{group.unit}</p>
          <div className="grid gap-4 xl:grid-cols-2">{items.map(item => <label key={item.id} className="flex min-w-0 flex-col gap-2 rounded-xl bg-slate-50 p-3 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between">
            <span className="break-words">{item.label}</span>
            <input aria-label={`${item.label} price`} type="number" min="0" step="0.01" required value={Number.isFinite(draft[group.key][item.id]) ? draft[group.key][item.id] : ''} onChange={e => { setDraft({ ...draft, [group.key]: { ...draft[group.key], [item.id]: e.target.value === '' ? NaN : Number(e.target.value) } }); changed(); }} className="min-h-12 w-full rounded-lg border bg-white px-3 text-base sm:w-36 sm:shrink-0" />
          </label>)}</div>
        </section>;
      })}
      <section className="space-y-4 rounded-2xl border bg-white p-5">
        <h3 className="text-lg font-bold">Cover page and payment terms</h3>
        <p className="text-sm text-slate-600">The PDF starts with the customer's name and system size, followed by the BOQ, and ends with payment terms. Enter one payment milestone or condition per line.</p>
        <label className="block text-sm font-semibold">Default prepared by<input maxLength={100} required value={draft.document.preparedBy} onChange={e => { setDraft({ ...draft, document: { ...draft.document, preparedBy: e.target.value } }); changed(); }} className="mt-2 min-h-12 w-full rounded-xl border px-3" /></label>
        <label className="block text-sm font-semibold">Quotation validity (days)<input type="number" min={1} max={90} required value={draft.document.validityDays} onChange={e => { setDraft({ ...draft, document: { ...draft.document, validityDays: Number(e.target.value) } }); changed(); }} className="mt-2 min-h-12 w-full rounded-xl border px-3" /></label>
        <label className="block text-sm font-semibold">Payment plan<textarea rows={5} required value={paymentText} onChange={e => { setPaymentText(e.target.value); changed(); }} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="block text-sm font-semibold">Terms and conditions<textarea rows={6} required value={termsText} onChange={e => { setTermsText(e.target.value); changed(); }} className="mt-2 w-full rounded-xl border p-3" /></label>
      </section>
      <button type="submit" disabled={!dirty} className="min-h-12 rounded-xl bg-blue-700 px-5 font-bold text-white disabled:opacity-50">Save prices and terms</button>
    </fieldset>}
  </form>;
}
