/**
 * Muse AI restricted-pilot recipient check.
 * CRM enforces its own independent check at every outbound action.
 * The worker also rejects any out-of-scope signed relay.
 */
function digitsOf(value) {
  let x = String(value ?? "").replace(/\D/g, "");
  if (x.startsWith("0092")) x = x.slice(2);
  else if (x.startsWith("0") && x.length === 11) x = "92" + x.slice(1);
  return /^923\d{9}$/.test(x) ? x : null;
}
export function pilotRecipientAllowed(phone, env = process.env) {
  const approved = String(env.MOOS_TEST_ONLY_RECIPIENT_E164 ?? "").trim();
  const required = env.NODE_ENV === "production" ||
    /^(true|1|yes)$/i.test(String(env.MOOS_PILOT_SCOPE_REQUIRED || ""));
  if (!approved) return !required;
  const expected = digitsOf(approved);
  return Boolean(expected && digitsOf(phone) === expected);
}
