import assert from "node:assert/strict";
import { resolveCrmApiBaseUrl, NATIVE_CRM_API_ORIGIN } from "./apiBaseUrl.ts";

assert.equal(resolveCrmApiBaseUrl("localhost", "", true), NATIVE_CRM_API_ORIGIN);
assert.equal(resolveCrmApiBaseUrl("127.0.0.1", undefined, true), NATIVE_CRM_API_ORIGIN);
assert.equal(resolveCrmApiBaseUrl("localhost", "https://staging.example.org/", true), "https://staging.example.org");
assert.equal(resolveCrmApiBaseUrl("crm.sunchaserenergy.co", "", false), "");
assert.equal(resolveCrmApiBaseUrl("smartquote.sunchaserenergy.co", "", false), "");
assert.equal(resolveCrmApiBaseUrl("localhost", "", false), "");
assert.equal(resolveCrmApiBaseUrl("example.org", "https://api.example.org/", false), "https://api.example.org");
assert.equal(resolveCrmApiBaseUrl("legacy.example.org", "", false), "https://sunchaser-energy-systems.onrender.com");
console.log("Native CRM API routing tests passed.");
