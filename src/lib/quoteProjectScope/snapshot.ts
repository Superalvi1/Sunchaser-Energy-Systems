import type { BoqRow } from "../../types";
import type { ProjectScopeState } from "./types";

export function freezeProjectScopeSnapshot(scope: ProjectScopeState | null | undefined): ProjectScopeState | undefined {
  if (!scope) return undefined;
  return JSON.parse(JSON.stringify(scope)) as ProjectScopeState;
}

export function readProjectScopeSnapshot(source: { projectScopeSnapshot?: ProjectScopeState | null } | null | undefined): ProjectScopeState | undefined {
  if (!source || !source.projectScopeSnapshot) return undefined;
  return freezeProjectScopeSnapshot(source.projectScopeSnapshot);
}

export function commitAiQuoteDraftToParent<T extends { boqRows?: BoqRow[]; projectScopeSnapshot?: ProjectScopeState }>(
  parent: T,
  draft: { boqRows: BoqRow[]; projectScopeSnapshot?: ProjectScopeState; draftOnly: true }
): T {
  if (!draft?.draftOnly) return parent;
  return {
    ...parent,
    boqRows: draft.boqRows,
    projectScopeSnapshot: freezeProjectScopeSnapshot(draft.projectScopeSnapshot),
  };
}

export function quotePersistsProjectScope(quote: { projectScopeSnapshot?: ProjectScopeState } | null | undefined): boolean {
  return Boolean(readProjectScopeSnapshot(quote));
}
