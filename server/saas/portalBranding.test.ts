import test from "node:test";
import assert from "node:assert/strict";
import { isNeutralPortal, portalCompanyLabel, portalCompanyName, resolveGoogleReviewUrl, supportPhoneFromBranding, whatsAppHref } from "../../src/lib/clientPortalUi.ts";
import { personalise } from "../../src/lib/welcomeText.ts";
import { withOfficialBranding } from "../../src/lib/brandingAssets.ts";
import { NEUTRAL_BRANDING, DEFAULT_BRANDING } from "../../src/lib/branding.ts";

const ACME = { ...NEUTRAL_BRANDING, companyName: "Acme Solar", phoneNumbers: "0301 1112223, 0302 0000000", googleReviewUrl: "https://g.page/r/acme/review" };
const BARE = { ...NEUTRAL_BRANDING }; // a company that has set nothing yet

test("portal: a company's own name, phone and review link are used", () => {
  assert.equal(isNeutralPortal(ACME), true);
  assert.equal(portalCompanyName(ACME), "Acme Solar");
  assert.equal(supportPhoneFromBranding(ACME.phoneNumbers, ACME), "0301 1112223");
  assert.equal(resolveGoogleReviewUrl(ACME), "https://g.page/r/acme/review");
  assert.match(whatsAppHref(supportPhoneFromBranding(ACME.phoneNumbers, ACME), "Hello"), /^https:\/\/wa\.me\/923011112223\?text=Hello$/);
});

test("portal: a company that has set nothing is shown NOTHING of Sunchaser's - no name, no phone, no review link", () => {
  assert.equal(portalCompanyName(BARE), "");
  assert.equal(portalCompanyLabel(BARE), "your solar company");
  assert.equal(supportPhoneFromBranding(BARE.phoneNumbers, BARE), "", "no support phone, so the interface shows no call or WhatsApp button");
  assert.equal(resolveGoogleReviewUrl(BARE), "", "no review prompt");
  assert.equal(resolveGoogleReviewUrl({ legacyDefaults: false, googleReviewUrl: "not a link" }), "");
  const shown = withOfficialBranding(BARE);
  assert.equal(shown.legacyDefaults, false);
  assert.equal(shown.logoUrl, "", "no Sunchaser logo is substituted");
  assert.equal(shown.signatureUrl, "");
  assert.equal(shown.bankAccountsImageUrl, "");
});

test("portal: Sunchaser's own customers are unchanged (name, fallback phone, review fallback)", () => {
  const own = withOfficialBranding(DEFAULT_BRANDING);
  assert.equal(isNeutralPortal(own), false);
  assert.equal(portalCompanyName(own), DEFAULT_BRANDING.companyName || "Sunchaser Energy Systems");
  assert.equal(supportPhoneFromBranding("", own), "03090236666");
  assert.ok(resolveGoogleReviewUrl(own).startsWith("http"));
  assert.equal(supportPhoneFromBranding(undefined), "03090236666", "callers that pass no branding keep the old behaviour");
});

test("welcome guide: another company's people read their own company's name, never Sunchaser", () => {
  const texts = ["Welcome to Sunchaser Customer Portal", "Welcome to Sunchaser CRM", "Welcome to Sunchaser Field Portal", "Never share login credentials outside Sunchaser.", "Sunchaser Energy"];
  for (const name of ["Acme Solar", ""]) {
    for (const t of texts) assert.doesNotMatch(personalise(t, { neutral: true, name }), /sunchaser/i, `${JSON.stringify(name)}: ${t}`);
  }
  assert.equal(personalise("Welcome to Sunchaser Customer Portal", { neutral: true, name: "Acme Solar" }), "Welcome to Acme Solar Customer Portal");
  assert.equal(personalise("Welcome to Sunchaser Customer Portal", { neutral: true, name: "" }), "Welcome to the Customer Portal");
  assert.equal(personalise("Never share login credentials outside Sunchaser.", { neutral: true, name: "Acme Solar" }), "Never share login credentials outside Acme Solar.");
  for (const t of texts) assert.equal(personalise(t, { neutral: false, name: "" }), t, "Sunchaser's own people keep the existing wording");
});

test("no Sunchaser wording remains in the enabled customer portal components (a new one must be handled or listed here)", async () => {
  const fs = await import("node:fs");
  const dir = new URL("../../src/components/", import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => /^ClientPortal.*\.tsx$/.test(f));
  assert.ok(files.length > 15);
  // Warranty/after-sales screens are disabled for other companies (moduleGate.ts); the rest must not name Sunchaser except as the founding
  // company's fallback inside the helpers in src/lib/clientPortalUi.ts.
  const afterSalesOnly = new Set(["ClientPortalWarranties.tsx", "ClientPortalDeliveries.tsx"]);
  const offenders: string[] = [];
  for (const f of files) {
    if (afterSalesOnly.has(f)) continue;
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    src.split("\n").forEach((line, i) => {
      if (/sunchaser/i.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line) && !/portalCompanyName\(branding\) === "Sunchaser Energy Systems"|`Single \$\{|`The \$\{/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, []);
});
