import { assertNoSecrets, redactValue } from "./redact.ts";

export type ProviderName = "facebook" | "tiktok";

export type PublishLogEvent = {
  msg: string;
  jobId: string;
  organizationId: string;
  accountId: string;
  provider: ProviderName;
  attemptNumber: number;
  status: string;
  providerErrorCategory?: string;
  durationMs: number;
  outcome?: string;
  httpStatus?: number | null;
};

export function publishLogFields(event: PublishLogEvent): Record<string, unknown> {
  const fields = {
    msg: event.msg,
    job_id: event.jobId,
    organization_id: event.organizationId,
    account_id: event.accountId,
    provider: event.provider,
    attempt_number: event.attemptNumber,
    status: event.status,
    provider_error_category: event.providerErrorCategory ?? null,
    duration_ms: event.durationMs,
    outcome: event.outcome ?? null,
    http_status: event.httpStatus ?? null,
  };
  const redacted = redactValue(fields) as Record<string, unknown>;
  assertNoSecrets(redacted);
  return redacted;
}

export function logPublish(event: PublishLogEvent, sink: (line: string) => void = defaultSink): void {
  sink(JSON.stringify(publishLogFields(event)));
}

function defaultSink(line: string): void {
  process.stdout.write(`${line}\n`);
}
