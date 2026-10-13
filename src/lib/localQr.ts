import qrcode from "qrcode-generator";

/**
 * QR codes are generated here, in the process that renders the page. Nothing is sent to a third-party service, so the text of a QR
 * (invoice number, amounts, verification links) never leaves the company's own server or the browser.
 */
// The library's default byte encoding is ISO-8859-1, which cannot hold Urdu or accented company names; QR readers expect UTF-8.
const utf8 = new TextEncoder();
qrcode.stringToBytes = (text: string) => Array.from(utf8.encode(text));

export function qrSvg(text: string, opts: { size?: number } = {}): string {
  const size = opts.size && opts.size > 0 ? Math.round(opts.size) : 140;
  const qr = qrcode(0, "M"); // type 0 = smallest version that fits the text
  qr.addData(String(text ?? ""), "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4; // quiet zone, in modules (QR specification)
  const total = n + quiet * 2;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/** An <img src> value for the QR of `text` (a data: URI, no network request). */
export function qrDataUri(text: string, size = 140): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text, { size }))}`;
}
