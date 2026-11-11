/**
 * Abuse and cost controls (plan section 6): a per-visitor rate limit and a global daily cap.
 *
 *  - Visitors are identified by a salted HMAC of their IP; the raw IP is never stored or logged.
 *  - Upstash Redis (REST) when UPSTASH_REDIS_REST_URL/TOKEN are set, shared across serverless
 *    instances; otherwise (or when Upstash errors) an in-memory limiter, which is per instance
 *    and therefore best effort, but never lets the assistant run unprotected.
 *  - Per-visitor counters are checked first, so a throttled visitor does not burn the global cap.
 */
import { createHmac, randomBytes } from "node:crypto";

export interface LimitConfig {
  perIpPerMinute: number;
  perIpPerDay: number;
  /** Total questions per UTC day across all visitors (protects the free-tier quotas). */
  globalPerDay: number;
}

export type LimitReason = "per-minute" | "per-day" | "daily-cap";
export interface LimitDecision {
  ok: boolean;
  reason?: LimitReason;
  retryAfterSec: number;
}
export interface RateLimiter {
  check(visitorKey: string): Promise<LimitDecision>;
}

const MINUTE = 60;
const DAY = 86400;

const secondsToNextMinute = (nowMs: number) => MINUTE - (Math.floor(nowMs / 1000) % MINUTE);
const secondsToNextUtcDay = (nowMs: number) => DAY - (Math.floor(nowMs / 1000) % DAY);
const dayStamp = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

/** Decision from the three counters (already incremented). */
export function decide(counts: { minute: number; day: number; global: number | null }, cfg: LimitConfig, nowMs: number): LimitDecision {
  if (counts.minute > cfg.perIpPerMinute) return { ok: false, reason: "per-minute", retryAfterSec: secondsToNextMinute(nowMs) };
  if (counts.day > cfg.perIpPerDay) return { ok: false, reason: "per-day", retryAfterSec: secondsToNextUtcDay(nowMs) };
  if (counts.global !== null && counts.global > cfg.globalPerDay) return { ok: false, reason: "daily-cap", retryAfterSec: secondsToNextUtcDay(nowMs) };
  return { ok: true, retryAfterSec: 0 };
}

export class MemoryRateLimiter implements RateLimiter {
  private counters = new Map<string, { n: number; expiresAt: number }>();
  constructor(
    private cfg: LimitConfig,
    private now: () => number = Date.now,
  ) {}

  private bump(key: string, ttlSec: number, nowMs: number): number {
    const cur = this.counters.get(key);
    if (cur && cur.expiresAt > nowMs) {
      cur.n++;
      return cur.n;
    }
    this.counters.set(key, { n: 1, expiresAt: nowMs + ttlSec * 1000 });
    if (this.counters.size > 5000) for (const [k, v] of this.counters) if (v.expiresAt <= nowMs) this.counters.delete(k);
    return 1;
  }

  async check(visitorKey: string): Promise<LimitDecision> {
    const t = this.now();
    const minute = this.bump(`m:${visitorKey}:${Math.floor(t / 60000)}`, MINUTE * 2, t);
    const day = this.bump(`d:${visitorKey}:${dayStamp(t)}`, DAY, t);
    const perVisitor = decide({ minute, day, global: null }, this.cfg, t);
    if (!perVisitor.ok) return perVisitor; // a throttled visitor must not consume the global cap
    const global = this.bump(`g:${dayStamp(t)}`, DAY, t);
    return decide({ minute, day, global }, this.cfg, t);
  }
}

/** Upstash Redis over its REST API (no SDK): INCR + EXPIRE NX through one pipeline call. */
export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private url: string,
    private token: string,
    private cfg: LimitConfig,
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
    private timeoutMs = 2000,
  ) {}

  private async pipeline(commands: (string | number)[][]): Promise<number[]> {
    const res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const out = (await res.json()) as { result?: number; error?: string }[];
    return out.map((r) => {
      if (r.error) throw new Error("upstash command error");
      return Number(r.result);
    });
  }

  async check(visitorKey: string): Promise<LimitDecision> {
    const t = this.now();
    const km = `assistant:m:${visitorKey}:${Math.floor(t / 60000)}`;
    const kd = `assistant:d:${visitorKey}:${dayStamp(t)}`;
    const [minute, , day] = await this.pipeline([["INCR", km], ["EXPIRE", km, MINUTE * 2, "NX"], ["INCR", kd], ["EXPIRE", kd, DAY, "NX"]]);
    const perVisitor = decide({ minute, day, global: null }, this.cfg, t);
    if (!perVisitor.ok) return perVisitor;
    const kg = `assistant:g:${dayStamp(t)}`;
    const [global] = await this.pipeline([["INCR", kg], ["EXPIRE", kg, DAY, "NX"]]);
    return decide({ minute, day, global }, this.cfg, t);
  }
}

/** Upstash with an in-memory safety net: a Redis outage never disables the limits. */
export class FallbackRateLimiter implements RateLimiter {
  constructor(
    private primary: RateLimiter,
    private fallback: RateLimiter,
    private onFallback?: () => void,
  ) {}
  async check(visitorKey: string): Promise<LimitDecision> {
    try {
      return await this.primary.check(visitorKey);
    } catch {
      this.onFallback?.();
      return this.fallback.check(visitorKey);
    }
  }
}

export function createRateLimiter(
  env: { url?: string; token?: string },
  cfg: LimitConfig,
  fetchImpl?: typeof fetch,
  onFallback?: () => void,
): RateLimiter {
  const memory = new MemoryRateLimiter(cfg);
  if (env.url && env.token) return new FallbackRateLimiter(new UpstashRateLimiter(env.url, env.token, cfg, fetchImpl), memory, onFallback);
  return memory;
}

/** Per-process fallback salt when IP_HASH_SALT is not set (still never the raw IP). */
const processSalt = randomBytes(16).toString("hex");

/** Salted HMAC of the client IP (first X-Forwarded-For entry, then X-Real-IP). Never returns the IP. */
export function visitorKey(req: Request, salt?: string): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || req.headers.get("x-real-ip")?.trim() || "unknown";
  return createHmac("sha256", salt || processSalt).update(ip).digest("hex").slice(0, 24);
}

export interface LimitMessages {
  contactUrl: string;
  resumeUrl?: string;
  assistantName: string;
  /** Name of the person the assistant talks about (used in "read X's résumé"). */
  subjectName: string;
}

/** The HTTP response for a blocked request; the JSON `message` is shown to the visitor as is. */
export function limitedResponse(d: LimitDecision, m: LimitMessages): Response {
  const resting = d.reason === "daily-cap";
  const message = resting
    ? `${m.assistantName} has answered a lot of questions today and is resting. Please try again tomorrow${m.resumeUrl ? `, read ${m.subjectName}'s résumé: ${m.resumeUrl}` : ""}, or use the contact section: ${m.contactUrl}`
    : d.reason === "per-day"
      ? `You have reached today's question limit for ${m.assistantName}. Please try again tomorrow or use the contact section: ${m.contactUrl}`
      : `Too many questions in a short time. Please wait ${d.retryAfterSec} seconds and try again.`;
  return new Response(JSON.stringify({ error: resting ? "daily_cap" : "rate_limited", message, retryAfter: d.retryAfterSec }), {
    status: resting ? 503 : 429,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": String(Math.max(1, d.retryAfterSec)) },
  });
}
