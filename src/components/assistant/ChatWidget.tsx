"use client";
/** Plain floating-button launcher around ChatPanel. Used by the public mirror (the site uses the pet). */
import { useState } from "react";
import { ChatPanel } from "./ChatPanel";
import type { ChatPanelConfig, ChatStatus } from "./types";
import { useAssistantChat } from "./useAssistantChat";

export interface ChatWidgetProps {
  config: ChatPanelConfig;
  endpoint?: string;
  onStatusChange?: (s: ChatStatus) => void;
}

export function ChatWidget({ config, endpoint, onStatusChange }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Held here so the conversation survives closing and re-opening the panel.
  const chat = useAssistantChat({ endpoint });

  return (
    <div className="nova-root">
      {open && (
        <div className="nova-widget">
          <ChatPanel
            mode="expanded"
            pinned={pinned}
            controller={chat}
            config={config}
            endpoint={endpoint}
            hoverEnabled={false}
            onPinnedChange={setPinned}
            onStatusChange={onStatusChange}
            onModeChange={(m) => {
              if (m === "minimized") setOpen(false);
            }}
          />
        </div>
      )}
      <button
        type="button"
        className="nova-launcher"
        aria-expanded={open}
        aria-label={open ? `Close ${config.assistantName}` : `Chat with ${config.assistantName}, the AI assistant`}
        onClick={() => {
          setOpen((v) => !v);
          setPinned(true);
        }}
      >
        <span aria-hidden="true">{open ? "×" : "💬"}</span>
        {!open && <span>Ask {config.assistantName}</span>}
      </button>
    </div>
  );
}
