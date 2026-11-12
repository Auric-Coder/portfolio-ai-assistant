/**
 * LLM chain with automatic failover. A provider that fails BEFORE producing any
 * text (bad key, 429, 5xx, timeout, network error) is skipped and the next one is
 * tried. A failure after text has started is surfaced, since the answer is already
 * partially delivered.
 */
import { GeminiProvider } from "./gemini";
import { NvidiaProvider } from "./nvidia";
import { LLMError, type LLMProvider, type LLMRequest } from "./types";

export type { LLMProvider, LLMRequest, ChatTurn } from "./types";
export { LLMError } from "./types";

export interface ProviderEnv {
  nvidiaKey?: string;
  nvidiaModel: string;
  nvidiaBaseUrl?: string;
  geminiKey?: string;
  geminiModel: string;
  timeoutMs: number;
  /** Overrides `timeoutMs` for NVIDIA only (the primary: fail over fast). */
  nvidiaTimeoutMs?: number;
}

/** Order = priority. Providers without a key are left out. */
export function buildProviderChain(e: ProviderEnv, fetchImpl?: typeof fetch): LLMProvider[] {
  const chain: LLMProvider[] = [];
  if (e.nvidiaKey)
    chain.push(
      new NvidiaProvider({ apiKey: e.nvidiaKey, model: e.nvidiaModel, baseUrl: e.nvidiaBaseUrl, timeoutMs: e.nvidiaTimeoutMs ?? e.timeoutMs, fetchImpl }),
    );
  if (e.geminiKey) chain.push(new GeminiProvider({ apiKey: e.geminiKey, model: e.geminiModel, timeoutMs: e.timeoutMs, fetchImpl }));
  return chain;
}

export interface FailoverEvent {
  provider: string;
  error: string;
}

export async function* streamWithFailover(
  providers: LLMProvider[],
  req: LLMRequest,
  onFailover?: (e: FailoverEvent) => void,
): AsyncGenerator<{ text: string; provider: string }, void, void> {
  if (!providers.length) throw new LLMError("no LLM provider is configured");
  let lastError: unknown;
  for (const p of providers) {
    let started = false;
    try {
      for await (const text of p.stream(req)) {
        started = true;
        yield { text, provider: p.name };
      }
      if (started) return;
      throw new LLMError(`${p.name} returned an empty answer`);
    } catch (e) {
      if (started) throw e;
      lastError = e;
      onFailover?.({ provider: p.name, error: e instanceof LLMError ? e.message : "provider failed" });
    }
  }
  throw lastError instanceof LLMError ? lastError : new LLMError("all LLM providers failed");
}
