/** Seeded demo staff accounts safe to remove from production via Admin cleanup. */
export const DEMO_SEED_USER_MATCHERS = [
  { label: "Sarah Connor", names: ["sarah connor"], usernames: ["sales"] },
  { label: "Bob Surveyor", names: ["bob surveyor"], usernames: ["surveyor"] },
  { label: "Dave Installer", names: ["dave installer"], usernames: ["installer"] },
  { label: "Field Technician", names: ["field technician"], usernames: ["technician"] },
] as const;

export function isDemoSeedUser(user: { name?: string; username?: string }): boolean {
  const name = String(user.name || "").trim().toLowerCase();
  const username = String(user.username || "").trim().toLowerCase();
  return DEMO_SEED_USER_MATCHERS.some(
    (d) => d.names.includes(name) || d.usernames.includes(username)
  );
}

export function demoSeedLabel(user: { name?: string; username?: string }): string | null {
  const name = String(user.name || "").trim().toLowerCase();
  const username = String(user.username || "").trim().toLowerCase();
  const hit = DEMO_SEED_USER_MATCHERS.find(
    (d) => d.names.includes(name) || d.usernames.includes(username)
  );
  return hit?.label || null;
}
