// Minimal S3-compatible HTTPS store for isolated tests: PUT/GET/DELETE with If-Match / If-None-Match.
// It does not verify request signatures, so it cannot prove real bucket credentials work.
import https from "node:https"; import fs from "node:fs"; import { createHash } from "node:crypto";
const store = new Map(); const dir = process.argv[2]; fs.mkdirSync(dir, { recursive: true });
const file = (k) => dir + "/" + encodeURIComponent(k);
https.createServer({ key: fs.readFileSync("key.pem"), cert: fs.readFileSync("cert.pem") }, (req, res) => {
  const key = decodeURIComponent(new URL(req.url, "https://x").pathname.slice(1));
  const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
    const meta = store.get(key);
    if (req.method === "PUT") {
      if (req.headers["if-none-match"] === "*" && meta) { res.writeHead(412); return res.end(); }
      if (req.headers["if-match"] && (!meta || meta.etag !== req.headers["if-match"])) { res.writeHead(412); return res.end(); }
      const body = Buffer.concat(chunks); const etag = '"' + createHash("md5").update(body).digest("hex") + '"';
      fs.writeFileSync(file(key), body); store.set(key, { etag, type: req.headers["content-type"] || "application/octet-stream" });
      console.log("PUT", key, body.length); res.writeHead(200, { ETag: etag }); return res.end();
    }
    if (req.method === "GET") { if (!meta) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": meta.type, ETag: meta.etag }); return res.end(fs.readFileSync(file(key))); }
    if (req.method === "DELETE") { store.delete(key); res.writeHead(204); return res.end(); }
    res.writeHead(405); res.end();
  });
}).listen(Number(process.env.S3_PORT || 9443), "127.0.0.1", () => console.log("s3 mock listening"));
