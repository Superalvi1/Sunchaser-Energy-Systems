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
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',`;

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
