import fs from 'node:fs';

const sourceRoot = process.env.OPENMAIC_SOURCE_DIR || '/src';
const routePath = `${sourceRoot}/app/api/generate/scene-outlines-stream/route.ts`;
let source = fs.readFileSync(routePath, 'utf8');

const heartbeatNeedle = `        try {
          startHeartbeat();

          const streamParams = visionImages?.length`;
const heartbeatReplacement = `        try {
          // Flush one byte immediately so Railway/CDN proxies establish the
          // SSE stream before a reasoning model produces its first token.
          controller.enqueue(encoder.encode(':connected\\n\\n'));
          startHeartbeat();

          const streamParams = visionImages?.length`;

const headersNeedle = `        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',`;
const headersReplacement = `        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',`;

if (!source.includes(heartbeatNeedle)) {
  throw new Error('Outline heartbeat patch target was not found');
}
if (!source.includes(headersNeedle)) {
  throw new Error('Outline SSE header patch target was not found');
}

source = source
  .replace(heartbeatNeedle, heartbeatReplacement)
  .replace(headersNeedle, headersReplacement);
fs.writeFileSync(routePath, source);


// HTTP/2 forbids Connection and other hop-by-hop headers. Remove this from
// PBL streaming too; the public Railway edge negotiates HTTP/2 with Chrome.
const pblSsePath = `${sourceRoot}/lib/pbl/v2/api/sse.ts`;
let pblSse = fs.readFileSync(pblSsePath, 'utf8');
const pblConnection = `      Connection: 'keep-alive',
      // Disable Nginx response buffering`;
if (!pblSse.includes(pblConnection)) {
  throw new Error('PBL SSE header patch target was not found');
}
pblSse = pblSse.replace(pblConnection, `      // Disable Nginx response buffering`);
fs.writeFileSync(pblSsePath, pblSse);
