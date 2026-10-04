import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { getJwtSecret } from "../auth/jwt";

export const SMART_QUOTE_PDF_MAX_BYTES = 5 * 1024 * 1024;
const TTL = 24 * 60 * 60 * 1000;
function signature(leadId: string, quoteNumber: string, issuedAt: number) {
  return createHmac("sha256", getJwtSecret()).update(`smart-quote-pdf-v1\n${leadId}\n${quoteNumber}\n${issuedAt}`).digest("hex");
}
export function createQuotePdfUploadToken(leadId: string, quoteNumber: string, now = Date.now()) {
  return `${now}.${signature(leadId, quoteNumber, now)}`;
}
export function verifyQuotePdfUploadToken(leadId: string, quoteNumber: string, token: string, now = Date.now()) {
  if (!/^lead-[a-f0-9-]{36}$/.test(leadId) || !/^SES-\d{8}-\d{4}$/.test(quoteNumber)) return false;
  const [timestamp, sig, extra] = token.split(".");
  const issuedAt = Number(timestamp);
  if (extra || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(sig || "") || !Number.isFinite(issuedAt) || issuedAt > now || now - issuedAt > TTL) return false;
  return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(signature(leadId, quoteNumber, issuedAt), "hex"));
}
export function parseQuotePdfBase64(value: unknown) {
  if (typeof value !== "string" || value.length > Math.ceil(SMART_QUOTE_PDF_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Invalid PDF file or file exceeds 5 MB.");
  const buffer = Buffer.from(value, "base64");
  if (!buffer.length || buffer.length > SMART_QUOTE_PDF_MAX_BYTES || buffer.subarray(0, 5).toString() !== "%PDF-" || !buffer.subarray(-1024).toString().includes("%%EOF")) throw new Error("Invalid PDF file or file exceeds 5 MB.");
  return buffer;
}
export type SmartQuotePdfArchive = { quoteNumber: string; fileName: string; fileUrl: string; sha256: string; savedAt: string; sizeBytes: number };
export function quotePdfObjectKey(leadId: string, quoteNumber: string, pdf: Buffer) {
  return `smart-quotes/${leadId}/${quoteNumber}-${createHash("sha256").update(pdf).digest("hex")}.pdf`;
}
export function addPdfArchiveToNotes(notes: string, archive: SmartQuotePdfArchive) {
  return [...notes.split(/\r?\n/).filter(line => !line.startsWith("PdfArchive: ")), `PdfArchive: ${JSON.stringify(archive)}`].join("\n");
}
