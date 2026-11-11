/** Google Gemini (generateContent, streaming over SSE). */
import { sseData } from "./sse";
import { LLMError, type LLMProvider, type LLMRequest } from "./types";

export interface GeminiLlmOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly model: string;
  private apiKey: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(o: GeminiLlmOptions) {
    this.model = o.model;
    this.apiKey = o.apiKey;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 15000;
  }

  async *stream(req: LLMRequest): AsyncGenerator<string, void, void> {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    req.signal?.addEventListener("abort", onAbort, { once: true });
    const connectTimer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: req.messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              maxOutputTokens: req.maxTokens,
              temperature: req.temperature,
              // "minimal" avoids thinking tokens eating the output cap (thinkingBudget:0 is rejected by 3.x models).
              thinkingConfig: { thinkingLevel: "minimal" },
            },
          }),
          signal: ctrl.signal,
        },
      );
    } catch {
      throw new LLMError("gemini request failed or timed out");
    } finally {
      clearTimeout(connectTimer);
    }
    if (!res.ok) throw new LLMError(`gemini responded ${res.status}`, res.status);
    try {
      for await (const data of sseData(res, this.timeoutMs, req.signal)) {
        let json: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        for (const part of json.candidates?.[0]?.content?.parts ?? []) {
          if (part.text && !part.thought) yield part.text;
        }
      }
    } catch (e) {
      throw e instanceof LLMError ? e : new LLMError("gemini stream failed");
    } finally {
      req.signal?.removeEventListener("abort", onAbort);
    }
  }
}
