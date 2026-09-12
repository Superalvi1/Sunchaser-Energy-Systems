import type { FetchLike, HttpRequest, HttpResponse } from "../providers/http.ts";
import { MOCK_SCENARIOS, type MockScenario, type MockScenarioName } from "./scenarios.ts";
import { ProviderError } from "../providers/errors.ts";

export type RecordedHttpCall = {
  url: string;
  method: string;
  headerKeys: string[];
  bodyPreview: string;
};

export function createScenarioFetch(scenarioName: MockScenarioName): {
  fetchLike: FetchLike;
  calls: RecordedHttpCall[];
  scenario: MockScenario;
} {
  const scenario = MOCK_SCENARIOS[scenarioName];
  const calls: RecordedHttpCall[] = [];

  const fetchLike: FetchLike = async (req: HttpRequest, signal: AbortSignal) => {
    calls.push(record(req));
    if (scenario.abortBeforeSend) {
      throw new ProviderError({
        message: "timeout before request",
        category: "timeout_before_request",
        retryClass: "retry_new_attempt",
      });
    }
    if (signal.aborted) {
      throw new ProviderError({
        message: "aborted",
        category: "timeout_before_request",
        retryClass: "retry_new_attempt",
      });
    }
    if (scenario.abortAfterSend) {
      throw new ProviderError({
        message: "timeout after provider may have accepted",
        category: "timeout_after_possible_accept",
        retryClass: "retry_same_attempt_unknown",
      });
    }
    const bodyText =
      scenario.rawBody ??
      (scenario.json !== undefined ? JSON.stringify(scenario.json) : "");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (scenario.retryAfterMs) {
      headers["retry-after"] = String(Math.ceil(scenario.retryAfterMs / 1000));
    }
    const res: HttpResponse = {
      status: scenario.httpStatus ?? 200,
      headers,
      bodyText,
    };
    return res;
  };

  return { fetchLike, calls, scenario };
}

function record(req: HttpRequest): RecordedHttpCall {
  const headerKeys = Object.keys(req.headers ?? {}).map((k) => k.toLowerCase());
  let bodyPreview = "";
  if (typeof req.body === "string") bodyPreview = req.body.slice(0, 80);
  else if (req.body) bodyPreview = `[bytes ${req.body.byteLength}]`;
  return { url: stripSecrets(req.url), method: req.method, headerKeys, bodyPreview };
}

function stripSecrets(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/token|secret|code/i.test(key)) u.searchParams.set(key, "[redacted]");
    }
    return u.toString();
  } catch {
    return "[unparseable-url]";
  }
}
