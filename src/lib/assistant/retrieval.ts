/**
 * Hybrid retrieval: BM25 + dense cosine fused with Reciprocal Rank Fusion.
 * Similarity direction: cosine similarity, HIGHER = MORE similar. (MultiDocChat once
 * sorted a distance the wrong way; unit tests pin this down.)
 */
import { BM25 } from "./bm25";
import type { EmbeddingProvider } from "./embeddings";
import { normalizeQuery } from "./query";
import type { AssistantIndex, IndexChunk } from "./types";

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export interface RankedItem {
  index: number;
  score: number;
}

/** Highest cosine first. */
export function denseSearch(query: number[], chunks: IndexChunk[], k: number): RankedItem[] {
  const out: RankedItem[] = [];
  chunks.forEach((c, index) => {
    if (c.embedding) out.push({ index, score: cosine(query, c.embedding) });
  });
  out.sort((a, b) => b.score - a.score || a.index - b.index);
  return out.slice(0, k);
}

/** Reciprocal Rank Fusion over several ranked lists of chunk indexes. */
export function rrf(lists: RankedItem[][], k = 60): RankedItem[] {
  const score = new Map<number, number>();
  for (const list of lists)
    list.forEach((item, rank) => score.set(item.index, (score.get(item.index) ?? 0) + 1 / (k + rank + 1)));
  return [...score.entries()]
    .map(([index, s]) => ({ index, score: s }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

export interface Hit {
  chunk: IndexChunk;
  /** Fused RRF score. */
  score: number;
  bm25?: number;
  cosine?: number;
}

export interface RetrievalOptions {
  bm25K: number;
  denseK: number;
  topK: number;
  rrfK: number;
  /** Give up on the query-embedding call after this many ms and fall back to BM25 only (0 = no limit). */
  embedTimeoutMs?: number;
}

export interface RetrievalResult {
  hits: Hit[];
  mode: "hybrid" | "bm25";
  /** Best raw signals across candidates, used by the relevance gate. */
  topCosine: number | null;
  topBm25: number;
  note?: string;
  /** Where the time went (see timing.ts). */
  timings?: { embedMs: number; retrieveMs: number; embedSource: "api" | "starter-cache" | "none" | "timeout" | "error" };
}

/** One BM25 index per loaded knowledge index (per server instance), not one per request. */
const bm25Cache = new WeakMap<AssistantIndex, BM25>();
/** Test hook: how many BM25 indexes were built. */
export const retrievalStats = { bm25Builds: 0 };

function bm25For(index: AssistantIndex): BM25 {
  let b = bm25Cache.get(index);
  if (!b) {
    b = new BM25(index.chunks.map((c) => c.text));
    bm25Cache.set(index, b);
    retrievalStats.bm25Builds++;
  }
  return b;
}

class EmbedTimeout extends Error {}

interface EmbedOutcome {
  vector: number[] | null;
  ms: number;
  source: "api" | "starter-cache" | "none" | "timeout" | "error";
}

const now = () => performance.now();

export class Retriever {
  private bm25: BM25;
  constructor(
    readonly index: AssistantIndex,
    private embedder: EmbeddingProvider | null,
    private opts: RetrievalOptions,
  ) {
    this.bm25 = bm25For(index);
  }

  /** The query vector: from the precomputed starter-question cache, else the API with a timeout. */
  private embedQuery(question: string, usable: boolean): Promise<EmbedOutcome> {
    if (!usable || !this.embedder) return Promise.resolve({ vector: null, ms: 0, source: "none" });
    const key = normalizeQuery(question);
    const cached = this.index.queryEmbeddings?.find((q) => normalizeQuery(q.text) === key);
    if (cached) return Promise.resolve({ vector: cached.embedding, ms: 0, source: "starter-cache" });

    const t0 = now();
    const call = this.embedder.embed([question], "query").then((r) => r[0]);
    call.catch(() => {}); // a late failure after the timeout must not become an unhandled rejection
    const limit = this.opts.embedTimeoutMs;
    if (!limit) return call.then((vector) => ({ vector, ms: now() - t0, source: "api" as const }), () => ({ vector: null, ms: now() - t0, source: "error" as const }));

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EmbedTimeout()), limit);
    });
    return Promise.race([call, timeout])
      .then((vector) => ({ vector, ms: now() - t0, source: "api" as const }))
      .catch((e) => ({ vector: null, ms: now() - t0, source: e instanceof EmbedTimeout ? ("timeout" as const) : ("error" as const) }))
      .finally(() => clearTimeout(timer));
  }

  async retrieve(question: string): Promise<RetrievalResult> {
    const { index, opts } = this;
    const denseUsable = !!this.embedder && !!index.embeddingModel && index.embeddingModel === this.embedder.model;
    let note: string | undefined;
    if (!this.embedder) note = "no embedding provider: BM25 only";
    else if (!index.embeddingModel) note = "index has no vectors: BM25 only";
    else if (!denseUsable) note = `embedding model mismatch (index ${index.embeddingModel}, query ${this.embedder.model}): BM25 only`;

    // Start the embedding call first, then run BM25 while it is in flight.
    const embedding = this.embedQuery(question, denseUsable);
    const t0 = now();
    const bmHits = this.bm25.search(question, opts.bm25K);
    const bmScore = new Map(bmHits.map((h) => [h.index, h.score]));
    const bmMs = now() - t0;

    const emb = await embedding;
    const t1 = now();
    let dense: RankedItem[] = [];
    if (emb.vector) dense = denseSearch(emb.vector, index.chunks, opts.denseK);
    else if (emb.source === "timeout") note = `embedding timed out after ${opts.embedTimeoutMs} ms: BM25 only`;
    else if (emb.source === "error") note = "embedding call failed: BM25 only";
    const cosScore = new Map(dense.map((h) => [h.index, h.score]));
    const fused = rrf(dense.length ? [bmHits, dense] : [bmHits], opts.rrfK).slice(0, opts.topK);
    const hits: Hit[] = fused.map((f) => ({
      chunk: index.chunks[f.index],
      score: f.score,
      bm25: bmScore.get(f.index),
      cosine: cosScore.get(f.index),
    }));
    return {
      hits,
      mode: dense.length ? "hybrid" : "bm25",
      topCosine: dense.length ? dense[0].score : null,
      topBm25: bmHits[0]?.score ?? 0,
      note,
      timings: { embedMs: emb.ms, retrieveMs: bmMs + (now() - t1), embedSource: emb.source },
    };
  }
}
