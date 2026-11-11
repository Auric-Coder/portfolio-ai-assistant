/**
 * Incremental index logic (plan 5.4). Given the previous index and the freshly
 * chunked KB, decide which chunks can be reused and which need embedding.
 */
import type { AssistantIndex, IndexChunk } from "./types";
import type { EmbeddingProvider } from "./embeddings";

export type NewChunk = Omit<IndexChunk, "embedding">;

export interface UpdatePlan {
  /** Chunks to keep as-is (they carry their stored embedding). */
  reuse: IndexChunk[];
  /** Chunks that need an embedding computed. */
  toEmbed: NewChunk[];
  removed: number;
  fullRebuild: boolean;
  reason: string;
}

export function planUpdate(
  previous: AssistantIndex | null,
  fresh: NewChunk[],
  provider: EmbeddingProvider | null,
  schemaVersion: number,
): UpdatePlan {
  const model = provider?.model ?? null;
  let fullRebuild = false;
  let reason = "incremental";

  if (!previous) {
    fullRebuild = true;
    reason = "no previous index";
  } else if (previous.schemaVersion !== schemaVersion) {
    fullRebuild = true;
    reason = `schemaVersion changed (${previous.schemaVersion} -> ${schemaVersion})`;
  } else if (previous.embeddingModel && model && previous.embeddingModel !== model) {
    fullRebuild = true;
    reason = `embedding model changed (${previous.embeddingModel} -> ${model})`;
  } else if (previous.embeddingModel && !model) {
    reason = "no embedding provider; keeping existing vectors";
  }

  const prevByHash = new Map<string, IndexChunk>();
  if (previous && !fullRebuild) for (const c of previous.chunks) prevByHash.set(c.hash, c);

  const reuse: IndexChunk[] = [];
  const toEmbed: NewChunk[] = [];
  for (const c of fresh) {
    const old = prevByHash.get(c.hash);
    if (old && (old.embedding !== null || !provider)) {
      // Metadata (file, id, tags, links, date) may change without the text changing.
      reuse.push({ ...c, embedding: old.embedding });
    } else {
      toEmbed.push(c);
    }
  }
  const freshHashes = new Set(fresh.map((c) => c.hash));
  const removed = previous && !fullRebuild ? previous.chunks.filter((c) => !freshHashes.has(c.hash)).length : 0;
  return { reuse, toEmbed, removed, fullRebuild, reason };
}

const round = (v: number[]) => v.map((x) => Math.round(x * 1e5) / 1e5);

export async function assembleIndex(
  plan: UpdatePlan,
  fresh: NewChunk[],
  provider: EmbeddingProvider | null,
  schemaVersion: number,
  previous: AssistantIndex | null,
): Promise<{ index: AssistantIndex; embeddingCalls: number; embedded: number }> {
  const vectors = new Map<string, number[]>();
  let embeddingCalls = 0;
  if (plan.toEmbed.length && provider) {
    // Chunks with identical text share one vector.
    const unique = [...new Map(plan.toEmbed.map((c) => [c.hash, c])).values()];
    const res = await provider.embed(
      unique.map((c) => c.text),
      "document",
    );
    embeddingCalls = 1;
    unique.forEach((c, i) => vectors.set(c.hash, round(res[i])));
  }
  const reused = new Map(plan.reuse.map((c) => [c.hash, c]));
  const chunks: IndexChunk[] = fresh.map((c) => {
    const v = vectors.get(c.hash);
    if (v) return { ...c, embedding: v };
    return { ...c, embedding: reused.get(c.hash)?.embedding ?? null };
  });
  const hasVectors = chunks.some((c) => c.embedding);
  const keepPrev = !plan.fullRebuild && previous?.embeddingModel;
  const embeddingModel = hasVectors ? (provider?.model ?? (keepPrev ? previous!.embeddingModel : null)) : null;
  const dimensions = hasVectors ? (provider?.dimensions ?? (keepPrev ? previous!.dimensions : null)) : null;
  return { index: { schemaVersion, embeddingModel, dimensions, chunks }, embeddingCalls, embedded: vectors.size };
}
