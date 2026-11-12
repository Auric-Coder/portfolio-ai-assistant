/**
 * Assistant runtime configuration. Site-specific values come from the root
 * assistant.config.ts; everything tunable lives here. Model ids can be
 * overridden with env vars so a retired model never needs a code change.
 */
import site from "../../../assistant.config";

const env = (k: string): string | undefined => {
  const v = typeof process !== "undefined" ? process.env[k] : undefined;
  return v && v.trim() ? v.trim() : undefined;
};

export const config = {
  site,

  embedding: {
    provider: (env("EMBEDDING_PROVIDER") ?? "gemini") as "gemini" | "none",
    // gemini-embedding-001 is the GA Gemini embedding model (checked against public
    // docs/announcements; confirm in AI Studio). Index and query MUST use the same model.
    model: env("GEMINI_EMBEDDING_MODEL") ?? "gemini-embedding-001",
    dimensions: 768,
  },

  chunking: {
    targetTokens: 300,
    overlapTokens: 50,
    /** Rough conversion used only for chunk sizing. */
    tokensPerWord: 1.33,
  },

  retrieval: {
    bm25K: 20,
    denseK: 20,
    topK: 5,
    rrfK: 60,
    /** Query-embedding call budget; beyond it retrieval continues with BM25 only. */
    embedTimeoutMs: Number(env("EMBED_TIMEOUT_MS") ?? 1500),
  },

  llm: {
    // Model ids live here (overridable by env) so a retired model never needs a code change.
    nvidiaModel: env("NVIDIA_MODEL") ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
    nvidiaBaseUrl: env("NVIDIA_BASE_URL") ?? "https://integrate.api.nvidia.com/v1",
    // Flash-Lite fallback; public catalogs list gemini-3.5-flash-lite as current. Confirm in AI Studio.
    geminiModel: env("GEMINI_LLM_MODEL") ?? "gemini-3.5-flash-lite",
    maxTokens: 400,
    temperature: 0.2,
    timeoutMs: 15000,
    // Primary provider: how long to wait for headers and for the first token before failing over to Gemini
    // (it also bounds the gap between later chunks). Normal first token is about 1.3 s.
    nvidiaTimeoutMs: Number(env("NVIDIA_TIMEOUT_MS") ?? 8000),
  },

  /**
   * Abuse and cost controls (see ratelimit.ts). Free-tier budgets: keep globalPerDay well below the
   * daily request quota of the providers. ASSISTANT_RATE_LIMIT=off disables the limiter (local
   * evaluation only; never set it in production).
   */
  limits: {
    perIpPerMinute: 6,
    perIpPerDay: 40,
    globalPerDay: 600,
    enabled: env("ASSISTANT_RATE_LIMIT")?.toLowerCase() !== "off",
  },

  chat: {
    /** Messages kept as history, including the new question. */
    historyMessages: 4,
    maxUserChars: 500,
    maxAssistantChars: 1500,
  },

  /**
   * Relevance gate thresholds, tuned in Phase 6 on eval/questions.yaml (npm run eval:retrieval):
   * answerable questions score cosine >= 0.62, off-topic ones <= 0.53, so minCosine sits in the middle
   * of that gap. strongCosine 0.72 -> 0.70: "Where has he interned?" matched the right FAQ at 0.718 with no
   * keyword overlap and was refused; plain off-topic questions stay at or below 0.55, so there is room.
   * Re-run the sweep whenever the KB changes a lot.
   */
  gate: {
    minCosine: 0.57,
    strongCosine: 0.70,
    minBm25: 2.0,
    minBm25WithCosine: 1.0,
  },

  /** Bump when the index layout or chunking changes; forces a full rebuild. */
  indexSchemaVersion: 1,
  indexPath: env("ASSISTANT_INDEX_PATH") ?? "data/assistant-index.json",
} as const;

export type AssistantRuntimeConfig = typeof config;
