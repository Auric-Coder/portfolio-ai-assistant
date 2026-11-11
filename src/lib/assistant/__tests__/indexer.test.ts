import test from "node:test";
import assert from "node:assert/strict";
import { assembleIndex, planUpdate, type NewChunk } from "../indexer";
import type { EmbeddingProvider } from "../embeddings";
import type { AssistantIndex } from "../types";
import { GeminiEmbeddings } from "../embeddings";

function chunk(id: string, text: string): NewChunk {
  return { id, file: "a.md", title: "A", heading: "", type: "faq", tags: [], links: {}, text, hash: `h:${text}` };
}

function mockProvider(model = "m1") {
  const calls: string[][] = [];
  const p: EmbeddingProvider & { calls: string[][] } = {
    name: "mock",
    model,
    dimensions: 2,
    calls,
    async embed(texts) {
      calls.push(texts);
      return texts.map((t) => [t.length, 1]);
    },
  };
  return p;
}

async function build(prev: AssistantIndex | null, fresh: NewChunk[], p: ReturnType<typeof mockProvider> | null) {
  const plan = planUpdate(prev, fresh, p, 1);
  return { plan, ...(await assembleIndex(plan, fresh, p, 1, prev)) };
}

test("first build embeds everything in one batched call", async () => {
  const p = mockProvider();
  const r = await build(null, [chunk("1", "alpha"), chunk("2", "beta")], p);
  assert.equal(r.embedded, 2);
  assert.equal(p.calls.length, 1);
  assert.equal(r.index.embeddingModel, "m1");
  assert.ok(r.index.chunks.every((c) => c.embedding));
});

test("second run with no changes makes zero embedding calls", async () => {
  const p = mockProvider();
  const fresh = [chunk("1", "alpha"), chunk("2", "beta")];
  const first = await build(null, fresh, p);
  const p2 = mockProvider();
  const second = await build(first.index, fresh, p2);
  assert.equal(p2.calls.length, 0);
  assert.equal(second.embeddingCalls, 0);
  assert.deepEqual(second.index, first.index);
});

test("only new or changed chunks are re-embedded; removed ones are dropped", async () => {
  const first = await build(null, [chunk("1", "alpha"), chunk("2", "beta")], mockProvider());
  const p = mockProvider();
  const r = await build(first.index, [chunk("1", "alpha"), chunk("2", "beta CHANGED"), chunk("3", "gamma")], p);
  assert.deepEqual(p.calls[0].sort(), ["beta CHANGED", "gamma"]);
  assert.equal(r.plan.removed, 1);
  assert.equal(r.index.chunks.length, 3);
});

test("metadata-only changes reuse the stored vector", async () => {
  const first = await build(null, [chunk("1", "alpha")], mockProvider());
  const moved = { ...chunk("9", "alpha"), file: "b.md" };
  const p = mockProvider();
  const r = await build(first.index, [moved], p);
  assert.equal(p.calls.length, 0);
  assert.equal(r.index.chunks[0].file, "b.md");
  assert.ok(r.index.chunks[0].embedding);
});

test("changing the embedding model forces a full rebuild", async () => {
  const first = await build(null, [chunk("1", "alpha")], mockProvider("m1"));
  const p = mockProvider("m2");
  const r = await build(first.index, [chunk("1", "alpha")], p);
  assert.equal(r.plan.fullRebuild, true);
  assert.equal(p.calls.length, 1);
  assert.equal(r.index.embeddingModel, "m2");
});

test("changing schemaVersion forces a full rebuild", async () => {
  const first = await build(null, [chunk("1", "alpha")], mockProvider());
  const plan = planUpdate(first.index, [chunk("1", "alpha")], mockProvider(), 2);
  assert.equal(plan.fullRebuild, true);
  assert.equal(plan.toEmbed.length, 1);
});

test("without a provider the index is BM25-only and existing vectors are kept", async () => {
  const noKey = await build(null, [chunk("1", "alpha")], null);
  assert.equal(noKey.index.embeddingModel, null);
  assert.equal(noKey.index.chunks[0].embedding, null);

  const withKey = await build(null, [chunk("1", "alpha")], mockProvider());
  const kept = await build(withKey.index, [chunk("1", "alpha")], null);
  assert.ok(kept.index.chunks[0].embedding, "vector must not be dropped when the key is missing");
  assert.equal(kept.index.embeddingModel, "m1");
});

test("a BM25-only index gets embedded once a provider appears", async () => {
  const bm25 = await build(null, [chunk("1", "alpha")], null);
  const p = mockProvider();
  const r = await build(bm25.index, [chunk("1", "alpha")], p);
  assert.equal(p.calls.length, 1);
  assert.ok(r.index.chunks[0].embedding);
});

test("duplicate chunk texts are embedded once", async () => {
  const p = mockProvider();
  await build(null, [chunk("1", "same"), chunk("2", "same")], p);
  assert.equal(p.calls[0].length, 1);
});

test("Gemini provider retries on 429 and never leaks the key in errors", async () => {
  let n = 0;
  const fetchImpl = (async () => {
    n++;
    if (n < 3) return new Response("{}", { status: 429 });
    return new Response(JSON.stringify({ embeddings: [{ values: [3, 4] }] }), { status: 200 });
  }) as typeof fetch;
  const g = new GeminiEmbeddings({ apiKey: "SECRET_KEY_VALUE", model: "m", dimensions: 2, fetchImpl, backoffMs: 0 });
  const [v] = await g.embed(["x"], "document");
  assert.equal(n, 3);
  assert.ok(Math.abs(v[0] - 0.6) < 1e-9 && Math.abs(v[1] - 0.8) < 1e-9, "vector is L2-normalised");

  const failing = new GeminiEmbeddings({
    apiKey: "SECRET_KEY_VALUE",
    model: "m",
    dimensions: 2,
    maxRetries: 1,
    backoffMs: 0,
    fetchImpl: (async () => new Response("{}", { status: 500 })) as typeof fetch,
  });
  await assert.rejects(
    () => failing.embed(["x"], "query"),
    (e: Error) => !e.message.includes("SECRET_KEY_VALUE"),
  );
});
