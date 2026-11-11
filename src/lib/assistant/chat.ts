/**
 * Chat pipeline core (plan section 3, steps 2-8). Framework-free so it can be tested
 * without Next.js: the route handler only adapts Request/Response around it.
 * Rate limiting (step 1) is applied by the route before this runs.
 */
import { config } from "./config";
import type { EmbeddingProvider } from "./embeddings";
import { refusalMessage, type RefusalReason } from "./guardrails";
import { streamWithFailover, type LLMProvider } from "./llm";
import type { ChatTurn } from "./llm/types";
import { buildMessages, buildReminder, buildSystemPrompt } from "./prompt";
import { resolvePronouns } from "./pronouns";
import { prepareContext } from "./runtime";
import type { AssistantIndex, SourceChunk } from "./types";

export type ChatEvent =
  | { type: "token"; text: string }
  /** Output guard: discard everything streamed so far and show this text instead. */
  | { type: "replace"; text: string }
  | { type: "done"; sources: SourceChunk[]; refused: boolean; reason?: RefusalReason }
  | { type: "error"; message: string };

export interface ChatDeps {
  index: AssistantIndex;
  embedder: EmbeddingProvider | null;
  providers: LLMProvider[];
  onFailover?: (e: { provider: string; error: string }) => void;
  /** Called with anonymised retrieval facts (Phase 7 logging hooks in here). */
  onResult?: (r: { refused: boolean; reason?: RefusalReason; topCosine: number | null; topBm25: number; mode?: string }) => void;
  /** Called once when the request finishes (also if the client disconnects), for the anonymised log. */
  onComplete?: (r: CompleteInfo) => void;
}

export interface CompleteInfo {
  question: string;
  refused: boolean;
  reason?: RefusalReason;
  topCosine: number | null;
  topBm25: number;
  mode?: string;
  answer: string;
  provider?: string;
  ms: number;
  error: boolean;
}

/**
 * Output guard: Nova never needs a code block. A fenced block in a reply means the model started
 * writing code (or another off-topic work product), so the reply is cut at the first fence.
 */
export const CODE_FENCE = /```|~~~/;

export type ParseResult = { ok: true; history: ChatTurn[]; question: string } | { ok: false; error: string };

/** Validate the request body: `{ messages: [{role, content}] }`, last message from the user. */
export function parseMessages(body: unknown): ParseResult {
  const msgs = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return { ok: false, error: "messages must be a non-empty array" };
  const clean: ChatTurn[] = [];
  for (const m of msgs.slice(-20)) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string")
      return { ok: false, error: "each message needs a role (user|assistant) and string content" };
    clean.push({ role, content });
  }
  const last = clean[clean.length - 1];
  if (last.role !== "user") return { ok: false, error: "the last message must be from the user" };
  return { ok: true, history: clean.slice(0, -1), question: last.content };
}

export function toSources(hits: { chunk: { title: string; links: Record<string, string> } }[]): SourceChunk[] {
  const seen = new Set<string>();
  const out: SourceChunk[] = [];
  for (const h of hits) {
    if (seen.has(h.chunk.title)) continue;
    seen.add(h.chunk.title);
    const url = h.chunk.links.demo ?? h.chunk.links.repo ?? h.chunk.links.site;
    out.push(url ? { title: h.chunk.title, url } : { title: h.chunk.title });
  }
  return out;
}

export async function* runChat(history: ChatTurn[], question: string, deps: ChatDeps): AsyncGenerator<ChatEvent> {
  const pronouns = resolvePronouns(config.site.pronouns);
  const t0 = Date.now();
  let info: Omit<CompleteInfo, "answer" | "provider" | "ms" | "error" | "question"> = { refused: false, topCosine: null, topBm25: 0 };
  let answer = "";
  let provider: string | undefined;
  let error = false;
  try {
    const ctx = await prepareContext(question, deps.index, deps.embedder);
    info = {
      refused: ctx.refused,
      reason: ctx.reason,
      topCosine: ctx.retrieval?.topCosine ?? null,
      topBm25: ctx.retrieval?.topBm25 ?? 0,
      mode: ctx.retrieval?.mode,
    };
    deps.onResult?.(info);

    // Refused questions never reach the LLM.
    if (ctx.refused) {
      yield { type: "token", text: refusalMessage(ctx.reason!, config.site.contactUrl, config.site.subjectName, pronouns) };
      yield { type: "done", sources: [], refused: true, reason: ctx.reason };
      return;
    }

    const hits = ctx.retrieval!.hits;
    const upstream = new AbortController();
    try {
      const stream = streamWithFailover(
        deps.providers,
        {
          system: buildSystemPrompt(config.site),
          messages: buildMessages(history, question, hits, config.chat, {
            reminder: buildReminder(config.site),
            extraLinks: config.site.githubUrl ? [{ label: `GitHub profile (all ${pronouns.possessive} public repositories)`, url: config.site.githubUrl }] : [],
          }),
          maxTokens: config.llm.maxTokens,
          temperature: config.llm.temperature,
          signal: upstream.signal,
        },
        deps.onFailover,
      );
      for await (const { text, provider: p } of stream) {
        provider = p;
        if (CODE_FENCE.test(answer + text)) {
          // Output guard: stop the model, drop what was streamed, show the decline instead.
          upstream.abort();
          const decline = refusalMessage("off-topic", config.site.contactUrl, config.site.subjectName, pronouns);
          info = { ...info, refused: true, reason: "off-topic" };
          answer = decline;
          yield { type: "replace", text: decline };
          yield { type: "done", sources: [], refused: true, reason: "off-topic" };
          return;
        }
        answer += text;
        yield { type: "token", text };
      }
      yield { type: "done", sources: toSources(hits), refused: false };
    } catch {
      error = true;
      // Providers' error text can contain upstream details; send a fixed message only.
      yield { type: "error", message: "The assistant is unavailable right now. Please try again in a moment." };
    }
  } finally {
    try {
      deps.onComplete?.({ question, ...info, answer, provider, ms: Date.now() - t0, error });
    } catch {
      /* logging must never affect the response */
    }
  }
}
