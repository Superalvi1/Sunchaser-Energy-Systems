/**
 * What a company's subscription allows at THIS moment, worked out from the subscription row on every request (the row is cached for a few
 * seconds), so a company is held to its end date the moment it passes, not when a scheduled job next runs.
 *
 *  ok         inside the paid period (or trial), or the company has no subscription row (the founding company)
 *  grace      past the end date by no more than the grace period: full access, with a warning header
 *  read_only  past the grace period: the data can be viewed and downloaded, nothing can be created, changed or deleted
 *  blocked    the subscription is suspended or cancelled: no access to company data
 *
 * The grace period is an owner decision; SAAS_EXPIRY_GRACE_DAYS sets it (default 3 days).
 */
export type SubscriptionFacts = { status: string; trialEndsAt: string | null; periodEnd: string | null };
export type SubscriptionAccess = { state: "ok" | "grace" | "read_only" | "blocked"; endsAt?: string; daysOverdue?: number };

const DAY_MS = 86_400_000;

export function graceDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SAAS_EXPIRY_GRACE_DAYS);
  return Number.isFinite(n) && n >= 0 && n <= 60 ? Math.floor(n) : 3;
}

/** The instant the paid period or trial ends: the end of the stated day (UTC) for a date, the stated instant for a trial timestamp. */
export function subscriptionEnd(sub: SubscriptionFacts): Date | null {
  if (sub.status === "trial" && sub.trialEndsAt) {
    const t = new Date(sub.trialEndsAt);
    if (!Number.isNaN(t.getTime())) return t;
  }
  if (sub.periodEnd) {
    const d = new Date(`${String(sub.periodEnd).slice(0, 10)}T23:59:59.999Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function evaluateSubscriptionAccess(sub: SubscriptionFacts | null | undefined, now: Date = new Date(), grace: number = graceDays()): SubscriptionAccess {
  if (!sub) return { state: "ok" };
  if (sub.status === "suspended" || sub.status === "cancelled") return { state: "blocked" };
  const end = subscriptionEnd(sub);
  if (!end) return { state: "ok" };
  const over = now.getTime() - end.getTime();
  if (over <= 0) return { state: "ok", endsAt: end.toISOString() };
  const daysOverdue = Math.ceil(over / DAY_MS);
  if (over <= grace * DAY_MS) return { state: "grace", endsAt: end.toISOString(), daysOverdue };
  return { state: "read_only", endsAt: end.toISOString(), daysOverdue };
}

export const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const SUBSCRIPTION_EXPIRED_MESSAGE =
  "Your company's subscription has ended. Your data is safe and can still be viewed and downloaded, but nothing can be created or changed until the subscription is renewed. Contact the platform operator.";
