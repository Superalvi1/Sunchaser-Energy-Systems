/**
 * Design Session persistence — Supabase + database.json fallback.
 * One draft session per lead. Versioned. No engine math here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const DESIGN_SESSION_SCHEMA_VERSION = 1;

export type DesignSessionStatus = "draft" | "archived";

export interface DesignSessionRecord {
  id: string;
  leadId: string;
  version: number;
  status: DesignSessionStatus;
  payload: Record<string, unknown>;
  concurrentEditDetected: boolean;
  lastModifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignSessionSaveInput {
  leadId: string;
  payload: Record<string, unknown>;
  expectedVersion: number | null;
  actorUsername: string;
  status?: DesignSessionStatus;
}

export interface DesignSessionSaveResult {
  ok: true;
  session: DesignSessionRecord;
  created: boolean;
}

export interface DesignSessionConflictResult {
  ok: false;
  conflict: true;
  concurrentEditDetected: true;
  session: DesignSessionRecord;
  message: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newSessionId(leadId: string): string {
  return `ds-${String(leadId).trim()}`;
}

export function mapDesignSessionRow(row: Record<string, unknown>): DesignSessionRecord {
  return {
    id: String(row.id ?? ""),
    leadId: String(row.lead_id ?? row.leadId ?? ""),
    version: Number(row.version) || 1,
    status: (row.status === "archived" ? "archived" : "draft") as DesignSessionStatus,
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    concurrentEditDetected: Boolean(row.concurrent_edit_detected ?? row.concurrentEditDetected),
    lastModifiedBy:
      row.last_modified_by != null
        ? String(row.last_modified_by)
        : row.lastModifiedBy != null
          ? String(row.lastModifiedBy)
          : null,
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

export function toDesignSessionDbRow(session: DesignSessionRecord): Record<string, unknown> {
  return {
    id: session.id,
    lead_id: session.leadId,
    version: session.version,
    status: session.status,
    payload: session.payload,
    concurrent_edit_detected: session.concurrentEditDetected,
    last_modified_by: session.lastModifiedBy,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}

/** Local JSON store helpers */
export function findLocalDesignSession(
  sessions: DesignSessionRecord[] | undefined,
  leadId: string
): DesignSessionRecord | null {
  const id = String(leadId || "").trim();
  if (!id || !Array.isArray(sessions)) return null;
  return sessions.find((s) => s.leadId === id) ?? null;
}

export function upsertLocalDesignSession(
  sessions: DesignSessionRecord[],
  input: DesignSessionSaveInput
): DesignSessionSaveResult | DesignSessionConflictResult {
  const leadId = String(input.leadId || "").trim();
  if (!leadId) {
    throw new Error("leadId is required");
  }
  const existing = findLocalDesignSession(sessions, leadId);
  const updatedAt = nowIso();

  if (!existing) {
    const session: DesignSessionRecord = {
      id: newSessionId(leadId),
      leadId,
      version: 1,
      status: input.status ?? "draft",
      payload: input.payload,
      concurrentEditDetected: false,
      lastModifiedBy: input.actorUsername || null,
      createdAt: updatedAt,
      updatedAt,
    };
    sessions.push(session);
    return { ok: true, session, created: true };
  }

  if (
    input.expectedVersion != null &&
    Number.isFinite(input.expectedVersion) &&
    existing.version !== input.expectedVersion
  ) {
    const conflicted: DesignSessionRecord = {
      ...existing,
      concurrentEditDetected: true,
    };
    const idx = sessions.findIndex((s) => s.leadId === leadId);
    if (idx >= 0) sessions[idx] = conflicted;
    return {
      ok: false,
      conflict: true,
      concurrentEditDetected: true,
      session: conflicted,
      message: "Design session was modified elsewhere. Reload before saving.",
    };
  }

  const session: DesignSessionRecord = {
    ...existing,
    version: existing.version + 1,
    status: input.status ?? existing.status,
    payload: input.payload,
    concurrentEditDetected: false,
    lastModifiedBy: input.actorUsername || existing.lastModifiedBy,
    updatedAt,
  };
  const idx = sessions.findIndex((s) => s.leadId === leadId);
  if (idx >= 0) sessions[idx] = session;
  else sessions.push(session);
  return { ok: true, session, created: false };
}

export class DesignSessionsSchemaMissingError extends Error {
  code = "DESIGN_SESSIONS_SCHEMA_MISSING" as const;
  constructor(message = "design_sessions table is missing") {
    super(message);
    this.name = "DesignSessionsSchemaMissingError";
  }
}

export async function fetchDesignSessionFromSupabase(
  supabase: SupabaseClient,
  leadId: string
): Promise<DesignSessionRecord | null> {
  const id = String(leadId || "").trim();
  if (!id) return null;
  const { data, error } = await supabase
    .from("design_sessions")
    .select("*")
    .eq("lead_id", id)
    .maybeSingle();
  if (error) {
    if (/relation .* does not exist|Could not find the table|PGRST205/i.test(error.message || "")) {
      throw new DesignSessionsSchemaMissingError(error.message);
    }
    throw error;
  }
  if (!data) return null;
  return mapDesignSessionRow(data as Record<string, unknown>);
}

export async function upsertDesignSessionToSupabase(
  supabase: SupabaseClient,
  input: DesignSessionSaveInput
): Promise<DesignSessionSaveResult | DesignSessionConflictResult> {
  const leadId = String(input.leadId || "").trim();
  if (!leadId) throw new Error("leadId is required");

  const existing = await fetchDesignSessionFromSupabase(supabase, leadId);
  const updatedAt = nowIso();

  if (!existing) {
    const session: DesignSessionRecord = {
      id: newSessionId(leadId),
      leadId,
      version: 1,
      status: input.status ?? "draft",
      payload: input.payload,
      concurrentEditDetected: false,
      lastModifiedBy: input.actorUsername || null,
      createdAt: updatedAt,
      updatedAt,
    };
    const { error } = await supabase.from("design_sessions").insert(toDesignSessionDbRow(session));
    if (error) {
      if (/relation .* does not exist|Could not find the table|PGRST205/i.test(error.message || "")) {
        throw new DesignSessionsSchemaMissingError(error.message);
      }
      throw error;
    }
    return { ok: true, session, created: true };
  }

  if (
    input.expectedVersion != null &&
    Number.isFinite(input.expectedVersion) &&
    existing.version !== input.expectedVersion
  ) {
    const conflicted: DesignSessionRecord = {
      ...existing,
      concurrentEditDetected: true,
    };
    await supabase
      .from("design_sessions")
      .update({ concurrent_edit_detected: true, updated_at: updatedAt })
      .eq("lead_id", leadId);
    return {
      ok: false,
      conflict: true,
      concurrentEditDetected: true,
      session: conflicted,
      message: "Design session was modified elsewhere. Reload before saving.",
    };
  }

  const session: DesignSessionRecord = {
    ...existing,
    version: existing.version + 1,
    status: input.status ?? existing.status,
    payload: input.payload,
    concurrentEditDetected: false,
    lastModifiedBy: input.actorUsername || existing.lastModifiedBy,
    updatedAt,
  };

  const { error } = await supabase
    .from("design_sessions")
    .update(toDesignSessionDbRow(session))
    .eq("lead_id", leadId);
  if (error) {
    if (/relation .* does not exist|Could not find the table|PGRST205/i.test(error.message || "")) {
      throw new DesignSessionsSchemaMissingError(error.message);
    }
    throw error;
  }
  return { ok: true, session, created: false };
}
