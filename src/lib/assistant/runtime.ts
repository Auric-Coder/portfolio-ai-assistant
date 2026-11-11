/**
 * Shared pipeline pieces used by the CLI (scripts/ask.ts) and the route handler:
 * load the index, build a retriever, and run pre-filter + retrieval + gate.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { createEmbeddingProvider, type EmbeddingProvider } from "./embeddings";
import { passesRelevanceGate, preFilter, type RefusalReason } from "./guardrails";
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
}

/** Everything before the LLM: pre-filter, retrieval, relevance gate. */
export async function prepareContext(
  question: string,
  index: AssistantIndex,
  embedder: EmbeddingProvider | null = createEmbeddingProvider(config.embedding),
): Promise<AnswerContext> {
  const guard = preFilter(question);
  if (guard.blocked) return { refused: true, reason: guard.reason };
  const retriever = new Retriever(index, embedder, config.retrieval);
  const retrieval = await retriever.retrieve(question);
  if (!passesRelevanceGate(retrieval, config.gate)) return { refused: true, reason: "irrelevant", retrieval };
  return { refused: false, retrieval };
}
