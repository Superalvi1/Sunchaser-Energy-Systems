/**
 * Complete-predicate equality helpers for SYNC-14C-A-R2/R3.
 *
 * SQL migrations prove equality via PostgreSQL pg_constraint.conbin against an
 * ephemeral exact reference constraint created in the current DO block. This
 * module mirrors that fail-closed posture for static/bypass tests (no database
 * I/O). R3: pre-existing reference names and non-CHECK name collisions STOP;
 * never silently drop unknown same-name objects.
 */

export const FORWARD_REF_NAME = "whatsapp_contacts_name_source_check_ref_fwd";
export const ROLLBACK_REF_NAME = "whatsapp_contacts_name_source_check_ref_rb";
export const CANONICAL_NAME = "whatsapp_contacts_name_source_check";
export const FORWARD_TEMP_NAME = "whatsapp_contacts_name_source_check_v14c";
export const ROLLBACK_TEMP_NAME = "whatsapp_contacts_name_source_check_rollback";

export const FORWARD_ALLOW_LIST = Object.freeze([
  "manual",
  "whatsapp_verified",
  "whatsapp_saved",
  "whatsapp_legacy",
  "whatsapp_push",
  "whatsapp_short",
  "phone",
]);

export const ROLLBACK_ALLOW_LIST = Object.freeze([
  "manual",
  "whatsapp_saved",
  "whatsapp_push",
  "whatsapp_short",
  "phone",
]);

/** Authoring form used in ADD CONSTRAINT (SQL pack). */
export function authoringCheckSql(values) {
  const list = values.map((v) => `        '${v}'`).join(",\n");
  return (
    "check (\n" +
    "        name_source is null\n" +
    "        or name_source in (\n" +
    `${list}\n` +
    "        )\n" +
    "      )"
  );
}

/**
 * Typical pg_get_expr(conbin, conrelid) / pg_get_constraintdef normalized form
 * for the authoring IN-list above (PostgreSQL rewrites IN → = ANY(ARRAY[...])).
 */
export function pgNormalizedExpr(values) {
  const list = values.map((v) => `'${v}'::text`).join(", ");
  return `(name_source IS NULL) OR (name_source = ANY (ARRAY[${list}]))`;
}

export function pgNormalizedConstraintdef(values) {
  return `CHECK (${pgNormalizedExpr(values)})`;
}

function collapseWs(s) {
  return s.replace(/\s+/g, " ").trim();
}

function stripCheckWrapper(s) {
  const t = collapseWs(s);
  const m = /^CHECK\s*\((.*)\)$/i.exec(t);
  return m ? collapseWs(m[1]) : t;
}

/**
 * Complete predicate proof (static stand-in for conbin equality).
 * Accepts only the exact forward/rollback reference predicates.
 *
 * @param {string | null | undefined} defOrExpr
 * @param {'forward'|'rollback'} mode
 */
export function isCompletePredicateProven(defOrExpr, mode) {
  if (defOrExpr == null || typeof defOrExpr !== "string" || defOrExpr.trim() === "") {
    return { proven: false, reason: "missing predicate" };
  }

  const values = mode === "forward" ? FORWARD_ALLOW_LIST : ROLLBACK_ALLOW_LIST;
  const candidates = [
    collapseWs(pgNormalizedExpr(values)),
    collapseWs(pgNormalizedConstraintdef(values)),
    collapseWs(authoringCheckSql(values)),
    // Single-line authoring variant
    collapseWs(
      `CHECK (name_source IS NULL OR name_source IN (${values
        .map((v) => `'${v}'`)
        .join(", ")}))`
    ),
  ];

  const normalized = collapseWs(defOrExpr);
  const asExpr = stripCheckWrapper(defOrExpr);

  for (const c of candidates) {
    if (normalized === c || asExpr === stripCheckWrapper(c) || asExpr === c) {
      return { proven: true, reason: "complete predicate matches reference" };
    }
  }

  // Explicit rejection hints for common bypasses (still fail-closed).
  const lower = normalized.toLowerCase();
  if (/\band\b/.test(lower) && /name_source\s+is\s+null/.test(lower)) {
    return { proven: false, reason: "additional AND predicate present" };
  }
  if (/is\s+not\s+null/.test(lower)) {
    return { proven: false, reason: "IS NOT NULL / widening OR present" };
  }
  if (!/\bname_source\b/.test(lower)) {
    return { proven: false, reason: "name_source column missing from predicate" };
  }
  if (
    /\b(profile_name|phone_e164|wa_jid|company_id)\b/.test(lower) &&
    /\bis\s+null\b/.test(lower)
  ) {
    return { proven: false, reason: "predicate references another column" };
  }
  if (/\b(lower|upper|coalesce|nullif|btrim|trim|substring)\s*\(/.test(lower)) {
    return { proven: false, reason: "function/expression wrapper present" };
  }

  return { proven: false, reason: "predicate does not equal complete reference" };
}

/**
 * @param {string | null | undefined} defOrExpr
 * @param {'forward'|'rollback'} mode
 * @param {{ validated?: boolean, requireValidated?: boolean }} [opts]
 */
export function constraintCompleteMatch(defOrExpr, mode, opts = {}) {
  const proof = isCompletePredicateProven(defOrExpr, mode);
  if (!proof.proven) {
    return { equal: false, reason: proof.reason };
  }
  if (opts.requireValidated && opts.validated !== true) {
    return { equal: false, reason: "constraint not validated (convalidated=false)" };
  }
  return { equal: true, reason: "complete predicate proven" };
}

/**
 * Decision helper mirroring SQL conbin-proof actions.
 * Proven flags must come from complete predicate / conbin equality — never
 * from set-only or partial substring checks.
 *
 * @param {'forward'|'rollback'} mode
 * @param {{
 *   canonicalProven?: boolean,
 *   canonicalValidated?: boolean,
 *   tempProven?: boolean,
 *   tempPresent?: boolean,
 *   tempName?: string,
 * }} state
 */
export function decideConstraintAction(mode, state) {
  const tempLabel = state.tempName || (mode === "forward" ? "v14c" : "rollback");
  const tempPresent = state.tempPresent === true;

  if (tempPresent && state.tempProven !== true) {
    return {
      action: "STOP",
      reason: `mismatched temporary ${tempLabel}: complete predicate not proven`,
    };
  }

  const canonicalReady =
    state.canonicalProven === true && state.canonicalValidated === true;

  if (canonicalReady && !tempPresent) {
    return { action: "NOOP", reason: "canonical complete predicate proven and validated" };
  }

  if (canonicalReady && tempPresent && state.tempProven === true) {
    return {
      action: "CLEANUP_TEMP",
      reason: "canonical proven; drop proven temporary leftover",
    };
  }

  if (
    state.canonicalProven === true &&
    state.canonicalValidated !== true &&
    !tempPresent
  ) {
    return {
      action: "VALIDATE_CANONICAL",
      reason: "canonical complete predicate proven but convalidated=false",
    };
  }

  if (tempPresent && state.tempProven === true) {
    return {
      action: "PROMOTE_TEMP",
      reason: "promote temporary with proven complete predicate",
    };
  }

  return {
    action: "REBUILD",
    reason: "complete predicate not proven for canonical; rebuild exact reference",
  };
}

/**
 * R3 name-collision gate. Mirrors SQL: pre-existing reference names and
 * non-CHECK occupants of canonical/temporary names must STOP; never drop.
 *
 * @param {{
 *   forwardRefExists?: boolean,
 *   rollbackRefExists?: boolean,
 *   canonicalContype?: string | null,
 *   tempContype?: string | null,
 *   mode?: 'forward'|'rollback'|'post-verify',
 * }} state
 */
export function decideNameCollision(state = {}) {
  if (state.forwardRefExists === true) {
    return {
      action: "STOP",
      reason: `reference constraint name ${FORWARD_REF_NAME} already exists`,
    };
  }
  if (state.rollbackRefExists === true) {
    return {
      action: "STOP",
      reason: `reference constraint name ${ROLLBACK_REF_NAME} already exists`,
    };
  }
  if (state.canonicalContype != null && state.canonicalContype !== "c") {
    return {
      action: "STOP",
      reason: `canonical name ${CANONICAL_NAME} occupied by non-CHECK (${state.canonicalContype})`,
    };
  }
  if (state.tempContype != null && state.tempContype !== "c") {
    const tempName =
      state.mode === "rollback" ? ROLLBACK_TEMP_NAME : FORWARD_TEMP_NAME;
    return {
      action: "STOP",
      reason: `temporary name ${tempName} occupied by non-CHECK (${state.tempContype})`,
    };
  }
  return { action: "CONTINUE", reason: "no name collisions" };
}

/**
 * Intentionally weak set-only matcher (R1-style). Used only to show bypass
 * predicates that contain IS NULL + IN/ANY + the expected value set but are
 * NOT a complete reference predicate and must not be trusted.
 */
export function setOnlyAllowListMatch(def, expectedValues) {
  if (def == null || typeof def !== "string") return false;
  const lower = def.toLowerCase();
  if (!/is\s+null/.test(lower)) return false;
  if (!/\bin\s*\(|=\s*any\s*\(/.test(lower)) return false;
  const values = [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const relevant = values.filter((v) => expectedValues.includes(v));
  const got = [...new Set(relevant)].sort().join("|");
  const exp = [...new Set(expectedValues)].sort().join("|");
  return got === exp;
}
