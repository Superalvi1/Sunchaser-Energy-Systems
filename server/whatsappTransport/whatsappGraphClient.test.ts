/**
 * WhatsApp Graph client tests — the real PDF upload → native document send
 * path that /api/moos/send-approved-pdf executes server-side.
 *
 * Uses a stubbed fetch (no Meta network). Verifies: multipart upload shape,
 * media-id handoff into the type:document payload, PDF validation,
 * sanitized error mapping, and timeout classification.
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=0 tsx server/whatsappTransport/whatsappGraphClient.test.ts
 */
import assert from "node:assert/strict";
import {
  sendWhatsAppDocumentMessage,
  uploadWhatsAppMedia,
  validatePdfBytes,
} from "./whatsappGraphClient.ts";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

const PDF = new Uint8Array(Buffer.from("%PDF-1.4 test-bytes"));
const BASE = {
  phoneNumberId: "243825222156651",
  accessToken: "test-token",
  graphApiVersion: "v21.0",
};

function stubFetch(handler: (url: string, init: any) => any) {
  return (async (url: any, init: any) => handler(String(url), init)) as typeof fetch;
}

await test("validatePdfBytes accepts real PDFs, rejects garbage", async () => {
  assert.equal(validatePdfBytes(PDF), null);
  assert.equal(validatePdfBytes(new Uint8Array(Buffer.from("hello world, not a pdf file...."))), "Not a PDF file");
  assert.equal(validatePdfBytes(new Uint8Array(0)), "Empty file");
});

await test("upload posts multipart/form-data to the media endpoint and returns the media id", async () => {
  let seen: any = null;
  const fetchImpl = stubFetch((url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ id: "123456789" }), { status: 200 });
  });
  const r = await uploadWhatsAppMedia({ ...BASE, pdfBytes: PDF, filename: "Sunchaser-10kW-Quotation.pdf", fetchImpl });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.mediaId, "123456789");
  assert.ok(seen.url.includes("/243825222156651/media"), seen.url);
  assert.ok(seen.url.includes("v21.0"), seen.url);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, "Bearer test-token");
  // Multipart body (undici sets the Content-Type boundary at send time).
  assert.ok(seen.init.body instanceof FormData, typeof seen.init.body);
  assert.equal(seen.init.body.get("messaging_product"), "whatsapp");
  assert.equal(seen.init.body.get("type"), "application/pdf");
  const file = seen.init.body.get("file") as File;
  assert.equal(file.name, "Sunchaser-10kW-Quotation.pdf");
  assert.equal(file.type, "application/pdf");
  // The access token must not leak into the URL.
  assert.ok(!seen.url.includes("test-token"));
});

await test("upload refuses non-PDF bytes before any network call", async () => {
  let calls = 0;
  const fetchImpl = stubFetch(() => {
    calls++;
    return new Response("{}", { status: 200 });
  });
  const r = await uploadWhatsAppMedia({
    ...BASE,
    pdfBytes: new Uint8Array(Buffer.from("not a pdf")),
    filename: "x.pdf",
    fetchImpl,
  });
  assert.equal(r.ok, false);
  assert.equal(calls, 0);
});

await test("upload maps Meta errors to sanitized kinds (no token leakage)", async () => {
  const fetchImpl = stubFetch(
    () => new Response(JSON.stringify({ error: { message: "bad token test-token", code: 190 } }), { status: 400 })
  );
  const r = await uploadWhatsAppMedia({ ...BASE, pdfBytes: PDF, filename: "x.pdf", fetchImpl });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, "provider_error");
    assert.ok(!r.sanitizedError.includes("test-token"), r.sanitizedError);
  }
});

await test("document send posts type:document with the uploaded media id", async () => {
  let seen: any = null;
  const fetchImpl = stubFetch((url, init) => {
    seen = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ messages: [{ id: "wamid.doc1" }] }), { status: 200 });
  });
  const r = await sendWhatsAppDocumentMessage({
    ...BASE,
    toWaId: "923001234567",
    mediaId: "123456789",
    filename: "Sunchaser-10kW-Quotation.pdf",
    caption: "Sunchaser 10kW quotation",
    fetchImpl,
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.providerMessageId, "wamid.doc1");
  assert.ok(seen.url.includes("/243825222156651/messages"), seen.url);
  assert.equal(seen.body.to, "923001234567");
  assert.equal(seen.body.type, "document");
  assert.equal(seen.body.document.id, "123456789");
  assert.equal(seen.body.document.filename, "Sunchaser-10kW-Quotation.pdf");
  assert.equal(seen.body.document.caption, "Sunchaser 10kW quotation");
  assert.ok(!JSON.stringify(seen.body).includes("test-token"));
});

await test("document send rejects malformed media ids without network", async () => {
  let calls = 0;
  const fetchImpl = stubFetch(() => {
    calls++;
    return new Response("{}", { status: 200 });
  });
  const r = await sendWhatsAppDocumentMessage({ ...BASE, toWaId: "923001234567", mediaId: "not-a-media-id!", filename: "x.pdf", fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(calls, 0);
});

await test("network failure classifies as timeout/network (caller marks outcome-unknown, never retries)", async () => {
  const fetchImpl = stubFetch(() => {
    throw new Error("socket hang up");
  });
  const up = await uploadWhatsAppMedia({ ...BASE, pdfBytes: PDF, filename: "x.pdf", fetchImpl });
  assert.equal(up.ok, false);
  if (!up.ok) assert.ok(up.kind === "timeout" || up.kind === "network", up.kind);
  const snd = await sendWhatsAppDocumentMessage({ ...BASE, toWaId: "923001234567", mediaId: "123456789", filename: "x.pdf", fetchImpl });
  assert.equal(snd.ok, false);
  if (!snd.ok) assert.ok(snd.kind === "timeout" || snd.kind === "network", snd.kind);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll WhatsApp Graph client tests passed.");
}
