/**
 * Which optional modules the signed-in company may use. Set once from the boot payload (/api/state); absent flags mean "available",
 * which is how single-company mode and the founding company behave. The API refuses a disabled module on its own
 * (server/saas/moduleGate.ts); hiding it here only keeps the interface honest.
 */
export type WorkspaceModules = { autoSizer: boolean };

let current: WorkspaceModules = { autoSizer: true };

export function setWorkspaceModules(m: Partial<WorkspaceModules> | null | undefined): void {
  current = { autoSizer: m?.autoSizer !== false };
}

export function autoSizerEnabled(): boolean {
  return current.autoSizer;
}
