"use client";
/**
 * Streaming chat state. Hold this hook in a component that outlives the panel (the pet bridge)
 * to keep the conversation across minimize/unsummon; ChatPanel creates its own otherwise.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { applyEvent, ChatClientError, GENERIC_ERROR, streamChat, toHistory } from "./chatClient";
import type { ChatStatus, UiMessage } from "./types";

export interface UseAssistantChatOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export interface AssistantChatController {
  messages: UiMessage[];
  status: ChatStatus;
  busy: boolean;
  send: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

export function useAssistantChat(opts: UseAssistantChatOptions = {}): AssistantChatController {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const messagesRef = useRef<UiMessage[]>([]);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastQuestionRef = useRef<string | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const commit = useCallback((next: UiMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const run = useCallback(
    async (question: string, base: UiMessage[]) => {
      const user: UiMessage = { id: nextId(), role: "user", content: question };
      const reply: UiMessage = { id: nextId(), role: "assistant", content: "" };
      const history = toHistory(base, question);
      commit([...base, user, reply]);
      busyRef.current = true;
      lastQuestionRef.current = question;
      setStatus("thinking");
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const update = (fn: (m: UiMessage) => UiMessage) =>
        commit(messagesRef.current.map((m) => (m.id === reply.id ? fn(m) : m)));
      let refused = false;
      let failed = false;
      try {
        await streamChat({
          endpoint: optsRef.current.endpoint,
          fetchImpl: optsRef.current.fetchImpl,
          messages: history,
          signal: ctrl.signal,
          onEvent: (e) => {
            if (e.type === "token" || e.type === "replace") setStatus("streaming");
            if (e.type === "done") refused = e.refused;
            if (e.type === "error") failed = true;
            update((m) => applyEvent(m, e));
          },
        });
      } catch (e) {
        if (ctrl.signal.aborted) {
          // user pressed stop: keep what was streamed, drop an empty bubble
          commit(messagesRef.current.filter((m) => !(m.id === reply.id && !m.content)));
          busyRef.current = false;
          setStatus("idle");
          return;
        }
        failed = true;
        const message = e instanceof ChatClientError ? e.message : GENERIC_ERROR;
        update((m) => applyEvent(m, { type: "error", message }));
      }
      busyRef.current = false;
      abortRef.current = null;
      setStatus(failed ? "error" : refused ? "refused" : "idle");
    },
    [commit],
  );

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busyRef.current) return;
      await run(q, messagesRef.current);
    },
    [run],
  );

  const retry = useCallback(async () => {
    const q = lastQuestionRef.current;
    if (!q || busyRef.current) return;
    // drop the failed exchange, then ask again
    const cur = messagesRef.current;
    const lastUser = cur.map((m) => m.role).lastIndexOf("user");
    await run(q, lastUser >= 0 ? cur.slice(0, lastUser) : cur);
  }, [run]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    busyRef.current = false;
    lastQuestionRef.current = null;
    commit([]);
    setStatus("idle");
  }, [commit]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, status, busy: status === "thinking" || status === "streaming", send, retry, stop, reset };
}
