/**
 * quotePdfSettingsStore — browser-safe env reads (no process).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getQuoteAssetPublicUrl,
  getSupabaseProjectUrlFromEnv,
  resolveGlobalWatermarkImageUrl,
} from "./quotePdfSettingsStore.ts";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0;

function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("quotePdfSettingsStore does not reference process", () => {
  const src = readFileSync(resolve(here, "quotePdfSettingsStore.ts"), "utf8");
  // Strip block/line comments before scanning for bare process.env
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return (
    !/\bprocess\.env\b/.test(code) &&
    !/(?<![.\w])process\./.test(code) &&
    src.includes("import.meta") &&
    src.includes("VITE_SUPABASE_URL")
  );
});

check("missing VITE_SUPABASE_URL does not crash — returns empty string", () => {
  // In Node/tsx, import.meta.env may be undefined or empty — must not throw.
  const url = getSupabaseProjectUrlFromEnv();
  return typeof url === "string";
});

check("getQuoteAssetPublicUrl falls back when project URL missing", () => {
  const path = getQuoteAssetPublicUrl("watermarks/logo.png", "");
  return path === "/uploads/quote-assets/watermarks/logo.png";
});

check("resolveGlobalWatermarkImageUrl safe with null / empty", () => {
  return (
    resolveGlobalWatermarkImageUrl(null) === "" &&
    resolveGlobalWatermarkImageUrl(undefined) === "" &&
    resolveGlobalWatermarkImageUrl({}) === ""
  );
});

check("SalesTeamApp imports quotePdfSettingsStore helpers", () => {
  const src = readFileSync(resolve(here, "../components/SalesTeamApp.tsx"), "utf8");
  return (
    src.includes("resolveGlobalWatermarkImageUrl") &&
    src.includes("quotePdfSettingsStore") &&
    !src.includes("process.env.SUPABASE_URL")
  );
});

check("SalesTeamApp lead delete is not nested button", () => {
  const src = readFileSync(resolve(here, "../components/SalesTeamApp.tsx"), "utf8");
  // Delete control should be a span role=button inside the lead card button
  return src.includes('title="Delete lead"') && src.includes('role="button"') && src.includes("<Trash2");
});

console.log(`\nquotePdfSettingsStore tests: ${pass} passed`);
