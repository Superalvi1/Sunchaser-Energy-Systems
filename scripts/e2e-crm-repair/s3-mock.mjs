// Minimal S3-compatible HTTPS store for isolated tests: PUT/GET/DELETE with If-Match / If-None-Match, and ListObjectsV2 (prefix, max-keys, continuation-token).
// It does not verify request signatures, so it cannot prove real bucket credentials work.
// Fault injection for tests: if a file named "fault" exists NEXT TO the objects directory, its first line chooses the failure:
//   list    listings answer 503 (reads and writes still work)      put     writes answer 503      all     every request answers 503
//   hang    listings never answer (the caller must time out)       puthang  writes never answer (the caller waits, or is killed mid-write)
//   (no file / anything else: normal)
import https from "node:https"; import fs from "node:fs"; import { createHash } from "node:crypto";
const store = new Map(); const dir = process.argv[2]; fs.mkdirSync(dir, { recursive: true });
// Objects survive a restart of the mock: the index is rebuilt from the files already on disk.
for (const f of fs.readdirSync(dir)) { const body = fs.readFileSync(dir + "/" + f); store.set(decodeURIComponent(f), { etag: '"' + createHash("md5").update(body).digest("hex") + '"', type: "application/octet-stream" }); }
const file = (k) => dir + "/" + encodeURIComponent(k);
https.createServer({ key: fs.readFileSync("key.pem"), cert: fs.readFileSync("cert.pem") }, (req, res) => {
  const u = new URL(req.url, "https://x");
  const key = decodeURIComponent(u.pathname.slice(1));
  const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
    let fault = ""; try { fault = fs.readFileSync(dir + "/../fault", "utf8").split("\n")[0].trim(); } catch { /* no fault */ }
    const isList = req.method === "GET" && u.searchParams.get("list-type") === "2";
    if (fault === "all" || (fault === "list" && isList) || (fault === "put" && req.method === "PUT")) { res.writeHead(503); return res.end("injected fault"); }
    if (fault === "hang" && isList) return; // never answers
    if (fault === "puthang" && req.method === "PUT") return; // never answers: the writer is stuck mid-upload
    if (req.method === "GET" && u.searchParams.get("list-type") === "2") {
      const prefix = u.searchParams.get("prefix") || ""; const max = Number(u.searchParams.get("max-keys") || 1000); const after = u.searchParams.get("continuation-token") || "";
      const all = [...store.keys()].filter((k) => k.startsWith(prefix) && k > after).sort(); const page = all.slice(0, max); const more = all.length > page.length;
      const esc = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>testbucket</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${more}</IsTruncated>` + (more ? `<NextContinuationToken>${esc(page[page.length - 1])}</NextContinuationToken>` : "") + page.map((k) => `<Contents><Key>${esc(k)}</Key><Size>${fs.statSync(file(k)).size}</Size><ETag>${esc(store.get(k).etag)}</ETag></Contents>`).join("") + `</ListBucketResult>`;
      res.writeHead(200, { "Content-Type": "application/xml" }); return res.end(body);
    }
    const meta = store.get(key);
    if (req.method === "PUT") {
      if (req.headers["if-none-match"] === "*" && meta) { res.writeHead(412); return res.end(); }
      if (req.headers["if-match"] && (!meta || meta.etag !== req.headers["if-match"])) { res.writeHead(412); return res.end(); }
      const body = Buffer.concat(chunks); const etag = '"' + createHash("md5").update(body).digest("hex") + '"';
      fs.writeFileSync(file(key), body); store.set(key, { etag, type: req.headers["content-type"] || "application/octet-stream" });
      console.log("PUT", key, body.length); res.writeHead(200, { ETag: etag }); return res.end();
    }
    if (req.method === "GET") { if (!meta) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": meta.type, ETag: meta.etag }); return res.end(fs.readFileSync(file(key))); }
    if (req.method === "DELETE") { store.delete(key); fs.rmSync(file(key), { force: true }); res.writeHead(204); return res.end(); }
    res.writeHead(405); res.end();
  });
}).listen(Number(process.env.S3_PORT || 9443), "127.0.0.1", () => console.log("s3 mock listening"));
