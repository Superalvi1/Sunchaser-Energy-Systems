/**
 * Respect the host's assigned listening port (e.g. Railway's PORT).
 * Keep the existing Render/local default to avoid altering production routing.
 */
export function resolveListenPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.PORT ?? "").trim();
  if (raw === "") return 3000;
  if (!/^\d+$/.test(raw)) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}
