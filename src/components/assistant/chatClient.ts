/**
 * Browser-side client for /api/chat: incremental SSE parsing, the fetch/stream loop and
 * the pure message reducer. No React and no secrets here; unit-tested in node.
 */
import type { SourceRef, UiMessage, WireEvent } from "./types";

export const DEFAULT_ENDPOINT = "/api/chat";
export const GENERIC_ERROR = "The assistant is unavailable right now. Please try again in a moment.";

/** Incremental parser: feed text chunks, get complete events back. Malformed blocks are skipped. */
export class SseParser {
  private buf = "";

  push(chunk: string): WireEvent[] {
    this.buf += chunk.replace(/\r\n/g, "\n");
    const out: WireEvent[] = [];
    let at: number;
    while ((at = this.buf.indexOf("\n\n")) >= 0) {
      const block = this.buf.slice(0, at);
      this.buf = this.buf.slice(at + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        const e = JSON.parse(data) as WireEvent;
        if (e && (e.type === "token" || e.type === "replace" || e.type === "done" || e.type === "error")) out.push(e);
      } catch {
        /* ignore a malformed block */
      }
    }
    return out;
  }
}

export class ChatClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function friendlyHttpError(status: number): string {
  if (status === 429) return "Too many questions in a short time. Please wait a little and try again.";
  if (status === 503) return "The assistant is resting for now. Please try again later or use the contact section.";
  if (status === 413) return "That message is too long. Please shorten it and try again.";
  if (status === 403) return "This page is not allowed to use the assistant.";
  return GENERIC_ERROR;
}

export interface StreamOptions {
  endpoint?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onEvent: (e: WireEvent) => void;
}

/** Resolves when the stream ends. Emits a final `error` event if it ended without `done`/`error`. */
export async function streamChat(o: StreamOptions): Promise<void> {
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(o.endpoint ?? DEFAULT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: o.messages }),
      signal: o.signal,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new ChatClientError(GENERIC_ERROR);
  }
  if (!res.ok || !res.body) {
    let message = friendlyHttpError(res.status);
    if (res.status === 429 || res.status === 503) {
      // Our own server writes a ready-to-show message for rate limits and the daily cap.
      try {
        const j = (await res.json()) as { message?: unknown };
        if (typeof j.message === "string" && j.message.length > 0 && j.message.length <= 400) message = j.message;
      } catch {
        /* keep the generic message */
      }
    }
    throw new ChatClientError(message, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const e of parser.push(decoder.decode(value, { stream: true }))) {
        if (e.type === "done" || e.type === "error") finished = true;
        o.onEvent(e);
      }
    }
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (!finished) o.onEvent({ type: "error", message: GENERIC_ERROR });
    return;
  }
  if (!finished) o.onEvent({ type: "error", message: GENERIC_ERROR });
}

/** Pure reducer for one assistant message. */
export function applyEvent(msg: UiMessage, e: WireEvent): UiMessage {
  switch (e.type) {
    case "token":
      return { ...msg, content: msg.content + e.text };
    case "replace":
      return { ...msg, content: e.text };
    case "done":
      return { ...msg, sources: dedupeSources(e.sources), refused: e.refused };
    case "error":
      return { ...msg, content: msg.content ? `${msg.content}\n\n${e.message}` : e.message, error: true };
  }
}

export function dedupeSources(sources: SourceRef[] | undefined): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const s of sources ?? []) {
    if (!s || typeof s.title !== "string" || seen.has(s.title)) continue;
    seen.add(s.title);
    out.push({ title: s.title, url: typeof s.url === "string" ? s.url : undefined });
  }
  return out;
}

/** History sent to the server: completed turns only, bounded (server also caps it). */
export function toHistory(messages: UiMessage[], question: string): { role: "user" | "assistant"; content: string }[] {
  const past = messages
    .filter((m) => !m.error && !m.refused && m.content.trim())
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  return [...past, { role: "user" as const, content: question }];
}
