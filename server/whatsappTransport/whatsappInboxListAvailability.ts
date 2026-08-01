/**
 * Transport health for Admin / diagnostics.
 *
 * IMPORTANT: listConversations / listDelta must ALWAYS query the repository for
 * stored conversations. Connection state (Meta or WhatsApp Web) is reported
 * separately and must never replace stored records with [].
 *
 * `allTransportsDisconnected` remains a health signal only — controllers must
 * not short-circuit list/delta on it.
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
  /**
   * True when every looked-up transport reports offline.
   * Health-only — never use this to skip repository list/delta queries.
   */
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
 * Returns connection health only; callers must still load stored inbox data.
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
    // Fail through — do not treat Meta lookup failure as disconnected health.
    metaDisconnected = null;
  }

  try {
    const qr = await deps.getQrConnectionStatus();
    qrConnected = isWhatsAppWebQrConnectedForInbox(qr.state);
  } catch {
    // Fail through — do not treat QR lookup failure as disconnected health.
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
 * Factory for controller DI / Admin health. Defaults treat missing QR getter as
 * explicit DISCONNECTED for Meta-only wiring.
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
