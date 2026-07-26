/**
 * Shared semantic-equality helpers for SYNC-14C-A name_source check constraints.
 * Mirrors the SQL pack's fail-closed rules. No database I/O.
 */

export const FORWARD_ALLOW_LIST = Object.freeze([
  "manual",
  "phone",
  "whatsapp_legacy",
  "whatsapp_push",
  "whatsapp_saved",
  "whatsapp_short",
  "whatsapp_verified",
]);

export const ROLLBACK_ALLOW_LIST = Object.freeze([
  "manual",
  "phone",
  "whatsapp_push",
  "whatsapp_saved",
  "whatsapp_short",
]);

/**
 * @param {string | null | undefined} def pg_get_constraintdef(...) text
 * @returns {{ ok: false, reason: string } | { ok: true, values: string[], allowsNull: true }}
 */
export function parseNameSourceAllowList(def) {
  if (def == null || typeof def !== "string" || def.trim() === "") {
    return { ok: false, reason: "missing constraint definition" };
  }

  const defNorm = def.toLowerCase();

  if (!/\bcheck\s*\(/.test(defNorm)) {
    return { ok: false, reason: "not a CHECK constraint definition" };
  }

  if (!/name_source\s+is\s+null/.test(defNorm)) {
    return { ok: false, reason: "NULL name_source not explicitly allowed" };
  }

  const hasAnyArray = /name_source\s*=\s*any\s*\(\s*array\s*\[/.test(defNorm);
  const hasIn = /name_source\s+in\s*\(/.test(defNorm);
  if (!hasAnyArray && !hasIn) {
    return { ok: false, reason: "allow-list form not IN(...) or = ANY(ARRAY[...])" };
  }

  if (
    /\bor\s+true\b/.test(defNorm) ||
    /=\s*true\b/.test(defNorm) ||
    /\bsimilar\s+to\b/.test(defNorm) ||
    /\slike\s/.test(defNorm) ||
    /~/.test(defNorm) ||
    /\bin\s*\(\s*select\b/.test(defNorm)
  ) {
    return { ok: false, reason: "untrusted widening constructs present" };
  }

  const values = [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (values.length === 0) {
    return { ok: false, reason: "no quoted allow-list values found" };
  }

  const uniqueSorted = [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return { ok: true, values: uniqueSorted, allowsNull: true };
}

/**
 * Exact semantic equality: NULL allowed + exact value set + optionally validated.
 * @param {string | null | undefined} def
 * @param {readonly string[]} expectedSorted
 * @param {{ validated?: boolean, requireValidated?: boolean }} [opts]
 */
export function constraintMatchesAllowList(def, expectedSorted, opts = {}) {
  const parsed = parseNameSourceAllowList(def);
  if (!parsed.ok) {
    return { equal: false, reason: parsed.reason };
  }

  const expected = [...expectedSorted].sort((a, b) => a.localeCompare(b));
  const sameLength = parsed.values.length === expected.length;
  const sameValues =
    sameLength && parsed.values.every((v, i) => v === expected[i]);
  if (!sameValues) {
    return {
      equal: false,
      reason: `allow-list mismatch: got [${parsed.values.join(", ")}] want [${expected.join(", ")}]`,
    };
  }

  if (opts.requireValidated && opts.validated !== true) {
    return { equal: false, reason: "constraint not validated (convalidated=false)" };
  }

  return { equal: true, reason: "exact allow-list match" };
}

/**
 * Decision helper mirroring forward/rollback fail-closed promotion rules.
 * @param {'forward'|'rollback'} mode
 * @param {{
 *   canonicalDef?: string | null,
 *   canonicalValidated?: boolean,
 *   tempDef?: string | null,
 *   tempValidated?: boolean,
 *   tempName?: string,
 * }} state
 */
export function decideConstraintAction(mode, state) {
  const expected =
    mode === "forward" ? FORWARD_ALLOW_LIST : ROLLBACK_ALLOW_LIST;
  const tempLabel = state.tempName || (mode === "forward" ? "v14c" : "rollback");

  if (state.tempDef != null && state.tempDef !== "") {
    const tempMatch = constraintMatchesAllowList(state.tempDef, expected, {
      requireValidated: false,
    });
    if (!tempMatch.equal) {
      return {
        action: "STOP",
        reason: `mismatched temporary ${tempLabel}: ${tempMatch.reason}`,
      };
    }
  }

  const canonicalExact = constraintMatchesAllowList(state.canonicalDef, expected, {
    requireValidated: true,
    validated: state.canonicalValidated === true,
  });

  if (canonicalExact.equal && (state.tempDef == null || state.tempDef === "")) {
    return { action: "NOOP", reason: "canonical exact and validated" };
  }

  if (canonicalExact.equal && state.tempDef) {
    // temp already proven exact above
    return {
      action: "CLEANUP_TEMP",
      reason: "canonical exact; drop proven temporary leftover",
    };
  }

  // Unvalidated but exact definition: validate in place when no rebuild needed
  const canonicalDefExact = constraintMatchesAllowList(state.canonicalDef, expected, {
    requireValidated: false,
  });
  if (
    canonicalDefExact.equal &&
    state.canonicalValidated !== true &&
    (state.tempDef == null || state.tempDef === "")
  ) {
    return {
      action: "VALIDATE_CANONICAL",
      reason: "canonical definition exact but convalidated=false",
    };
  }

  if (state.tempDef) {
    return {
      action: "PROMOTE_TEMP",
      reason: "promote proven temporary (validate if needed, swap canonical)",
      tempValidated: state.tempValidated === true,
    };
  }

  return {
    action: "REBUILD",
    reason: canonicalDefExact.equal
      ? "rebuild required"
      : `rebuild: ${canonicalDefExact.reason || "canonical not exact"}`,
  };
}
