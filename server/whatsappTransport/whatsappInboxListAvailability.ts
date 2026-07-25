/**
 * Transport-aware Inbox list availability.
 *
 * listConversations / listDelta must query the repository when ANY supported
 * WhatsApp transport is CONNECTED (Meta Cloud or WhatsApp Web QR).
 * Empty short-circuit only when every transport lookup succeeds and none is connected.
 * Lookup failures fail through so repository/RPC errors can still surface.
 */
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import { getWhatsAppConnectionStatus } from "./whatsappConnectionService.ts";

export type WhatsAppMetaListStatus = {
  status: string;
};

export type WhatsAppQrListStatus = {
  state: string;
};

export type WhatsAppInboxListAvailability = {
  /** True → controllers may return empty 200 without querying the repository. */
  allTransportsDisconnected: boolean;
};

export type WhatsAppInboxListAvailabilityDeps = {
  getMetaConnectionStatus: () => Promise<WhatsAppMetaListStatus>;
  getQrConnectionStatus: () => Promise<WhatsAppQrListStatus>;
};

/** Only an explicit QR CONNECTED state counts as an available QR transport. */
export function isWhatsAppWebQrConnectedForInbox(
  state: string | null | undefined
): boolean {
  return String(state || "").trim() === "CONNECTED";
}

/** Meta short-circuit uses the legacy explicit DISCONNECTED status only. */
export function isMetaWhatsAppDisconnectedForInbox(
  status: string | null | undefined
): boolean {
  return String(status || "").trim() === "DISCONNECTED";
}

/**
 * Pure combined resolver (injectable — no global QR session hardwiring).
 */
export async function resolveWhatsAppInboxListAvailability(
  deps: WhatsAppInboxListAvailabilityDeps
): Promise<WhatsAppInboxListAvailability> {
  let metaDisconnected: boolean | null = null;
  let qrConnected: boolean | null = null;

  try {
    const meta = await deps.getMetaConnectionStatus();
    metaDisconnected = isMetaWhatsAppDisconnectedForInbox(meta.status);
  } catch {
    // Fail through — do not hide conversations on Meta lookup failure.
    metaDisconnected = null;
  }

  try {
    const qr = await deps.getQrConnectionStatus();
    qrConnected = isWhatsAppWebQrConnectedForInbox(qr.state);
  } catch {
    // Fail through — do not hide conversations on QR lookup failure.
    qrConnected = null;
  }

  if (qrConnected === true) {
    return { allTransportsDisconnected: false };
  }
  if (metaDisconnected === false) {
    return { allTransportsDisconnected: false };
  }
  if (metaDisconnected === null || qrConnected === null) {
    return { allTransportsDisconnected: false };
  }

  // Both lookups succeeded: Meta DISCONNECTED and QR not CONNECTED.
  return { allTransportsDisconnected: true };
}

export type WhatsAppInboxListAvailabilityResolver =
  () => Promise<WhatsAppInboxListAvailability>;

/**
 * Factory for controller DI. Defaults treat missing QR getter as explicit
 * DISCONNECTED so legacy Meta-only tests keep their empty-list behavior.
 */
export function createWhatsAppInboxListAvailabilityResolver(input: {
  getMetaConnectionStatus?: (
    companyId: string
  ) => Promise<WhatsAppMetaListStatus>;
  getQrConnectionStatus?: () =>
    | WhatsAppQrListStatus
    | Promise<WhatsAppQrListStatus>;
  companyId?: string;
}): WhatsAppInboxListAvailabilityResolver {
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  const getMeta =
    input.getMetaConnectionStatus ??
    ((cid: string) => getWhatsAppConnectionStatus(cid));
  const getQr =
    input.getQrConnectionStatus ??
    (async () => ({ state: "DISCONNECTED" as const }));

  return () =>
    resolveWhatsAppInboxListAvailability({
      getMetaConnectionStatus: () => getMeta(companyId),
      getQrConnectionStatus: async () => getQr(),
    });
}
