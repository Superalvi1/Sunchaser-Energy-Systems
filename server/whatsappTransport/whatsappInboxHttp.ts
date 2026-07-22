/**
 * Inbox API HTTP envelope + central error mapper (PR2 Step 4A).
 * Controllers stay free of status/code branching details.
 */
import type { Response } from "express";
import {
  InboxServiceError,
  type InboxServiceErrorCode,
} from "./whatsappInboxServiceErrors.ts";

export type InboxErrorBody = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type InboxSuccessEnvelope<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type InboxErrorEnvelope = {
  success: false;
  error: InboxErrorBody;
};

export function inboxOk<T>(
  res: Response,
  data: T,
  status = 200,
  meta?: Record<string, unknown>
): Response {
  const body: InboxSuccessEnvelope<T> = { success: true, data };
  if (meta && Object.keys(meta).length > 0) body.meta = meta;
  return res.status(status).json(body);
}

export function inboxFail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): Response {
  const error: InboxErrorBody = { code, message };
  if (details && Object.keys(details).length > 0) error.details = details;
  const body: InboxErrorEnvelope = { success: false, error };
  return res.status(status).json(body);
}

const CODE_TO_STATUS: Record<InboxServiceErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  invalid_transition: 400,
  invalid_argument: 400,
  free_form_closed: 400,
  idempotency_processing: 409,
  idempotency_outcome_unknown: 409,
  already_linked: 409,
  service_unavailable: 503,
};

export function mapInboxError(err: unknown): {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  if (err instanceof InboxServiceError) {
    return {
      status: CODE_TO_STATUS[err.code] ?? 500,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }
  if (err instanceof Error) {
    return {
      status: 500,
      code: "internal_error",
      message: "Internal server error",
    };
  }
  return {
    status: 500,
    code: "internal_error",
    message: "Internal server error",
  };
}

export function sendInboxError(res: Response, err: unknown): Response {
  const mapped = mapInboxError(err);
  return inboxFail(
    res,
    mapped.status,
    mapped.code,
    mapped.message,
    mapped.details
  );
}
