/**
 * Hybrid retrieval: BM25 + dense cosine fused with Reciprocal Rank Fusion.
 * Similarity direction: cosine similarity, HIGHER = MORE similar. (MultiDocChat once
 * sorted a distance the wrong way; unit tests pin this down.)
 */
import { BM25 } from "./bm25";
import type { EmbeddingProvider } from "./embeddings";
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
}

export interface RetrievalResult {
  hits: Hit[];
  mode: "hybrid" | "bm25";
  /** Best raw signals across candidates, used by the relevance gate. */
  topCosine: number | null;
  topBm25: number;
  note?: string;
}

export class Retriever {
  private bm25: BM25;
  constructor(
    readonly index: AssistantIndex,
    private embedder: EmbeddingProvider | null,
    private opts: RetrievalOptions,
  ) {
    this.bm25 = new BM25(index.chunks.map((c) => c.text));
  }

  async retrieve(question: string): Promise<RetrievalResult> {
    const { index, opts } = this;
    const bmHits = this.bm25.search(question, opts.bm25K);
    const bmScore = new Map(bmHits.map((h) => [h.index, h.score]));

    let dense: RankedItem[] = [];
    let note: string | undefined;
    const denseUsable = !!this.embedder && !!index.embeddingModel && index.embeddingModel === this.embedder.model;
    if (!this.embedder) note = "no embedding provider: BM25 only";
    else if (!index.embeddingModel) note = "index has no vectors: BM25 only";
    else if (!denseUsable) note = `embedding model mismatch (index ${index.embeddingModel}, query ${this.embedder.model}): BM25 only`;
    if (denseUsable) {
      try {
        const [qv] = await this.embedder!.embed([question], "query");
        dense = denseSearch(qv, index.chunks, opts.denseK);
      } catch {
        note = "embedding call failed: BM25 only";
      }
    }
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
    };
  }
}
