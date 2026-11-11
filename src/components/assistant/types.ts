/** Shared types for the generic assistant UI. No site imports (extractable boundary). */

export type PanelMode = "minimized" | "expanded";
export type ChatStatus = "idle" | "thinking" | "streaming" | "refused" | "error";

/** The only config the UI needs; the host (site or mirror) passes it in. */
export interface ChatPanelConfig {
  assistantName: string;
  subjectName: string;
  greeting: string;
  starterQuestions: string[];
  /** Show source chips under answers. Default true for the generic widget; the site sets false. */
  showSources?: boolean;
}

export interface SourceRef {
  title: string;
  url?: string;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceRef[];
  refused?: boolean;
  error?: boolean;
}

/** One JSON object per `data:` line from /api/chat. */
export type WireEvent =
  | { type: "token"; text: string }
  /** Output guard: discard everything streamed so far and show this text instead. */
  | { type: "replace"; text: string }
  | { type: "done"; sources: SourceRef[]; refused: boolean; reason?: string }
  | { type: "error"; message: string };
