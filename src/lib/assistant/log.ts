/**
 * Anonymised question log (plan Phase 7). One entry per request: a scrubbed copy of the
 * question, retrieval scores and whether it was refused. No IP address, no user identifier,
 * no answer text. "Unanswered" entries are the to-do list for new knowledge-base content
 * (`npm run kb:unanswered`).
 *
 * Sinks: console (always; structured JSON in the platform logs), an Upstash list (when configured,
 * capped), and an optional JSONL file (ASSISTANT_LOG_FILE, for local runs).
 */
import fs from "node:fs";
import path from "node:path";

export interface LogEntry {
  t: string; // ISO timestamp
  q: string; // anonymised question
  refused: boolean;
  reason?: string;
  topCosine: number | null;
  topBm25: number;
  mode?: string;
  unanswered: boolean;
  provider?: string;
  ms: number;
  error?: boolean;
  /** Milliseconds: index, embed, retrieve, ttft, total (see timing.ts). */
  timings?: { index?: number; embed?: number; retrieve?: number; ttft?: number; total?: number };
  /** "api" | "starter-cache" | "none" | "timeout" | "error" */
  embedSource?: string;
  /** Providers that failed before the answer started (failover happened when present). */
  failover?: string[];
  /** First request of this server instance. */
  cold?: boolean;
}

/** Remove things that could identify a person from free text, then cut it to 200 chars. */
export function anonymise(q: string): string {
  return q
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(nvapi-|AIza|ghp_|github_pat_|sk-)[A-Za-z0-9_-]{6,}/g, "[secret]")
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "[number]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** The model's own "I don't have that information" reply (system prompt rule 1) or a gate refusal counts as unanswered. */
export function isUnanswered(reason: string | undefined, refused: boolean, answer: string): boolean {
  if (refused) return reason === "irrelevant";
  return /(don'?t|do not) have (that|this|any|enough|information|details)/i.test(answer);
}

export interface LogSink {
  write(entry: LogEntry): Promise<void> | void;
}

export const consoleSink: LogSink = {
  write(e) {
    console.log(`[assistant-log] ${JSON.stringify(e)}`);
  },
};

export function fileSink(file: string): LogSink {
  return {
    write(e) {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(e)}\n`);
    },
  };
}

export const LOG_LIST_KEY = "assistant:log";

export function upstashSink(url: string, token: string, fetchImpl: typeof fetch = fetch, max = 2000): LogSink {
  return {
    async write(e) {
      await fetchImpl(`${url.replace(/\/$/, "")}/pipeline`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify([["LPUSH", LOG_LIST_KEY, JSON.stringify(e)], ["LTRIM", LOG_LIST_KEY, 0, max - 1]]),
        signal: AbortSignal.timeout(2000),
      });
    },
  };
}

/** Writes to every sink; a failing sink never breaks a chat request. */
export function multiSink(sinks: LogSink[]): LogSink {
  return {
    async write(e) {
      await Promise.all(
        sinks.map(async (s) => {
          try {
            await s.write(e);
          } catch {
            /* logging must never affect the answer */
          }
        }),
      );
    },
  };
}

export function createLogSink(env: { url?: string; token?: string; file?: string }, fetchImpl?: typeof fetch): LogSink {
  const sinks: LogSink[] = [consoleSink];
  if (env.url && env.token) sinks.push(upstashSink(env.url, env.token, fetchImpl));
  if (env.file) sinks.push(fileSink(env.file));
  return multiSink(sinks);
}

/** Counts unanswered questions (case/space-insensitive) for the KB to-do list. */
export function summariseUnanswered(entries: LogEntry[]): { q: string; count: number; last: string }[] {
  const map = new Map<string, { q: string; count: number; last: string }>();
  for (const e of entries) {
    if (!e.unanswered) continue;
    const key = e.q.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
    if (!key) continue;
    const cur = map.get(key);
    if (cur) {
      cur.count++;
      if (e.t > cur.last) cur.last = e.t;
    } else map.set(key, { q: e.q, count: 1, last: e.t });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
}
