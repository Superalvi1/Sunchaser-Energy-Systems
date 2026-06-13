import { sanitizeQuoteEditorHtml } from "../src/lib/quoteAuthoring.ts";

const dirty =
  '<p style="text-decoration:underline;font-family:Times New Roman;background:yellow"><a href="http://x.com">linked</a> text</p>';
const clean = sanitizeQuoteEditorHtml(dirty);

const checks: Array<[boolean, string]> = [
  [!/text-decoration:\s*underline/i.test(clean), "strip underline"],
  [!/Times New Roman/i.test(clean), "strip font-family"],
  [!(/<a[\s>]/i.test(clean)), "unwrap anchor"],
  [clean.includes("linked") && clean.includes("text"), "keep text"],
];

for (const [ok, name] of checks) {
  console.log(ok ? `OK:${name}` : `FAIL:${name}`);
}
process.exit(checks.every(([ok]) => ok) ? 0 : 1);
