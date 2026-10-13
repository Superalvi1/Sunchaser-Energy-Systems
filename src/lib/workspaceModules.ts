/**
 * Which optional modules the signed-in company may use. Set once from the boot payload (/api/state); absent flags mean "available",
 * which is how single-company mode and the founding company behave. The API refuses a disabled module on its own
 * (server/saas/moduleGate.ts); hiding it here only keeps the interface honest.
 */
export type WorkspaceModules = { autoSizer: boolean; afterSales: boolean };

let current: WorkspaceModules = { autoSizer: true, afterSales: true };
/** True when the server runs in multi-company mode (it then sends the module flags); false in single-company mode. */
let multiCompany = false;

export function setWorkspaceModules(m: Partial<WorkspaceModules> | null | undefined): void {
  multiCompany = m != null;
  current = { autoSizer: m?.autoSizer !== false, afterSales: m?.afterSales !== false };
}

export function autoSizerEnabled(): boolean {
  return current.autoSizer;
}

/** The company settings screen (branding, bank accounts, terms, prices, history) exists only in multi-company mode. */
export function companySettingsEnabled(): boolean {
  return multiCompany;
}

/** Delivery challans, delivery certificates, project completion and handover, customer warranties and warranty claims. */
export function afterSalesEnabled(): boolean {
  return current.afterSales;
}

// ---- Branding of the open workspace, and the name of the platform on the sign-in screens ---------------------------------------------
// Before sign-in the screen belongs to the PLATFORM ("Sunchaser Sync"): no company is known yet. After sign-in the workspace carries the
// COMPANY's own name and logo. Single-company mode shows neither: it keeps the existing Sunchaser screens.
export type WorkspaceBrand = { companyName: string; logoUrl: string };
export type PlatformInfo = { multiCompany: boolean; platformName: string };

let brand: WorkspaceBrand | null = null;
let neutral = false;
let platform: PlatformInfo | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeWorkspace(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function getWorkspaceBrand(): WorkspaceBrand | null { return brand; }
export function setWorkspaceBrand(b: WorkspaceBrand | null): void { brand = b; emit(); }
export function getPlatformInfo(): PlatformInfo | null { return platform; }
export function setPlatformInfo(p: PlatformInfo | null): void { platform = p; emit(); }
/** A company other than the founding one: no Sunchaser logo or name is ever substituted when it has set none. */
export function setWorkspaceNeutral(n: boolean): void { neutral = n === true; emit(); }
export function workspaceIsNeutral(): boolean { return neutral; }
