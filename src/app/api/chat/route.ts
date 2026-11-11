import { config } from "../../../lib/assistant/config";
import { createEmbeddingProvider } from "../../../lib/assistant/embeddings";
import { loadBundledIndex } from "../../../lib/assistant/bundledIndex";
import { handleChat, jsonError } from "../../../lib/assistant/http";
import { buildProviderChain, type LLMProvider } from "../../../lib/assistant/llm";
import { anonymise, createLogSink, isUnanswered } from "../../../lib/assistant/log";
import { createRateLimiter, limitedResponse, visitorKey } from "../../../lib/assistant/ratelimit";

/**
 * Optional server-side override of provider order, e.g. ASSISTANT_PROVIDERS=gemini (used by the
 * Phase 6 evaluation to compare models fairly; unset in production = nvidia then gemini failover).
 */
function selectProviders(chain: LLMProvider[], only: string | undefined): LLMProvider[] {
  const names = (only ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!names.length) return chain;
  return names.map((n) => chain.find((p) => p.name === n)).filter((p): p is LLMProvider => !!p);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const upstash = {
  url: process.env.UPSTASH_REDIS_REST_URL?.trim() || undefined,
  token: process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || undefined,
};
// Module-level so the in-memory fallback keeps its counters between requests on one instance.
const limiter = createRateLimiter(upstash, config.limits, undefined, () => console.warn("[assistant] rate-limit store unavailable; using the in-memory limiter"));
const logSink = createLogSink({ ...upstash, file: process.env.ASSISTANT_LOG_FILE?.trim() || undefined });

export async function POST(req: Request): Promise<Response> {
  try {
    return await handleChat(
      req,
      {
        index: loadBundledIndex(),
        embedder: createEmbeddingProvider(config.embedding),
        providers: selectProviders(
          buildProviderChain({
            nvidiaKey: process.env.NVIDIA_API_KEY?.trim() || undefined,
            nvidiaModel: config.llm.nvidiaModel,
            nvidiaBaseUrl: config.llm.nvidiaBaseUrl,
            geminiKey: process.env.GEMINI_API_KEY?.trim() || undefined,
            geminiModel: config.llm.geminiModel,
            timeoutMs: config.llm.timeoutMs,
          }),
          process.env.ASSISTANT_PROVIDERS,
        ),
        onFailover: (e) => console.warn(`[assistant] ${e.provider} failed (${e.error}); trying next provider`),
        onComplete: (r) => {
          // Anonymised: scrubbed question text and scores only; no IP, no answer text.
          void logSink.write({
            t: new Date().toISOString(),
            q: anonymise(r.question),
            refused: r.refused,
            reason: r.reason,
            topCosine: r.topCosine === null ? null : Math.round(r.topCosine * 1000) / 1000,
            topBm25: Math.round(r.topBm25 * 100) / 100,
            mode: r.mode,
            unanswered: isUnanswered(r.reason, r.refused, r.answer),
            provider: r.provider,
            ms: r.ms,
            error: r.error || undefined,
          });
        },
      },
      config.limits.enabled
        ? async (request) => {
            const decision = await limiter.check(visitorKey(request, process.env.IP_HASH_SALT?.trim() || undefined));
            return decision.ok
              ? null
              : limitedResponse(decision, { contactUrl: config.site.contactUrl, resumeUrl: config.site.resumeUrl, assistantName: config.site.assistantName, subjectName: config.site.subjectName });
          }
        : undefined,
    );
  } catch {
    return jsonError(500, "internal error");
  }
}

export function GET(): Response {
  return jsonError(405, "use POST", { allow: "POST" });
}
