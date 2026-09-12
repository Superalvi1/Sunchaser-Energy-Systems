export type MetricName =
  | "publisher.posts.published"
  | "publisher.posts.failed"
  | "publisher.posts.retries"
  | "publisher.posts.unknown"
  | "publisher.token.refresh_failures"
  | "publisher.publish.latency_ms"
  | "publisher.provider.http_429";

export type MetricLabels = {
  provider?: string;
  organization_id?: string;
  error_category?: string;
};

export type MetricSink = {
  incr(name: MetricName, value?: number, labels?: MetricLabels): void;
  observe(name: MetricName, value: number, labels?: MetricLabels): void;
};

export class InMemoryMetrics implements MetricSink {
  readonly counters = new Map<string, number>();
  readonly observations: Array<{ name: MetricName; value: number }> = [];

  incr(name: MetricName, value = 1, labels?: MetricLabels): void {
    const key = keyOf(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  observe(name: MetricName, value: number, labels?: MetricLabels): void {
    this.observations.push({ name, value });
    this.incr(name, 1, labels);
  }

  get(name: MetricName, labels?: MetricLabels): number {
    return this.counters.get(keyOf(name, labels)) ?? 0;
  }
}

function keyOf(name: MetricName, labels?: MetricLabels): string {
  const parts: string[] = [name];
  if (labels?.provider) parts.push(`provider=${labels.provider}`);
  if (labels?.error_category) parts.push(`cat=${labels.error_category}`);
  return parts.join("|");
}

export function recordAttempt(
  metrics: MetricSink,
  input: {
    provider: string;
    outcome: "accepted" | "provider_pending" | "failed" | "unknown";
    durationMs: number;
    httpStatus: number | null;
    category: string | null;
    isRetry: boolean;
  }
): void {
  metrics.observe("publisher.publish.latency_ms", input.durationMs, { provider: input.provider });
  if (input.isRetry) metrics.incr("publisher.posts.retries", 1, { provider: input.provider });
  if (input.outcome === "accepted") {
    metrics.incr("publisher.posts.published", 1, { provider: input.provider });
  } else if (input.outcome === "failed") {
    metrics.incr("publisher.posts.failed", 1, {
      provider: input.provider,
      error_category: input.category ?? undefined,
    });
  } else if (input.outcome === "unknown") {
    metrics.incr("publisher.posts.unknown", 1, { provider: input.provider });
  }
  if (input.httpStatus === 429) {
    metrics.incr("publisher.provider.http_429", 1, { provider: input.provider });
  }
}
