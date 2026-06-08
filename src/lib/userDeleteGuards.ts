/** Users that must never be permanently deleted. */
export function isPermanentlyProtectedUser(user: {
  id?: string;
  username?: string;
  name?: string;
  role?: string;
}): boolean {
  const username = String(user.username || "").trim().toLowerCase();
  const name = String(user.name || "").trim().toLowerCase();
  const role = String(user.role || "").trim();

  if (role === "Super Admin") return true;
  if (username === "allauddin") return true;
  if (name === "muhammad allauddin" || name.includes("muhammad allauddin")) return true;
  return false;
}

/** High-value account — deletable only with explicit DELETE confirmation (same modal). */
export function isHighValueProtectedUser(user: { username?: string; name?: string }): boolean {
  const username = String(user.username || "").trim().toLowerCase();
  const name = String(user.name || "").trim().toLowerCase();
  if (username === "raza") return true;
  if (name.includes("barrister raza khan niazi")) return true;
  return false;
}

export function canDeleteUser(
  target: { id: string; username?: string; name?: string; role?: string },
  actorId: string
): { allowed: boolean; reason?: string } {
  if (target.id === actorId) {
    return { allowed: false, reason: "You cannot delete your own account while signed in." };
  }
  if (isPermanentlyProtectedUser(target)) {
    return { allowed: false, reason: "This account is protected and cannot be permanently deleted." };
  }
  return { allowed: true };
}
