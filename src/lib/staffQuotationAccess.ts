export const STAFF_QUOTE_PATH = "/staff-quote";

export function isStaffQuotePath(pathname: string): boolean {
  return /^\/staff-quote\/?$/.test(pathname);
}

export function canUseStaffQuote(role: string | null | undefined): boolean {
  return Boolean(role && role !== "Customer");
}
