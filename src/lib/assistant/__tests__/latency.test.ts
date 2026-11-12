import test from "node:test";
import assert from "node:assert/strict";
import { assembleIndex, planUpdate, type NewChunk } from "../indexer";
import { handleChat } from "../http";
import { missingEnv, missingEnvNote } from "../envcheck";
import { runChat } from "../chat";
import type { EmbeddingProvider } from "../embeddings";
import { LLMError, type LLMProvider } from "../llm";
import { normalizeQuery } from "../query";
import { Retriever, retrievalStats, type RetrievalOptions } from "../retrieval";
import { serverTimingHeader, type Timings } from "../timing";
import type { AssistantIndex, IndexChunk } from "../types";

const opts: RetrievalOptions = { bm25K: 20, denseK: 20, topK: 5, rrfK: 60, embedTimeoutMs: 1500 };
const STARTER = "What's his tech stack?";

function chunk(id: string, text: string, embedding: number[] | null = [1, 0, 0]): IndexChunk {
  return { id, file: `${id}.md`, title: `Title ${id}`, heading: "", type: "faq", tags: [], links: {}, text, hash: id, embedding };
}
function makeIndex(extra: Partial<AssistantIndex> = {}): AssistantIndex {
  return {
    schemaVersion: 1,
    embeddingModel: "m",
    dimensions: 3,
    chunks: [chunk("a", "python is his primary language and pytorch"), chunk("b", "multidocchat hybrid rag platform", [0, 1, 0])],
    ...extra,
  };
}
function embedder(impl: (texts: string[]) => Promise<number[][]>) {
  let calls = 0;
  const e: EmbeddingProvider & { calls: () => number } = {
    name: "t",
    model: "m",
    dimensions: 3,
    calls: () => calls,
    embed: async (texts) => {
      calls++;
      return impl(texts);
    },
  };
  return e;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- index and BM25 are prepared once, not per request ----------------------------------

test("the BM25 index is built once per loaded index, not once per request", async () => {
  const index = makeIndex();
  const e = embedder(async () => [[1, 0, 0]]);
  const before = retrievalStats.bm25Builds;
  for (let i = 0; i < 25; i++) await new Retriever(index, e, opts).retrieve("python language");
  assert.equal(retrievalStats.bm25Builds - before, 1, "25 requests, one BM25 build");
  await new Retriever(makeIndex(), e, opts).retrieve("python"); // a different index object is its own instance
  assert.equal(retrievalStats.bm25Builds - before, 2);
});

test("the bundled index module is parsed once per instance: every call returns the same object", async () => {
  const { loadBundledIndex } = await import("../bundledIndex");
  assert.equal(loadBundledIndex(), loadBundledIndex());
});

// ---- embedding: in flight alongside BM25, with a timeout and a starter cache --------------

test("the embedding call starts before BM25 runs, and its wait is not part of the retrieval time", async () => {
  const e = embedder(async () => {
    await sleep(120);
    return [[1, 0, 0]];
  });
  const p = new Retriever(makeIndex(), e, opts).retrieve("python language");
  assert.equal(e.calls(), 1, "embed was called synchronously, before the first await");
  const r = await p;
  assert.equal(r.mode, "hybrid");
  assert.equal(r.timings?.embedSource, "api");
  assert.ok((r.timings?.embedMs ?? 0) >= 100, `embed wait measured: ${r.timings?.embedMs}`);
  assert.ok((r.timings?.retrieveMs ?? 999) < 60, `retrieval excludes the embedding wait: ${r.timings?.retrieveMs}`);
});

test("a slow embedding call is abandoned after the timeout and retrieval continues with BM25 only", async () => {
  let lateRejection = false;
  const e = embedder(async () => {
    await sleep(400);
    lateRejection = true;
    throw new Error("late failure after the timeout"); // must not become an unhandled rejection
  });
  const started = performance.now();
  const r = await new Retriever(makeIndex(), e, { ...opts, embedTimeoutMs: 50 }).retrieve("python language");
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 300, `gave up in time: ${elapsed} ms`);
  assert.equal(r.mode, "bm25");
  assert.equal(r.topCosine, null);
  assert.equal(r.timings?.embedSource, "timeout");
  assert.match(r.note ?? "", /timed out after 50 ms/);
  assert.ok(r.hits.length > 0 && r.hits[0].chunk.id === "a", "BM25 still finds the answer");
  await sleep(450);
  assert.equal(lateRejection, true, "the abandoned call did finish later without crashing the process");
});

test("a failing embedding call falls back to BM25 and says so", async () => {
  const e = embedder(async () => {
    throw new Error("500");
  });
  const r = await new Retriever(makeIndex(), e, opts).retrieve("python language");
  assert.equal(r.mode, "bm25");
  assert.equal(r.timings?.embedSource, "error");
  assert.match(r.note ?? "", /failed/);
});

test("starter questions use their precomputed embedding: no API call, tolerant of case, spacing and punctuation", async () => {
  const index = makeIndex({ queryEmbeddings: [{ text: STARTER, embedding: [1, 0, 0] }] });
  const e = embedder(async () => {
    throw new Error("must not be called");
  });
  for (const q of [STARTER, "what's his tech stack", "  WHAT’S his  tech stack?? ", "What's his tech stack."]) {
    const r = await new Retriever(index, e, opts).retrieve(q);
    assert.equal(r.timings?.embedSource, "starter-cache", q);
    assert.equal(r.mode, "hybrid", q);
    assert.equal(r.timings?.embedMs, 0);
  }
  assert.equal(e.calls(), 0);
  // any other question still goes to the API
  const e2 = embedder(async () => [[1, 0, 0]]);
  const r2 = await new Retriever(index, e2, opts).retrieve("a different question about python");
  assert.equal(r2.timings?.embedSource, "api");
  assert.equal(e2.calls(), 1);
  assert.equal(normalizeQuery("What’s his tech stack?"), "what's his tech stack");
});

test("the starter cache is ignored when the query model differs from the index model", async () => {
  const index = makeIndex({ embeddingModel: "other-model", queryEmbeddings: [{ text: STARTER, embedding: [1, 0, 0] }] });
  const e = embedder(async () => [[1, 0, 0]]);
  const r = await new Retriever(index, e, opts).retrieve(STARTER);
  assert.equal(r.mode, "bm25");
  assert.equal(r.timings?.embedSource, "none");
  assert.equal(e.calls(), 0);
});

// ---- the indexer precomputes the starter embeddings -------------------------------------------

function chunkNew(id: string, text: string): NewChunk {
  return { id, file: "a.md", title: "A", heading: "", type: "faq", tags: [], links: {}, text, hash: `h:${text}` };
}
function countingProvider(model = "m1") {
  const calls: { texts: string[]; task: string }[] = [];
  const p: EmbeddingProvider & { calls: typeof calls } = {
    name: "mock",
    model,
    dimensions: 2,
    calls,
    async embed(texts, task) {
      calls.push({ texts, task });
      return texts.map((t) => [t.length, 1]);
    },
  };
  return p;
}
async function build(prev: AssistantIndex | null, p: ReturnType<typeof countingProvider>, starters: string[]) {
  const fresh = [chunkNew("1", "one"), chunkNew("2", "two")];
  const plan = planUpdate(prev, fresh, p, 1);
  return assembleIndex(plan, fresh, p, 1, prev, starters);
}

test("indexer: starter embeddings are computed once as queries, reused on rebuild, and recomputed only when needed", async () => {
  const starters = ["First starter?", "Second starter?"];
  const p1 = countingProvider();
  const a = await build(null, p1, starters);
  assert.deepEqual(a.index.queryEmbeddings?.map((q) => q.text), starters);
  assert.ok(p1.calls.some((c) => c.task === "query" && c.texts.length === 2), "one batched query call for both starters");

  const p2 = countingProvider();
  const b = await build(a.index, p2, starters);
  assert.equal(p2.calls.length, 0, "unchanged knowledge and starters: zero embedding calls");
  assert.deepEqual(b.index.queryEmbeddings, a.index.queryEmbeddings);

  const p3 = countingProvider();
  const c = await build(a.index, p3, ["First starter?", "A new second starter?"]);
  assert.equal(p3.calls.length, 1);
  assert.deepEqual(p3.calls[0].texts, ["A new second starter?"], "only the changed starter is embedded");
  assert.deepEqual(c.index.queryEmbeddings?.map((q) => q.text), ["First starter?", "A new second starter?"]);

  const p4 = countingProvider("m2");
  const d = await build(a.index, p4, starters);
  assert.ok(p4.calls.some((x) => x.task === "query"), "a new embedding model recomputes the starters");
  assert.equal(d.index.embeddingModel, "m2");
});

test("indexer: no starters configured means no queryEmbeddings field", async () => {
  const a = await build(null, countingProvider(), []);
  assert.equal("queryEmbeddings" in a.index, false);
});

// ---- Server-Timing, provider and failover -----------------------------------------------------

test("serverTimingHeader formats durations, the provider, the failover chain and the cold flag", () => {
  const t: Timings = { index: 0.04, embed: 312.46, retrieve: 2.1, ttft: 840, provider: "gemini", failover: ["nvidia"], embedSource: "api", cold: true };
  assert.equal(serverTimingHeader(t), 'index;dur=0, embed;dur=312.5, retrieve;dur=2.1, ttft;dur=840, embedsrc;desc="api", provider;desc="gemini", failover;desc="nvidia", cold;desc="1"');
  assert.equal(serverTimingHeader({}), "");
});

function provider(name: string, impl: () => AsyncGenerator<string>): LLMProvider {
  return { name, model: "m", stream: impl };
}
const bad = provider("nvidia", async function* () {
  throw new LLMError("nvidia responded 404", 404);
});
const good = provider("gemini", async function* () {
  await sleep(30);
  yield "Answer.";
});
const idx = makeIndex();
const emb = embedder(async () => [[1, 0, 0]]);
const post = (q: string) =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost" },
    body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
  });

test("the response carries Server-Timing with every stage, the provider used and the failover", async () => {
  const res = await handleChat(post("python language"), { index: idx, embedder: emb, providers: [bad, good], timings: { index: 0.3 } });
  const header = res.headers.get("server-timing") ?? "";
  for (const part of ["index;dur=", "embed;dur=", "retrieve;dur=", "ttft;dur=", 'provider;desc="gemini"', 'failover;desc="nvidia"', 'embedsrc;desc="api"']) {
    assert.ok(header.includes(part), `${part} in ${header}`);
  }
  const body = await res.text();
  assert.ok(body.includes('"type":"token"') && body.includes('"type":"done"'), "the stream itself is unchanged");
});

test("without a failover the header names only the provider that answered; a refusal has no provider", async () => {
  const ok = await handleChat(post("python language"), { index: idx, embedder: emb, providers: [good] });
  const h = ok.headers.get("server-timing") ?? "";
  assert.ok(h.includes('provider;desc="gemini"') && !h.includes("failover"), h);
  await ok.text();
  const refused = await handleChat(post("what is his phone number"), { index: idx, embedder: emb, providers: [good] });
  const hr = refused.headers.get("server-timing") ?? "";
  assert.ok(!hr.includes("provider;desc"), hr);
  await refused.text();
});

test("the completion log hook receives timings, the provider used and the failover list", async () => {
  let info: { timings: Timings; provider?: string } | undefined;
  for await (const e of runChat([], "python language", { index: idx, embedder: emb, providers: [bad, good], onComplete: (r) => (info = r) })) void e;
  assert.equal(info?.provider, "gemini");
  assert.deepEqual(info?.timings.failover, ["nvidia"]);
  assert.equal(info?.timings.provider, "gemini");
  for (const k of ["index", "embed", "retrieve", "ttft", "total"] as const) assert.equal(typeof info?.timings[k], "number", k);
  assert.ok((info?.timings.total ?? 0) >= (info?.timings.ttft ?? 1));
});

// ---- startup note for missing keys --------------------------------------------------------------

test("missing keys are named with their effect, and values are never part of the note", () => {
  const env = { NVIDIA_API_KEY: "super-secret-value-123", GEMINI_API_KEY: "  ", UPSTASH_REDIS_REST_URL: "https://x.example" };
  const missing = missingEnv(env).map((m) => m.name);
  assert.deepEqual(missing, ["GEMINI_API_KEY", "UPSTASH_REDIS_REST_TOKEN", "IP_HASH_SALT"]);
  const note = missingEnvNote(env) ?? "";
  assert.ok(note.includes("GEMINI_API_KEY") && note.includes("keyword-only retrieval"));
  assert.ok(!note.includes("super-secret-value-123") && !note.includes("https://x.example") && !note.includes("NVIDIA_API_KEY"));
  assert.equal(missingEnvNote({ NVIDIA_API_KEY: "a", GEMINI_API_KEY: "b", UPSTASH_REDIS_REST_URL: "c", UPSTASH_REDIS_REST_TOKEN: "d", IP_HASH_SALT: "e" }), null);
});
