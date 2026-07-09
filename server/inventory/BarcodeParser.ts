/**
 * Barcode / QR / GS1-128 parser architecture (deterministic, no external libs).
 */

export interface ParsedBarcode {
  raw: string;
  format: "code128" | "ean13" | "qr" | "unknown";
  gtin?: string;
  serialNumber?: string;
  batchNumber?: string;
  expiryDate?: string;
  applicationIdentifiers: Record<string, string>;
}

/** GS1 Application Identifier definitions used by parser architecture. */
export const GS1_APPLICATION_IDENTIFIERS: Record<string, { label: string; fixedLength?: number; maxLength?: number }> = {
  "01": { label: "GTIN", fixedLength: 14 },
  "10": { label: "BATCH", maxLength: 20 },
  "17": { label: "EXPIRY", fixedLength: 6 },
  "21": { label: "SERIAL", maxLength: 20 },
};

const GS1_FNC1 = String.fromCharCode(29);

export function normalizeBarcodeInput(raw: string): string {
  return raw.trim();
}

export function detectBarcodeFormat(raw: string): ParsedBarcode["format"] {
  const value = normalizeBarcodeInput(raw);
  if (!value) return "unknown";
  if (value.includes(GS1_FNC1) || /^\]C1/.test(value) || /^\(\d{2}\)/.test(value)) return "code128";
  if (/^\d{13}$/.test(value)) return "ean13";
  if (value.startsWith("QR:")) return "qr";
  return "unknown";
}

export function parseEan13(raw: string): ParsedBarcode | null {
  const value = normalizeBarcodeInput(raw);
  if (!/^\d{13}$/.test(value)) return null;
  return {
    raw: value,
    format: "ean13",
    gtin: value,
    applicationIdentifiers: { "01": value.padStart(14, "0") },
  };
}

/**
 * Parse GS1-128 element string (AI) architecture.
 * Supports parenthesized human-readable form: (01)09501101530003(10)ABC123(21)SN001
 */
export function parseGs1128(raw: string): ParsedBarcode | null {
  const value = normalizeBarcodeInput(raw).replace(/^\]C1/, "");
  if (!value.includes("(") && !value.includes(GS1_FNC1)) return null;

  const applicationIdentifiers: Record<string, string> = {};
  const parenPattern = /\((\d{2,4})\)([^()]+)/g;
  let match: RegExpExecArray | null;
  while ((match = parenPattern.exec(value)) !== null) {
    applicationIdentifiers[match[1]] = match[2].trim();
  }

  if (Object.keys(applicationIdentifiers).length === 0 && value.includes(GS1_FNC1)) {
    let i = 0;
    while (i < value.length) {
      const ai = value.slice(i, i + 2);
      const def = GS1_APPLICATION_IDENTIFIERS[ai];
      if (!def) break;
      i += 2;
      const end = value.indexOf(GS1_FNC1, i);
      const chunk = end === -1 ? value.slice(i) : value.slice(i, end);
      const len = def.fixedLength ?? def.maxLength ?? chunk.length;
      applicationIdentifiers[ai] = chunk.slice(0, len);
      i = end === -1 ? value.length : end + 1;
    }
  }

  if (Object.keys(applicationIdentifiers).length === 0) return null;

  return {
    raw: value,
    format: "code128",
    gtin: applicationIdentifiers["01"],
    batchNumber: applicationIdentifiers["10"],
    serialNumber: applicationIdentifiers["21"],
    expiryDate: formatGs1Date(applicationIdentifiers["17"]),
    applicationIdentifiers,
  };
}

function formatGs1Date(yymmdd: string | undefined): string | undefined {
  if (!yymmdd || yymmdd.length !== 6) return undefined;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const year = yy >= 50 ? 1900 + yy : 2000 + yy;
  return `${year}-${mm}-${dd}`;
}

export function parseQrPayload(raw: string): ParsedBarcode | null {
  const value = normalizeBarcodeInput(raw);
  if (!value.startsWith("QR:")) return null;
  const payload = value.slice(3);
  const parts = Object.fromEntries(
    payload.split(";").map((pair) => {
      const [k, v] = pair.split("=");
      return [k?.trim(), v?.trim()];
    }).filter(([k]) => k)
  );
  return {
    raw: value,
    format: "qr",
    gtin: parts.gtin,
    serialNumber: parts.serial,
    batchNumber: parts.batch,
    applicationIdentifiers: parts,
  };
}

export function parseBarcode(raw: string): ParsedBarcode {
  const normalized = normalizeBarcodeInput(raw);
  if (!normalized) {
    return { raw: "", format: "unknown", applicationIdentifiers: {} };
  }

  return (
    parseGs1128(normalized) ??
    parseEan13(normalized) ??
    parseQrPayload(normalized) ?? {
      raw: normalized,
      format: detectBarcodeFormat(normalized),
      applicationIdentifiers: {},
    }
  );
}

export function barcodeMatchesSku(parsed: ParsedBarcode, skuBarcode: string | undefined, skuCode: string): boolean {
  const target = normalizeBarcodeInput(skuBarcode ?? skuCode).toUpperCase();
  const gtin = parsed.gtin?.replace(/^0+/, "") ?? "";
  const raw = parsed.raw.toUpperCase();
  return raw === target || gtin === target.replace(/^0+/, "") || parsed.applicationIdentifiers["01"]?.includes(target) === true;
}
