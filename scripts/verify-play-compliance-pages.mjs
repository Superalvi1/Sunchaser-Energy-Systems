#!/usr/bin/env node
/**
 * Verify the Google Play compliance pages are publicly reachable and are the real
 * static pages — not the CRM single-page-app shell.
 *
 * This distinction matters. vercel.json ends with a catch-all rewrite:
 *
 *     { "source": "/(.*)", "destination": "/" }
 *
 * so *every* path returns HTTP 200. A status-code-only check therefore passes for
 * URLs that actually render the CRM login app, which is exactly what a Play
 * reviewer would reject. Every assertion below checks content, and a nonsense
 * control URL proves the script can tell the two apart.
 *
 * Usage:
 *   node scripts/verify-play-compliance-pages.mjs
 *   node scripts/verify-play-compliance-pages.mjs --base https://crm.sunchaserenergy.co
 *   node scripts/verify-play-compliance-pages.mjs --no-compare-source
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = readFlag("base", "https://crm.sunchaserenergy.co").replace(/\/$/, "");
const COMPARE_SOURCE = !args.includes("--no-compare-source");
const TIMEOUT_MS = Number(readFlag("timeout", "30000"));

/** A path that must not exist, used to sample what the SPA fallback looks like. */
const CONTROL_PATH = "/__definitely-not-a-real-page-control__";

let failed = 0;
let passed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function fetchPage(path) {
  const url = `${BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      // No cookies, no auth headers: proves the page is reachable without login.
      headers: { "Cache-Control": "no-cache" },
    });
    const body = await res.text();
    return { url, status: res.status, ok: res.ok, body };
  } catch (err) {
    return { url, status: 0, ok: false, body: "", error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function titleOf(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : "";
}

/** Normalise for comparison: CDNs may alter whitespace/encoding slightly. */
const normalise = (s) => s.replace(/\r\n/g, "\n").trim();

/**
 * Tag-stripped, whitespace-collapsed text of a page. Content assertions run against
 * this as well as the raw HTML, so wording checks do not break when a phrase is
 * split by inline markup such as <strong>.
 */
const visibleText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

console.log(`Verifying Play compliance pages against ${BASE}\n`);

/* ── 0. Negative control ─────────────────────────────────────────────
   Establish what the SPA fallback looks like so later assertions are meaningful. */
const control = await fetchPage(CONTROL_PATH);
const controlTitle = titleOf(control.body);

console.log("── negative control ──");
console.log(`  ${CONTROL_PATH} -> HTTP ${control.status}, ${control.body.length} bytes, title="${controlTitle}"`);
check(
  "control path returns the SPA shell (proves catch-all rewrite is active)",
  control.status === 200 && control.body.length > 0,
  `expected a 200 SPA shell, got HTTP ${control.status}`
);
check(
  "control path is NOT a compliance page (script can distinguish them)",
  !/Account Deletion Request/i.test(control.body) && !/Privacy Policy<\/h1>/i.test(control.body),
  "control body unexpectedly contains compliance-page content"
);
console.log("");

const PAGES = [
  {
    label: "privacy policy",
    paths: ["/privacy-policy", "/privacy-policy/"],
    sourceFile: join(repoRoot, "public/privacy-policy/index.html"),
    expectedTitle: /Privacy Policy - Sunchaser CRM/i,
    mustContain: [
      ["policy heading", /<h1>\s*Privacy Policy\s*<\/h1>/i],
      ["account-deletion URL", /https:\/\/crm\.sunchaserenergy\.co\/account-deletion/i],
      ["location disclosure", /Device Location/i],
      ["location is intentional-use only", /only when you intentionally use a feature/i],
      ["no background tracking claim", /not track your location continuously/i],
      ["support contact", /support@sunchaserenergy\.co/i],
    ],
  },
  {
    label: "account deletion",
    paths: ["/account-deletion", "/account-deletion/"],
    sourceFile: join(repoRoot, "public/account-deletion/index.html"),
    expectedTitle: /Account Deletion Request - Sunchaser CRM/i,
    mustContain: [
      ["deletion heading", /<h1>\s*Account Deletion Request\s*<\/h1>/i],
      ["support contact", /support@sunchaserenergy\.co/i],
      ["android application id", /com\.sunchaser\.crm/i],
      ["company name", /Sunchaser Energy Systems/i],
      ["what is deleted", /What Is Deleted/i],
      ["what may be retained", /What May Be Retained/i],
      ["legal retention basis", /legal, accounting, tax, fraud-prevention, warranty, or contractual/i],
      ["not immediate", /not immediate/i],
      ["confirmation promised", /confirmation email/i],
      ["links back to privacy policy", /href="\/privacy-policy"/i],
    ],
  },
];

for (const page of PAGES) {
  console.log(`── ${page.label} ──`);

  let source = null;
  if (COMPARE_SOURCE) {
    try {
      source = readFileSync(page.sourceFile, "utf8");
    } catch {
      console.log(`  (source file not readable, skipping byte comparison: ${page.sourceFile})`);
    }
  }

  for (const path of page.paths) {
    const res = await fetchPage(path);
    console.log(`  ${path} -> HTTP ${res.status}, ${res.body.length} bytes, title="${titleOf(res.body)}"`);

    if (res.error) {
      check(`${page.label} ${path} reachable`, false, res.error);
      continue;
    }

    check(`${page.label} ${path} returns success`, res.ok, `HTTP ${res.status}`);

    // The decisive assertion: must not be the SPA shell.
    check(
      `${page.label} ${path} is NOT the CRM SPA shell`,
      res.body.length !== control.body.length && titleOf(res.body) !== controlTitle,
      `body matches the control shell (${res.body.length} bytes, title "${titleOf(res.body)}")`
    );

    check(
      `${page.label} ${path} has the expected title`,
      page.expectedTitle.test(titleOf(res.body)),
      `got "${titleOf(res.body)}"`
    );

    const text = visibleText(res.body);
    for (const [what, pattern] of page.mustContain) {
      check(
        `${page.label} ${path} contains ${what}`,
        pattern.test(res.body) || pattern.test(text)
      );
    }

    if (source) {
      check(
        `${page.label} ${path} matches the source static file byte-for-byte`,
        normalise(res.body) === normalise(source),
        `served ${res.body.length} bytes vs source ${source.length} bytes (deploy may be stale)`
      );
    }
  }
  console.log("");
}

console.log("─".repeat(60));
console.log(`${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error("\nPlay compliance page verification FAILED.");
  process.exit(1);
}
console.log("\nAll Play compliance page checks passed.");
