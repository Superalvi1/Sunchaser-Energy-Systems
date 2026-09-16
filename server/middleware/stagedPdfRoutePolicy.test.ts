import assert from "node:assert/strict";
import { test } from "node:test";
import { isProtectedApiRoute, resolveRouteAccessPolicy } from "./routePolicy.ts";

const token = "11111111-2222-4333-8444-555555555555";
const download = `/api/export/pdf/staged-public/${token}`;

test("external browser GET reaches the token-validating PDF handler without a CRM JWT", () => {
  assert.equal(isProtectedApiRoute("GET", download), false);
  assert.equal(resolveRouteAccessPolicy("GET", download).kind, "public");
  assert.equal(isProtectedApiRoute("GET", download + "?download=1"), false);
});

test("other methods cannot bypass JWT or consume a token via HEAD", () => {
  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal(isProtectedApiRoute(method, download), true, method);
  }
});

test("missing, malformed, and nested token paths remain protected", () => {
  for (const path of [
    "/api/export/pdf/staged-public", "/api/export/pdf/staged-public/",
    "/api/export/pdf/staged-public/invalid", download + "/extra",
    download + "/", download.replace("/staged-public/", "/staged-public-other/"),
  ]) assert.equal(isProtectedApiRoute("GET", path), true, path);
});

test("PDF generation, saved quotes and CRM data still require JWT", () => {
  for (const path of [
    "/api/export/pdf/stage-saved-quote",
    "/api/export/pdf/manual-quote?stage=1",
    "/api/export/pdf/manual-quote/lead-1/download",
    "/api/export/pdf/auto-sizer/lead-1/download",
    "/api/export/pdf/template-preview/template-1/download",
    "/api/state", "/api/marketplace/admin/payments",
  ]) {
    for (const method of ["GET", "POST"]) {
      assert.equal(isProtectedApiRoute(method, path), true, method + " " + path);
    }
  }
});
