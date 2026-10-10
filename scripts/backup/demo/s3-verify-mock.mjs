// Minimal S3 stand-in that VERIFIES AWS Signature V4 and applies per-credential bucket/method policy. For isolated tests only.
// It exists to prove that pg-backup.sh's curl --aws-sigv4 uploads are correctly signed and that backup credentials are separate from
// the CRM bucket credentials. It is not a complete S3 implementation (no LIST, no multipart, path-style only).
// usage: S3V_PORT=9525 node s3-verify-mock.mjs <objects dir> <cert dir containing key.pem + cert.pem>   (credentials via env, see below)
import https from "node:https";
import fs from "node:fs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const [dir, certDir] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
// access key -> { secret, bucket, methods }   (secrets come from the environment so none are written to disk or the repo)
const creds = {
  [process.env.S3V_BACKUP_AK]: { secret: process.env.S3V_BACKUP_SK, bucket: "sc-backups", methods: ["PUT", "GET", "HEAD"] },
  [process.env.S3V_CRM_AK]: { secret: process.env.S3V_CRM_SK, bucket: "testbucket", methods: ["PUT", "GET", "HEAD", "DELETE"] },
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
const hmac = (k, v) => createHmac("sha256", k).update(v).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

https.createServer({ key: fs.readFileSync(`${certDir}/key.pem`), cert: fs.readFileSync(`${certDir}/cert.pem`) }, (req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const fail = (status, code, msg) => { console.log(`${req.method} ${req.url.slice(0, 70)} -> ${status} ${code}`); res.writeHead(status, { "content-type": "application/xml" }); res.end(`<Error><Code>${code}</Code><Message>${msg}</Message></Error>`); };
    const auth = String(req.headers.authorization || "");
    const m = auth.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/);
    if (!m) return fail(403, "AccessDenied", "missing or malformed Authorization");
    const [, ak, date, region, signedHeaders, signature] = m;
    const cred = creds[ak];
    if (!cred) return fail(403, "InvalidAccessKeyId", "unknown access key");
    const amzDate = String(req.headers["x-amz-date"] || "");
    if (!/^\d{8}T\d{6}Z$/.test(amzDate) || amzDate.slice(0, 8) !== date) return fail(403, "AccessDenied", "bad x-amz-date");
    const skew = Math.abs(Date.now() - Date.parse(amzDate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z")));
    if (skew > 15 * 60 * 1000) return fail(403, "RequestTimeTooSkewed", "clock skew");
    const url = new URL(req.url, "https://x");
    const canonicalUri = url.pathname.split("/").map((seg) => enc(decodeURIComponent(seg))).join("/");
    const query = [...url.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort().map(([k, v]) => `${k}=${v}`).join("&");
    const headerNames = signedHeaders.split(";");
    const canonicalHeaders = headerNames.map((h) => `${h}:${String(req.headers[h] ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
    const payloadHash = String(req.headers["x-amz-content-sha256"] || "UNSIGNED-PAYLOAD");
    const canonical = [req.method, canonicalUri, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const sts = ["AWS4-HMAC-SHA256", amzDate, `${date}/${region}/s3/aws4_request`, sha(canonical)].join("\n");
    const key = hmac(hmac(hmac(hmac("AWS4" + cred.secret, date), region), "s3"), "aws4_request");
    const expected = hmac(key, sts).toString("hex");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return fail(403, "SignatureDoesNotMatch", "the request signature does not match");
    if (!headerNames.includes("host") || !headerNames.includes("x-amz-date")) return fail(403, "AccessDenied", "host and x-amz-date must be signed");
    if (payloadHash !== "UNSIGNED-PAYLOAD" && req.method === "PUT" && sha(body) !== payloadHash) return fail(400, "XAmzContentSHA256Mismatch", "body hash differs from x-amz-content-sha256");
    const [, bucket, ...rest] = decodeURIComponent(url.pathname).split("/");
    const objectKey = rest.join("/");
    if (bucket !== cred.bucket) return fail(403, "AccessDenied", "this credential has no access to that bucket");
    if (!cred.methods.includes(req.method)) return fail(403, "AccessDenied", `${req.method} is not permitted for this credential`);
    const file = `${dir}/${encodeURIComponent(bucket + "/" + objectKey)}`;
    if (req.method === "PUT") { fs.writeFileSync(file, body); console.log(`PUT ${bucket}/${objectKey} ${body.length}B sig-ok`); res.writeHead(200, { ETag: `"${createHash("md5").update(body).digest("hex")}"` }); return res.end(); }
    if (!fs.existsSync(file)) return fail(404, "NoSuchKey", "not found");
    const data = fs.readFileSync(file);
    console.log(`${req.method} ${bucket}/${objectKey} ${data.length}B sig-ok`);
    res.writeHead(200, { "content-length": data.length });
    return res.end(req.method === "HEAD" ? undefined : data);
  });
}).listen(Number(process.env.S3V_PORT || 9525), "127.0.0.1", () => console.log("signature-verifying s3 stand-in listening"));
