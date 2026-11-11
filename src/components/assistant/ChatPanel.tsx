"use client";
/**
 * ChatPanel: the generic, position-agnostic chat UI. Any launcher can drive it (the pet
 * bridge on the site, ChatWidget in the mirror) through the contract below; the parent
 * positions it. It never imports site code.
 *
 * Contract: { mode, pinned, onModeChange, onPinnedChange, onStatusChange, config }
 *  - mode "minimized" renders a small chip; "expanded" renders the full panel.
 *  - Hover (mouse/pen only, ~150 ms in, ~400 ms out) expands/collapses it unless pinned or
 *    `hoverEnabled` is false (the pet bridge sets it false while the pet is dragged).
 *  - Clicking the chip, focusing/typing in the input and an in-flight answer pin it open.
 *    Esc or the minimize button unpins and collapses it. Touch has no hover: a tap pins.
 *  - Moving focus back to the launcher after minimizing is the parent's job (onModeChange).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Markdown } from "./markdown";
import { assistantCss } from "./styles";
import type { ChatPanelConfig, ChatStatus, PanelMode, UiMessage } from "./types";
import { useAssistantChat, type AssistantChatController } from "./useAssistantChat";

export const HOVER_OPEN_MS = 150;
export const HOVER_CLOSE_MS = 400;
export const PRIVACY_NOTE = "Questions are sent to an AI provider. Please don't share personal information.";

export interface ChatPanelProps {
  mode: PanelMode;
  pinned: boolean;
  onModeChange: (mode: PanelMode) => void;
  onPinnedChange: (pinned: boolean) => void;
  onStatusChange?: (status: ChatStatus) => void;
  config: ChatPanelConfig;
  /** Keep the conversation in the parent (survives unmount). Defaults to an internal chat. */
  controller?: AssistantChatController;
  /** Set false to block hover expansion (e.g. while the pet is dragged). Default true. */
  hoverEnabled?: boolean;
  /** "sheet" = full-width bottom sheet for narrow viewports. Default "floating". */
  layout?: "floating" | "sheet";
  endpoint?: string;
}

export function ChatPanel(props: ChatPanelProps) {
  const { mode, pinned, config, layout = "floating" } = props;
  const own = useAssistantChat({ endpoint: props.endpoint });
  const chat = props.controller ?? own;

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draft, setDraft] = useState("");

  // Latest props for timers/effects, so they never act on stale values.
  const live = useRef(props);
  useEffect(() => {
    live.current = props;
  });

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = closeTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const minimize = useCallback(() => {
    clearTimers();
    live.current.onPinnedChange(false);
    live.current.onModeChange("minimized");
  }, [clearTimers]);

  const pin = useCallback(() => {
    clearTimers();
    if (!live.current.pinned) live.current.onPinnedChange(true);
  }, [clearTimers]);

  useEffect(() => {
    props.onStatusChange?.(chat.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status]);

  // An in-flight answer keeps the panel open.
  useEffect(() => {
    if (chat.busy && mode === "expanded" && !pinned) props.onPinnedChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.busy, mode, pinned]);

  // Opened on purpose (pinned): move focus into the input. A hover peek must not steal focus.
  useEffect(() => {
    if (mode === "expanded" && pinned && !rootRef.current?.contains(document.activeElement)) inputRef.current?.focus();
  }, [mode, pinned]);

  // Keep the newest text visible.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.status, mode]);

  const onPointerEnter = (e: PointerEvent) => {
    if (e.pointerType === "touch" || live.current.hoverEnabled === false) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (live.current.mode === "minimized" && !openTimer.current) {
      openTimer.current = setTimeout(() => {
        openTimer.current = null;
        if (live.current.mode === "minimized" && live.current.hoverEnabled !== false) live.current.onModeChange("expanded");
      }, HOVER_OPEN_MS);
    }
  };

  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    if (live.current.mode === "expanded" && !live.current.pinned && !closeTimer.current) {
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null;
        const focused = rootRef.current?.contains(document.activeElement);
        if (live.current.mode === "expanded" && !live.current.pinned && !focused) live.current.onModeChange("minimized");
      }, HOVER_CLOSE_MS);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && mode === "expanded") {
      e.stopPropagation();
      minimize();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || chat.busy) return;
    setDraft("");
    void chat.send(text);
    inputRef.current?.focus(); // keep keyboard focus (Esc, typing) after the Send button disables
  };

  const name = config.assistantName;
  const lastIsError = chat.messages.length > 0 && chat.messages[chat.messages.length - 1].error;

  return (
    <div
      ref={rootRef}
      className="nova-root"
      data-mode={mode}
      data-pinned={pinned ? "true" : "false"}
      data-status={chat.status}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
    >
      <style href="nova-assistant-css" precedence="medium">
        {assistantCss}
      </style>

      {mode === "minimized" ? (
        <button
          type="button"
          className="nova-chip"
          aria-expanded={false}
          aria-label={`Ask ${name}, the AI assistant`}
          onClick={() => {
            clearTimers();
            props.onModeChange("expanded");
            props.onPinnedChange(true);
          }}
        >
          <span className="nova-dot" data-status={chat.status} aria-hidden="true" />
          Ask {name}
        </button>
      ) : (
        <section className="nova-panel" data-layout={layout} role="region" aria-label={`AI assistant ${name}`}>
          <header className="nova-header">
            <div className="nova-title">
              <span className="nova-dot" data-status={chat.status} aria-hidden="true" />
              <span>AI assistant · {name}</span>
            </div>
            <button type="button" className="nova-icon-btn" aria-label="Minimize chat" onClick={minimize}>
              <span aria-hidden="true">–</span>
            </button>
          </header>

          <div ref={logRef} className="nova-log" role="log" aria-live="polite" aria-relevant="additions text" aria-busy={chat.busy}>
            <div className="nova-msg" data-role="assistant">
              <Markdown text={config.greeting} />
            </div>

            {chat.messages.length === 0 && (
              <div className="nova-starters" aria-label="Suggested questions">
                {config.starterQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="nova-starter"
                    onClick={() => {
                      pin();
                      void chat.send(q);
                      inputRef.current?.focus(); // the chip unmounts; keep focus in the panel
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {chat.messages.map((m) => (
              <MessageBubble key={m.id} message={m} showSources={config.showSources ?? true} thinking={chat.status === "thinking" && !m.content && m.role === "assistant"} name={name} />
            ))}

            {lastIsError && !chat.busy && (
              <div>
                <button type="button" className="nova-retry" onClick={() => void chat.retry()}>
                  Try again
                </button>
              </div>
            )}
          </div>

          <form className="nova-form" onSubmit={submit}>
            <input
              ref={inputRef}
              className="nova-input"
              type="text"
              value={draft}
              maxLength={500}
              placeholder={`Ask ${name} about ${config.subjectName}`}
              aria-label={`Ask ${name} a question`}
              autoComplete="off"
              onFocus={pin}
              onChange={(e) => {
                setDraft(e.target.value);
                pin();
              }}
            />
            {chat.busy ? (
              <button type="button" className="nova-send" onClick={chat.stop}>
                Stop
              </button>
            ) : (
              <button type="submit" className="nova-send" disabled={!draft.trim()}>
                Send
              </button>
            )}
          </form>
          <p className="nova-note">{PRIVACY_NOTE}</p>
        </section>
      )}
    </div>
  );
}

function MessageBubble({ message: m, thinking, name, showSources }: { message: UiMessage; thinking: boolean; name: string; showSources: boolean }) {
  return (
    <div className="nova-msg" data-role={m.role} data-error={m.error ? "true" : undefined} data-refused={m.refused ? "true" : undefined}>
      {m.role === "user" ? (
        <p>{m.content}</p>
      ) : thinking ? (
        <span className="nova-typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <Markdown text={m.content} />
      )}
      {thinking && <span className="nova-sr">{name} is thinking</span>}
      {showSources && m.sources && m.sources.length > 0 && (
        <div className="nova-sources" aria-label="Sources">
          {m.sources.map((s) =>
            s.url && /^https?:\/\//i.test(s.url) ? (
              <a key={s.title} className="nova-src" href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
            ) : (
              <span key={s.title} className="nova-src">
                {s.title}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
