/** NVIDIA NIM (OpenAI-compatible chat completions), streaming. */
import { sseData } from "./sse";
import { LLMError, type LLMProvider, type LLMRequest } from "./types";

export interface NvidiaOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Strips <think>...</think> reasoning blocks some models inline into `content`. */
export class ThinkStripper {
  private inThink = false;
  private buf = "";
  push(text: string): string {
    this.buf += text;
    let out = "";
    for (;;) {
      if (this.inThink) {
        const end = this.buf.indexOf("</think>");
        if (end < 0) {
          this.buf = this.buf.slice(Math.max(0, this.buf.length - 7));
          return out;
        }
        this.buf = this.buf.slice(end + 8).replace(/^\s+/, "");
        this.inThink = false;
      } else {
        const start = this.buf.indexOf("<think>");
        if (start < 0) {
          // hold back the longest suffix that could be the start of "<think>"
          let hold = 0;
          for (let n = Math.min(6, this.buf.length); n > 0; n--) {
            if ("<think>".startsWith(this.buf.slice(this.buf.length - n))) {
              hold = n;
              break;
            }
          }
          const safe = this.buf.length - hold;
          out += this.buf.slice(0, safe);
          this.buf = this.buf.slice(safe);
          return out;
        }
        out += this.buf.slice(0, start);
        this.buf = this.buf.slice(start + 7);
        this.inThink = true;
      }
    }
  }
  flush(): string {
    const rest = this.inThink ? "" : this.buf;
    this.buf = "";
    return rest;
  }
}

export class NvidiaProvider implements LLMProvider {
  readonly name = "nvidia";
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(o: NvidiaOptions) {
    this.model = o.model;
    this.apiKey = o.apiKey;
    this.baseUrl = (o.baseUrl ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
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
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, accept: "text/event-stream" },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "system", content: req.system }, ...req.messages],
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          stream: true,
          // Reasoning models spend the token budget on hidden thinking and add seconds of latency;
          // grounded short answers do not need it. Servers that ignore the field are unaffected.
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: ctrl.signal,
      });
    } catch {
      throw new LLMError("nvidia request failed or timed out");
    } finally {
      clearTimeout(connectTimer);
    }
    if (!res.ok) throw new LLMError(`nvidia responded ${res.status}`, res.status);

    const strip = new ThinkStripper();
    try {
      for await (const data of sseData(res, this.timeoutMs, req.signal)) {
        if (data === "[DONE]") break;
        let json: { choices?: { delta?: { content?: string | null } }[] };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        // Only `content` is user-visible; `reasoning_content` (if any) is ignored on purpose.
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) {
          const clean = strip.push(piece);
          if (clean) yield clean;
        }
      }
      const rest = strip.flush();
      if (rest) yield rest;
    } catch (e) {
      throw e instanceof LLMError ? e : new LLMError("nvidia stream failed");
    } finally {
      req.signal?.removeEventListener("abort", onAbort);
    }
  }
}
