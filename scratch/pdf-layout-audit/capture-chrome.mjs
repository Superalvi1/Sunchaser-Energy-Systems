#!/usr/bin/env node
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function capture(label, htmlFile) {
  const fileUrl = `file://${htmlFile}`;
  const pdfOut = path.join(__dirname, `${label}.pdf`);
  const pngOut = path.join(__dirname, `${label}-full.png`);

  const pdfArgs = [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfOut}`,
    fileUrl,
  ];
  const shotArgs = [
    "--headless=new",
    "--disable-gpu",
    `--screenshot=${pngOut}`,
    "--window-size=794,1123",
    "--default-background-color=FFFFFFFF",
    fileUrl,
  ];

  for (const args of [pdfArgs, shotArgs]) {
    const r = spawnSync(CHROME, args, { encoding: "utf8" });
    if (r.status !== 0) {
      console.error(label, r.stderr || r.stdout);
      return false;
    }
  }
  console.log(`${label}: ${pdfOut} (${fs.statSync(pdfOut).size} bytes), ${pngOut}`);
  return true;
}

const before = path.join(__dirname, "before-preview.html");
const after = path.join(__dirname, "after-preview.html");
let ok = capture("before-fix", before);
ok &= capture("after-fix", after);
process.exit(ok ? 0 : 1);
