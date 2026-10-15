import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import jsQR from "jsqr";
import { qrSvg, qrDataUri } from "../../src/lib/localQr.ts";
import { qrCodeImageUrl } from "../../src/lib/deliveryQr.ts";
import { googleReviewQrImageUrl } from "../../src/lib/clientPortalReviewTracking.ts";

/** Rasterises the module path of our own SVG (no browser) and decodes it with an independent QR reader. */
function decode(svg: string): string | null {
  const vb = /viewBox="0 0 (\d+) \d+"/.exec(svg)!;
  const total = Number(vb[1]);
  const scale = 6;
  const px = total * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const m of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x0 = Number(m[1]) * scale, y0 = Number(m[2]) * scale;
    for (let y = y0; y < y0 + scale; y++) for (let x = x0; x < x0 + scale; x++) {
      const i = (y * px + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return jsQR(data, px, px)?.data ?? null;
}

test("the QR decodes to exactly the text it was given (invoice text, verification link, non-ASCII)", () => {
  for (const text of [
    "Acme Solar\nInvoice: INV-2026-0007\nTotal: 1,250,000\nBalance: 250,000\nDue: 31 Dec 2026",
    "https://crm.example.test/delivery/verify/abc123DEF-456_xyz",
    "Zürich — سولر",
  ]) assert.equal(decode(qrSvg(text, { size: 200 })), text);
});

test("the QR is a local data: URI; no helper builds a third-party URL", () => {
  for (const u of [qrDataUri("x"), qrCodeImageUrl("https://a.test/b", 160), googleReviewQrImageUrl("https://g.test/r")]) {
    assert.ok(u.startsWith("data:image/svg+xml"), u.slice(0, 40));
    assert.ok(!/https?:\/\//.test(decodeURIComponent(u).replace(/^data:[^,]*,/, "").replace(/xmlns="[^"]*"/, "")) , "no remote reference inside the image");
  }
});

test("no source file builds a QR through a third-party service", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist", "docs", "android", "ios"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|js|html)$/.test(e.name) && !p.endsWith("localQr.test.ts") && !p.endsWith("verify-delivery-qr-whatsapp.mjs")) {
        if (/api\.qrserver\.com|chart\.googleapis\.com\/chart\?.*cht=qr/.test(fs.readFileSync(p, "utf8"))) bad.push(path.relative(root, p));
      }
    }
  };
  walk(root);
  assert.deepEqual(bad, []);
});
