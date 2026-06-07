/**
 * Phase 14A local verification (no Supabase required for code normalization).
 * Run: node scripts/verify-customer-invitation-local.mjs
 */

function normalizeCustomerCode(input) {
  let s = String(input || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  const match = s.match(/^SES-?(\d{6})$/);
  if (!match) return null;
  return `SES-${match[1]}`;
}

const cases = [
  ["SES-483921", "SES-483921"],
  ["ses483921", "SES-483921"],
  [" SES-123456 ", "SES-123456"],
  ["SES123456", "SES-123456"],
  ["INVALID", null],
  ["SES-12", null],
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = normalizeCustomerCode(input);
  if (got !== expected) {
    console.error("FAIL", input, "expected", expected, "got", got);
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed} normalization test(s) failed.`);
  process.exit(1);
}

console.log("OK: customer code normalization (6 cases)");
console.log("Manual checks:");
console.log("  1. Run scripts/customer-invitation-schema.sql in Supabase SQL Editor");
console.log("  2. Create CRM lead → customer_code on customers row");
console.log("  3. Register with valid code → link, no duplicate customer");
console.log("  4. Register with invalid code → error, no user/customer created");
console.log("  5. Register blank code + matching phone → link existing");
console.log("  6. Admin → Manual Admin → Account Linking tab");
