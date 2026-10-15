import assert from 'node:assert/strict';
import { openInvoicePrintPreview } from './quotePdfExport';

let opened = false;
let closed = false;
let written = '';
let requestUrl = '';
let authorization = '';
let status = 200;
let printed = false;
let blocked = false;
const preview = {
  opener: {},
  document: {
    open() {},
    write(html: string) { written = html; },
    close() {},
    readyState: 'complete',
    fonts: { ready: Promise.resolve() },
  },
  print() { printed = true; },
  close() { closed = true; },
};
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => key === 'sunchaser_auth_token' ? 'test-session-token' : null },
  window: { open() { opened = true; return blocked ? null : preview; } },
  fetch: async (url: string, init: RequestInit) => {
    assert.ok(opened, 'reserve popup before network await');
    requestUrl = url;
    authorization = new Headers(init.headers).get('Authorization') || '';
    return new Response(status === 200 ? '<html><body>Invoice</body></html>' : '{"error":"Unauthorized"}', { status });
  },
});
await openInvoicePrintPreview('inv/123');
assert.ok(requestUrl.endsWith('/api/export/pdf/invoice/inv%2F123'));
assert.ok(!requestUrl.includes('?'), 'no identity or token in URL');
assert.equal(authorization, 'Bearer test-session-token');
assert.match(written, /Invoice/);
assert.equal(preview.opener, null);
await new Promise(resolve => setTimeout(resolve, 250));
assert.ok(printed, 'open print/save PDF after authenticated HTML loads');
status = 401;
written = '';
await assert.rejects(openInvoicePrintPreview('inv-123'), /Unauthorized/);
assert.ok(closed, 'close empty popup on authorization failure');
assert.equal(written, '', 'never render an error response as an invoice');
blocked = true;
await assert.rejects(openInvoicePrintPreview('inv-123'), /Allow pop-ups/);
console.log('PASS invoice preview: authenticated fetch, safe URL, print, 401 cleanup, popup blocking');
