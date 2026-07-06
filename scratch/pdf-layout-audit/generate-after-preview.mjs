#!/usr/bin/env node
/** Patch production preview HTML with fixed PDF shell CSS for local audit. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const beforePath = path.join(__dirname, "before-preview.html");
const afterPath = path.join(__dirname, "after-preview.html");

const { quotePdfShellCss } = await import("../../src/lib/quotePdfLayout.ts");

let html = fs.readFileSync(beforePath, "utf8");

const shellCss = quotePdfShellCss();
const pageFooterCss = `
        .page-footer {
          flex: 0 0 auto;
          margin-top: auto;
        }
`;

html = html.replace(
  /@page\s*\{[^}]*\}/,
  `@page { size: A4; margin: 20mm; }`
);

html = html.replace(
  /\.pages-container\s*\{[\s\S]*?\}\s*\.page\s*\{[\s\S]*?page-break-after:\s*always;\s*\}/,
  `${shellCss}`
);

html = html.replace(
  /\.page-footer\s*\{[^}]*\}/,
  pageFooterCss.trim()
);

html = html.replace(
  /class="page cover([^"]*)" style="[^"]*justify-content:\s*space-between[^"]*"/,
  'class="page cover$1" style="background: #ffffff; color: #0f172a;"'
);

html = html.replace(
  /margin-top: 40px/g,
  "margin-top: 16px"
);
html = html.replace(
  /margin-top: 35px/g,
  "margin-top: 20px"
);

fs.writeFileSync(afterPath, html);
console.log("Wrote", afterPath);
