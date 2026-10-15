/**
 * Restricts Moos to one explicitly approved test recipient in staging.
 * When MOOS_TEST_ONLY_RECIPIENT_E164 is set, invalid values fail closed.
 * Not a public recipient configuration; keep the number in Railway variables.
 */
function pakistanPhoneDigits(value: unknown): string | null {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0092")) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = "92" + digits.slice(1);
  if (!/^923[0-9]{9}$/.test(digits)) return null;
  return digits;
}
export function moosTestRecipientAllowed(
  phone: unknown,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const scoped = String(env.MOOS_TEST_ONLY_RECIPIENT_E164 ?? "").trim();
  if (!scoped) return true;
  const approved = pakistanPhoneDigits(scoped);
  return approved !== null && pakistanPhoneDigits(phone) === approved;
}
