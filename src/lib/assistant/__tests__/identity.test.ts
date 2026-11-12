import test from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../bm25";
import { config } from "../config";
import { passesRelevanceGate } from "../guardrails";
import { buildIdentityPatterns, isIdentityQuestion } from "../identity";
import { prepareContext } from "../runtime";
import type { RetrievalResult } from "../retrieval";
import type { AssistantIndex, IndexChunk } from "../types";

const NOVA = "Nova";
const SUBJECT = "Hemanga";
const is = (q: string) => isIdentityQuestion(q, NOVA, SUBJECT);

test("identity questions are recognised", () => {
  for (const q of [
    "Who are you?", "who are you", "What are you?", "so who are you exactly", "Are you a bot?", "Are you an AI?", "are you a real person?",
    "Are you human", "Are you a chatbot?", "Is this a bot?", "Am I talking to a human?", "What is your name?", "what should I call you",
    "Are you Nova?", "Are you Hemanga?", "r u a bot", "Are you an actual person?",
    "Who made you?", "who built you", "Who created you", "How do you work?", "how does this assistant work", "How were you built?", "What can you do?", "Did Hemanga build you?", "did hemanga make you",
  ]) {
    assert.ok(is(q), q);
  }
});

test("questions about the person or the work are not identity questions", () => {
  for (const q of [
    "Who is Hemanga?", "What are your skills?", "What are his projects?", "Tell me about his AI work", "Are you hiring him?",
    "What is his name?", "Who built MultiDocChat?", "What does the assistant do?", "Is this his portfolio?", "Where has he interned?",
    "How does MultiDocChat work?", "Who made DropoutQI?", "How do you implement retrieval in MultiDocChat?", "Did Hemanga build MultiDocChat?",
  ]) {
    assert.ok(!is(q), q);
  }
});

test("the identity patterns follow the configured names (forks)", () => {
  assert.ok(isIdentityQuestion("Are you Sage?", "Sage", "Priya Rao"));
  assert.ok(isIdentityQuestion("are you priya rao?", "Sage", "Priya Rao"));
  assert.ok(!isIdentityQuestion("Are you Nova?", "Sage", "Priya Rao"));
  assert.doesNotThrow(() => buildIdentityPatterns("A.B (x)", "Dr. [Q]+"));
});

// ---- the gate ---------------------------------------------------------------------------------

function chunk(id: string, text: string): IndexChunk {
  return { id, file: `${id}.md`, title: `T ${id}`, heading: "", type: "faq", tags: [], links: {}, text, hash: id, embedding: [1, 0, 0] };
}
const index: AssistantIndex = { schemaVersion: 1, embeddingModel: "m", dimensions: 3, chunks: [chunk("a", "multidocchat hybrid rag platform")] };
const unrelated = { name: "t", model: "m", dimensions: 3, embed: async () => [[0, 0, 1]] }; // cosine 0 with the only chunk

test("identity questions reach the model even when nothing in the knowledge base matches", async () => {
  for (const q of ["Who are you?", "Are you a real person?", "What are you?"]) {
    const ctx = await prepareContext(q, index, unrelated);
    assert.equal(ctx.refused, false, q);
  }
  // an unrelated question with the same (non-)match is still refused by the gate
  const off = await prepareContext("What is the capital of France?", index, unrelated);
  assert.equal(off.refused, true);
  assert.equal(off.reason, "irrelevant");
  // the pre-filter still runs first: an identity-shaped request for contact details stays blocked
  const blocked = await prepareContext("Who are you and what is your phone number?", index, unrelated);
  assert.equal(blocked.refused, true);
  assert.equal(blocked.reason, "contact-details");
});

function result(topCosine: number, topBm25: number): RetrievalResult {
  return { hits: [{ chunk: chunk("a", "x"), score: 1 }], mode: "hybrid", topCosine, topBm25 };
}

test("gate: a pure semantic match at cosine 0.70 or more passes without keyword overlap; just below does not", () => {
  assert.equal(config.gate.strongCosine, 0.7);
  assert.equal(passesRelevanceGate(result(0.718, 0), config.gate), true, '"Where has he interned?" scored 0.718');
  assert.equal(passesRelevanceGate(result(0.70, 0), config.gate), true);
  assert.equal(passesRelevanceGate(result(0.69, 0), config.gate), false);
  assert.equal(passesRelevanceGate(result(0.69, 2), config.gate), true, "with some keyword overlap the lower line still applies");
  assert.equal(passesRelevanceGate(result(0.55, 9), config.gate), false, "plain off-topic scores (<= 0.55) stay refused");
});

// ---- keyword matching of related word forms -----------------------------------------------------

test("BM25 joins intern/interned/internship/interns and work/worked/working", () => {
  assert.deepEqual(tokenize("Where has he interned?"), ["intern"]);
  for (const w of ["internship", "internships", "interns", "interning", "interned", "intern"]) assert.deepEqual(tokenize(w), ["intern"], w);
  for (const w of ["worked", "working", "works", "work"]) assert.deepEqual(tokenize(w), ["work"], w);
  assert.deepEqual(tokenize("Has he worked anywhere?").includes("work"), true);
  // unrelated words keep their own stem
  assert.deepEqual(tokenize("network"), ["network"]);
  assert.deepEqual(tokenize("framework"), ["framework"]);
});
