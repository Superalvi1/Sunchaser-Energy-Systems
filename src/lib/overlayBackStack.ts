/**
 * Reusable dismissible-overlay stack.
 *
 * Native Android Back and (separately) browser/PWA history both ask this
 * module "what is the top overlay?" — they do not own quotation state.
 * Dismiss always means the overlay's own onClose. Callers decide whether
 * that is a modal, a catalog picker, or anything else.
 */

export type OverlayDismiss = () => void;

type OverlayEntry = {
  id: number;
  dismiss: OverlayDismiss;
};

let seq = 0;
const stack: OverlayEntry[] = [];

export function resetOverlayStackForTests(): void {
  stack.length = 0;
  seq = 0;
}

export function overlayCount(): number {
  return stack.length;
}

export function topOverlayId(): number | null {
  if (!stack.length) return null;
  return stack[stack.length - 1].id;
}

export function hasOverlay(id: number): boolean {
  return stack.some((entry) => entry.id === id);
}

export function pushOverlay(dismiss: OverlayDismiss): number {
  const id = ++seq;
  stack.push({ id, dismiss });
  return id;
}

export function popOverlay(id: number): void {
  const idx = stack.findIndex((entry) => entry.id === id);
  if (idx >= 0) stack.splice(idx, 1);
}

/**
 * Close the top overlay only. Returns true when an overlay consumed the
 * request. Does not apply drafts, save, message, or sync catalogs — the
 * stacked dismiss callback is the overlay's onClose and nothing else.
 */
export function dismissTopOverlay(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top.dismiss();
  return true;
}
