/**
 * What changed between two versions of a company's settings: used by the server to write the one-line summary of a history entry and by the
 * settings screen to show the values before and after. Pure functions, no I/O.
 *
 * Bank accounts have no stable identity across saves (the list is replaced as a whole), so an account is recognised by its account number:
 * the same number with other details is an edit, a number that appears or disappears is an addition or a removal.
 */
export type SettingsSection = "branding" | "bank_accounts" | "terms" | "prices";
export type DiffRow = { kind: "changed" | "added" | "removed"; label: string; before: string; after: string };

const BRANDING_LABELS: Record<string, string> = {
  companyName: "Company name", officeAddress: "Address", officeLocations: "Office locations", phoneNumbers: "Phone numbers", billingEmail: "Billing e-mail",
  websiteUrl: "Website", logoUrl: "Logo", invoiceLogoUrl: "Invoice logo", signatureUrl: "Signature image", bankAccountsImageUrl: "Bank accounts image",
  appIconUrl: "App icon", splashImageUrl: "Splash image", primaryColor: "Primary colour", secondaryColor: "Secondary colour", accentColor: "Accent colour",
  terms: "Terms text", googleReviewUrl: "Google review link",
};
const BANK_LABELS: Record<string, string> = { bankName: "bank", accountTitle: "account title", accountNumber: "account number", iban: "IBAN", branchCode: "branch code", isActive: "active", showOnInvoice: "shown on invoices", sortOrder: "position" };
const PRICE_LABELS: Record<string, string> = { currencySettings: "Currency", taxSettings: "Tax note", quoteValidityDays: "Quotation validity (days)" };

const humanise = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/** A value as one readable line. Embedded images are never printed (they are large); long text is cut. */
export function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.map(displayValue).join("; ") : "(empty)";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 160);
  const s = String(v);
  const img = /^data:image\/[a-z+.-]+;base64,(.*)$/i.exec(s);
  if (img) return `[embedded image, ${Math.max(1, Math.round((img[1].length * 3) / 4 / 1024))} KB]`;
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");

function diffObject(before: any, after: any, labels: Record<string, string>): DiffRow[] {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((k) => !same(before?.[k], after?.[k]));
  return keys.map((k) => ({ kind: "changed" as const, label: labels[k] || humanise(k), before: displayValue(before?.[k]), after: displayValue(after?.[k]) }));
}

type Bank = Record<string, any>;
const bankLine = (b: Bank) => `${b.bankName || "?"} · ${b.accountTitle || "?"} · ${b.accountNumber || "?"} · ${b.iban || "N/A"}`;

function diffBanks(beforeList: Bank[], afterList: Bank[]): DiffRow[] {
  const before = Array.isArray(beforeList) ? beforeList : [];
  const after = Array.isArray(afterList) ? afterList : [];
  const rows: DiffRow[] = [];
  const left = [...before];
  for (const a of after) {
    const i = left.findIndex((b) => String(b.accountNumber) === String(a.accountNumber));
    if (i < 0) { rows.push({ kind: "added", label: `Account ${a.accountNumber || "?"} added`, before: "—", after: bankLine(a) }); continue; }
    const b = left.splice(i, 1)[0];
    for (const f of Object.keys(BANK_LABELS)) {
      if (f === "accountNumber" || f === "sortOrder") continue;
      if (!same(b[f], a[f])) rows.push({ kind: "changed", label: `${a.bankName || b.bankName} ${a.accountNumber}: ${BANK_LABELS[f]}`, before: displayValue(b[f]), after: displayValue(a[f]) });
    }
  }
  for (const b of left) rows.push({ kind: "removed", label: `Account ${b.accountNumber || "?"} removed`, before: bankLine(b), after: "—" });
  const orderBefore = before.map((b) => b.accountNumber).filter((n) => after.some((a) => a.accountNumber === n)).join("|");
  const orderAfter = after.map((a) => a.accountNumber).filter((n) => before.some((b) => b.accountNumber === n)).join("|");
  if (orderBefore !== orderAfter) rows.push({ kind: "changed", label: "Order of the accounts", before: orderBefore.split("|").join(", "), after: orderAfter.split("|").join(", ") });
  return rows;
}

function diffTerms(beforeList: string[], afterList: string[]): DiffRow[] {
  const before = (Array.isArray(beforeList) ? beforeList : []).map(String);
  const after = (Array.isArray(afterList) ? afterList : []).map(String);
  const rows: DiffRow[] = [];
  const left = [...before];
  const added: string[] = [];
  for (const t of after) { const i = left.indexOf(t); if (i < 0) added.push(t); else left.splice(i, 1); }
  for (const t of left) rows.push({ kind: "removed", label: "Clause removed", before: displayValue(t), after: "—" });
  for (const t of added) rows.push({ kind: "added", label: "Clause added", before: "—", after: displayValue(t) });
  if (!rows.length && before.join("\n") !== after.join("\n")) rows.push({ kind: "changed", label: "Order of the clauses", before: before.map((_, i) => i + 1).join(", "), after: "changed" });
  return rows;
}

export function diffSettings(section: SettingsSection, before: any, after: any): DiffRow[] {
  switch (section) {
    case "branding": return diffObject(before, after, BRANDING_LABELS);
    case "bank_accounts": return diffBanks(before, after);
    case "terms": return diffTerms(before, after);
    default: return diffObject(before, after, PRICE_LABELS);
  }
}

/** One line for the history list. It names what changed (field names, counts) and never prints a value. */
export function summariseSettingsChange(section: SettingsSection, before: any, after: any): string {
  const rows = diffSettings(section, before, after);
  if (section === "branding") {
    const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((k) => !same(before?.[k], after?.[k]));
    return keys.length ? `Branding changed: ${keys.join(", ")}` : "Branding saved (no value changed)";
  }
  if (section === "bank_accounts") {
    const added = rows.filter((r) => r.kind === "added").length, removed = rows.filter((r) => r.kind === "removed").length;
    const edited = new Set(rows.filter((r) => r.kind === "changed" && !/^Order/.test(r.label)).map((r) => r.label.split(":")[0])).size;
    const parts = [added && `${added} added`, removed && `${removed} removed`, edited && `${edited} edited`, rows.some((r) => /^Order/.test(r.label)) && "reordered"].filter(Boolean);
    return parts.length ? `Bank accounts changed: ${parts.join(", ")} (now ${(after || []).length})` : "Bank accounts saved (no value changed)";
  }
  if (section === "terms") {
    const added = rows.filter((r) => r.kind === "added").length, removed = rows.filter((r) => r.kind === "removed").length;
    const parts = [added && `${added} added`, removed && `${removed} removed`, !added && !removed && rows.length && "reordered"].filter(Boolean);
    return parts.length ? `Terms changed: ${parts.join(", ")} (now ${(after || []).length})` : "Terms saved (no value changed)";
  }
  const keys = Object.keys(after || {}).filter((k) => !same(before?.[k], after?.[k]));
  return keys.length ? `Price settings changed: ${keys.join(", ")}` : "Price settings saved (no value changed)";
}
