/**
 * The guide names the company the person works for. Sunchaser's own people keep the existing wording; anyone else sees their company's
 * name (or a neutral phrase if it has set none) - never Sunchaser's.
 */
export function personalise(text: string, company: { neutral: boolean; name: string }): string {
  if (!company.neutral) return text;
  const n = company.name.trim();
  return text
    .replace(/Welcome to Sunchaser (Customer Portal|CRM|Field Portal)/g, (_m, what) => `Welcome to ${n ? n + " " : "the "}${what}`)
    .replace(/outside Sunchaser/g, n ? `outside ${n}` : "outside your company")
    .replace(/Sunchaser Energy|Sunchaser/g, n || "your company");
}
