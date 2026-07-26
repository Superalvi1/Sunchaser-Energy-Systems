/**
 * Receipt file validation — MIME allowlist + magic-byte signature checks.
 * Rejects executables, HTML/SVG, polyglots, and empty/oversized content.
 */
import { createHash } from "node:crypto";
import {
  RECEIPT_ALLOWED_MIME,
  RECEIPT_MAX_BYTES,
  type ReceiptMimeType,
} from "./paymentTypes.ts";

export type ReceiptValidationOk = {
  ok: true;
  mimeType: ReceiptMimeType;
  bytes: Buffer;
  sha256: string;
  byteSize: number;
};

export type ReceiptValidationErr = {
  ok: false;
  code: string;
  message: string;
};

export type ReceiptValidation = ReceiptValidationOk | ReceiptValidationErr;

const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_SIG = Buffer.from("%PDF");

function startsWith(buf: Buffer, sig: Buffer): boolean {
  return buf.length >= sig.length && buf.subarray(0, sig.length).equals(sig);
}

function detectMimeFromMagic(bytes: Buffer): ReceiptMimeType | null {
  if (startsWith(bytes, JPEG_SIG)) return "image/jpeg";
  if (startsWith(bytes, PNG_SIG)) return "image/png";
  if (startsWith(bytes, PDF_SIG)) return "application/pdf";
  return null;
}

function looksLikeHtmlOrSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, 256)).toString("utf8").toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("<svg") ||
    head.includes("<?xml")
  );
}

function looksLikeExecutable(bytes: Buffer): boolean {
  // ELF, PE/MZ, Mach-O
  if (startsWith(bytes, Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true;
  if (startsWith(bytes, Buffer.from([0x4d, 0x5a]))) return true;
  if (startsWith(bytes, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))) return true;
  if (startsWith(bytes, Buffer.from([0xce, 0xfa, 0xed, 0xfe]))) return true;
  return false;
}

/** Reject filenames used to smuggle disallowed extensions. */
export function isSuspiciousFileName(fileName: string | undefined): boolean {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  if (lower.includes("\0") || lower.includes("/") || lower.includes("\\")) {
    return true;
  }
  if (/\.(exe|dll|bat|cmd|sh|js|html|htm|svg|php|py|msi|scr)(\.|$)/i.test(lower)) {
    return true;
  }
  // double extension bypass e.g. receipt.pdf.exe or invoice.jpg.js
  const parts = lower.split(".").filter(Boolean);
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    if (
      ["exe", "js", "html", "htm", "svg", "php"].includes(last) ||
      ["exe", "js", "html", "htm", "svg", "php"].includes(prev)
    ) {
      return true;
    }
  }
  return false;
}

export function validateReceiptBytes(input: {
  declaredMime: string;
  bytes: Buffer;
  fileName?: string;
  maxBytes?: number;
}): ReceiptValidation {
  const maxBytes = input.maxBytes ?? RECEIPT_MAX_BYTES;
  const declared = String(input.declaredMime || "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    .trim() as ReceiptMimeType;

  if (!RECEIPT_ALLOWED_MIME.includes(declared)) {
    return {
      ok: false,
      code: "INVALID_FILE_TYPE",
      message: "Receipt file type is not allowed.",
    };
  }

  if (isSuspiciousFileName(input.fileName)) {
    return {
      ok: false,
      code: "INVALID_FILE_TYPE",
      message: "Receipt file name is not allowed.",
    };
  }

  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    return {
      ok: false,
      code: "INVALID_FILE_CONTENT",
      message: "Receipt content is empty.",
    };
  }

  if (input.bytes.length > maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: "Receipt exceeds maximum size.",
    };
  }

  if (looksLikeExecutable(input.bytes) || looksLikeHtmlOrSvg(input.bytes)) {
    return {
      ok: false,
      code: "INVALID_FILE_CONTENT",
      message: "Receipt content is not allowed.",
    };
  }

  const detected = detectMimeFromMagic(input.bytes);
  if (!detected) {
    return {
      ok: false,
      code: "INVALID_FILE_CONTENT",
      message: "Receipt signature is not recognized.",
    };
  }

  if (detected !== declared) {
    return {
      ok: false,
      code: "INVALID_FILE_CONTENT",
      message: "Declared type does not match file content.",
    };
  }

  // PDF polyglot: reject if HTML markers appear after header
  if (detected === "application/pdf") {
    const sample = input.bytes
      .subarray(0, Math.min(input.bytes.length, 2048))
      .toString("latin1")
      .toLowerCase();
    if (sample.includes("<html") || sample.includes("<svg") || sample.includes("<script")) {
      return {
        ok: false,
        code: "INVALID_FILE_CONTENT",
        message: "Receipt content is not allowed.",
      };
    }
  }

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  return {
    ok: true,
    mimeType: detected,
    bytes: input.bytes,
    sha256,
    byteSize: input.bytes.length,
  };
}
