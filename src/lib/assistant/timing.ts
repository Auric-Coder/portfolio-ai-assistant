/**
 * Per-request timings for latency diagnosis. Filled by the pipeline, written to the server log line
 * and exposed as a Server-Timing header (visible in the browser devtools Network tab). No visitor
 * data and no secrets, only milliseconds and provider names.
 */
export interface Timings {
  /** Getting the index and the (cached) retriever ready: ~0 on a warm instance, larger on a cold one. */
  index?: number;
  /** The query-embedding call (0 when the starter-question cache answered it, absent when none was made). */
  embed?: number;
  /** BM25 + dense search + fusion, excluding the embedding wait. */
  retrieve?: number;
  /** From request start to the first token of the answer. */
  ttft?: number;
  /** From request start to the end of the stream. */
  total?: number;
  /** "api" | "starter-cache" | "none" | "timeout" | "error" */
  embedSource?: string;
  /** Provider that produced the answer. */
  provider?: string;
  /** Providers that failed before the answer started (failover happened when non-empty). */
  failover?: string[];
  /** First request handled by this server instance. */
  cold?: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** `index;dur=0.3, embed;dur=312.4, retrieve;dur=2.1, ttft;dur=840.0, provider;desc="nvidia", ...` */
export function serverTimingHeader(t: Timings): string {
  const parts: string[] = [];
  for (const k of ["index", "embed", "retrieve", "ttft"] as const) {
    const v = t[k];
    if (typeof v === "number" && Number.isFinite(v)) parts.push(`${k};dur=${r1(v)}`);
  }
  if (t.embedSource) parts.push(`embedsrc;desc="${t.embedSource}"`);
  if (t.provider) parts.push(`provider;desc="${t.provider}"`);
  if (t.failover?.length) parts.push(`failover;desc="${t.failover.join(">")}"`);
  if (t.cold) parts.push(`cold;desc="1"`);
  return parts.join(", ");
}
