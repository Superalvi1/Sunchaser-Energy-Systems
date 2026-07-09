/**
 * Feature flag for the Knowledge Center **mock UI prototype**.
 *
 * This is NOT the server/knowledge backend layer. The backend architecture
 * lives in `server/knowledge/` (types, permissions, repository stubs) and has
 * no routes or production UI.
 *
 * When `VITE_ENABLE_KNOWLEDGE_MOCK_UI` is not exactly `"true"`, the Knowledge
 * Center menu is hidden and `KnowledgeStaff` must not mount.
 *
 * Default: disabled (flag omitted or false).
 */

export const KNOWLEDGE_MOCK_UI_ENV_KEY = "VITE_ENABLE_KNOWLEDGE_MOCK_UI";

/** True only when VITE_ENABLE_KNOWLEDGE_MOCK_UI=true at build time. */
export function isKnowledgeMockUiEnabled(): boolean {
  const raw = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[
    KNOWLEDGE_MOCK_UI_ENV_KEY
  ];
  return String(raw ?? "").trim().toLowerCase() === "true";
}
