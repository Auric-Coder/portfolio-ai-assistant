export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  system: string;
  messages: ChatTurn[];
  maxTokens: number;
  temperature: number;
  /** Aborts the whole request (caller-side). */
  signal?: AbortSignal;
}

/**
 * A provider streams text deltas. Adding a provider = one file implementing this
 * interface plus one line in `buildProviderChain`.
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  stream(req: LLMRequest): AsyncGenerator<string, void, void>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
