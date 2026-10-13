// Copies every object of one S3 stand-in's bucket directory into another stand-in over HTTPS (demo of the "bucket mirror" step).
// Production equivalent: `rclone sync` / `aws s3 sync` from the CRM bucket to a separate backup bucket with its own credentials.
// usage: node s3-mirror.mjs <source objects dir> <dest https://host:port> <bucket> <ca cert>
import fs from "node:fs";
import https from "node:https";
import { createHash } from "node:crypto";
const [dir, dest, bucket, ca] = process.argv.slice(2);
const types = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const agent = new https.Agent({ ca: fs.readFileSync(ca) });
let n = 0, bytes = 0;
for (const name of fs.readdirSync(dir)) {
  const key = decodeURIComponent(name);
  const body = fs.readFileSync(`${dir}/${name}`);
  const u = new URL(dest);
  const path = "/" + key.split("/").map(encodeURIComponent).join("/");
  await new Promise((resolve, reject) => {
    const req = https.request({ host: `${bucket}.${u.hostname}`, servername: `${bucket}.${u.hostname}`, port: u.port, path, method: "PUT", agent, headers: { "content-type": types[key.split(".").pop()] || "application/octet-stream", "content-length": body.length } }, (res) => { res.resume(); res.on("end", () => (res.statusCode === 200 ? resolve() : reject(new Error(`PUT ${res.statusCode}`)))); });
    req.on("error", reject); req.end(body);
  });
  n++; bytes += body.length;
  console.log(`mirrored ${key.slice(0, 60)} sha256=${createHash("sha256").update(body).digest("hex").slice(0, 8)}`);
}
console.log(`mirrored ${n} objects, ${bytes} bytes`);
