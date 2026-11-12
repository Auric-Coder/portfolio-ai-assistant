/**
 * Shared pipeline pieces used by the CLI (scripts/ask.ts) and the route handler:
 * load the index, build a retriever, and run pre-filter + retrieval + gate.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { createEmbeddingProvider, type EmbeddingProvider } from "./embeddings";
import { passesRelevanceGate, preFilter, type RefusalReason } from "./guardrails";
import { isIdentityQuestion } from "./identity";
import { Retriever, type RetrievalResult } from "./retrieval";
import type { AssistantIndex } from "./types";

let cached: { key: string; index: AssistantIndex } | null = null;

/** Read the index from disk (CLI / tests). The route handler uses loadBundledIndex. */
export function loadIndexFromFile(p = config.indexPath): AssistantIndex {
  const abs = path.resolve(process.cwd(), p);
  const key = abs;
  if (cached?.key === key) return cached.index;
  const index = JSON.parse(fs.readFileSync(abs, "utf8")) as AssistantIndex;
  cached = { key, index };
  return index;
}

export interface AnswerContext {
  refused: boolean;
  reason?: RefusalReason;
  retrieval?: RetrievalResult;
  /** Milliseconds spent getting the retriever ready (cached per instance, so ~0 when warm). */
  indexMs?: number;
}

/** Everything before the LLM: pre-filter, retrieval, relevance gate. */
export async function prepareContext(
  question: string,
  index: AssistantIndex,
  embedder: EmbeddingProvider | null = createEmbeddingProvider(config.embedding),
): Promise<AnswerContext> {
  const guard = preFilter(question);
  if (guard.blocked) return { refused: true, reason: guard.reason };
  const t0 = performance.now();
  const retriever = new Retriever(index, embedder, config.retrieval);
  const indexMs = performance.now() - t0;
  const retrieval = await retriever.retrieve(question);
  // Questions about the assistant itself ("Who are you?") never match the knowledge base; they go to the model.
  const identity = isIdentityQuestion(question, config.site.assistantName, config.site.subjectName);
  if (!identity && !passesRelevanceGate(retrieval, config.gate)) return { refused: true, reason: "irrelevant", retrieval, indexMs };
  return { refused: false, retrieval, indexMs };
}
