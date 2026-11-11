import test from "node:test";
import assert from "node:assert/strict";
import { BM25, tokenize } from "../bm25";
import { cosine, denseSearch, Retriever, rrf } from "../retrieval";
import type { AssistantIndex, IndexChunk } from "../types";
import type { EmbeddingProvider } from "../embeddings";

function mk(id: string, text: string, embedding: number[] | null): IndexChunk {
  return { id, file: `${id}.md`, title: id, heading: "", type: "faq", tags: [], links: {}, text, hash: id, embedding };
}

test("cosine: HIGHER means MORE similar (guards the distance/similarity inversion bug)", () => {
  const q = [1, 0];
  const near = [0.9, 0.1];
  const far = [0, 1];
  assert.ok(cosine(q, near) > cosine(q, far));
  assert.ok(cosine(q, q) > 0.999);
  assert.ok(Math.abs(cosine(q, far)) < 1e-9);
  const chunks = [mk("far", "x", far), mk("near", "y", near)];
  const hits = denseSearch(q, chunks, 2);
  assert.equal(chunks[hits[0].index].id, "near", "the most similar chunk must rank first");
  assert.ok(hits[0].score > hits[1].score);
});

test("cosine handles zero vectors", () => {
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test("rrf rewards agreement between lists and is deterministic", () => {
  const a = [{ index: 1, score: 9 }, { index: 2, score: 8 }, { index: 3, score: 7 }];
  const b = [{ index: 2, score: 0.9 }, { index: 1, score: 0.8 }, { index: 4, score: 0.7 }];
  const fused = rrf([a, b], 60);
  assert.deepEqual(fused.slice(0, 2).map((x) => x.index).sort(), [1, 2]);
  assert.ok(fused[0].score > fused[2].score);
  assert.deepEqual(rrf([a, b], 60), fused);
});

test("tokenizer keeps c++ and node.js identifiable and stems plurals", () => {
  assert.ok(tokenize("C++ and Node.js").includes("cpp"));
  assert.ok(tokenize("C++ and Node.js").includes("nodejs"));
  assert.deepEqual(tokenize("projects"), tokenize("project"));
});

test("BM25 ranks the matching document first and ignores non-matches", () => {
  const bm = new BM25(["hybrid rag platform multidocchat", "dropout predictor flask", "olympiad mathematics"]);
  const hits = bm.search("tell me about multidocchat", 3);
  assert.equal(hits[0].index, 0);
  assert.equal(bm.search("zzzz unrelated", 3).length, 0);
});

function fakeEmbedder(vec: number[], model = "m"): EmbeddingProvider {
  return { name: "f", model, dimensions: vec.length, embed: async () => [vec] };
}

const index: AssistantIndex = {
  schemaVersion: 1,
  embeddingModel: "m",
  dimensions: 2,
  chunks: [
    mk("a", "alpha topic rag", [1, 0]),
    mk("b", "beta other thing", [0, 1]),
    mk("c", "gamma rag keyword", [0.1, 0.9]),
  ],
};
const opts = { bm25K: 20, denseK: 20, topK: 2, rrfK: 60 };

test("hybrid retrieval fuses dense and keyword results", async () => {
  const r = await new Retriever(index, fakeEmbedder([1, 0]), opts).retrieve("rag");
  assert.equal(r.mode, "hybrid");
  assert.equal(r.hits[0].chunk.id, "a");
  assert.equal(r.hits.length, 2);
  assert.ok((r.topCosine ?? 0) > 0.99);
});

test("falls back to BM25 when embedding fails, there is no provider, or the model differs", async () => {
  const failing: EmbeddingProvider = { name: "f", model: "m", dimensions: 2, embed: async () => { throw new Error("boom"); } };
  for (const emb of [failing, null, fakeEmbedder([1, 0], "other-model")]) {
    const r = await new Retriever(index, emb, opts).retrieve("rag");
    assert.equal(r.mode, "bm25");
    assert.ok(r.hits.length > 0);
    assert.equal(r.topCosine, null);
    assert.ok(r.note);
  }
});
