/**
 * Embedding provider interface + Gemini implementation. The provider is
 * swappable; index and query MUST use the same `model` (recorded in the index).
 */
export type EmbedTask = "document" | "query";

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], task: EmbedTask): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GeminiEmbeddingOptions {
  apiKey: string;
  model: string;
  dimensions: number;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  maxRetries?: number;
  timeoutMs?: number;
  /** Milliseconds to wait between retries (doubles each time). Tests set 0. */
  backoffMs?: number;
}

function l2normalize(v: number[]): number[] {
  // Truncated (non-3072) Gemini embeddings are not unit length; normalise so cosine == dot.
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

export class GeminiEmbeddings implements EmbeddingProvider {
  readonly name = "gemini";
  readonly model: string;
  readonly dimensions: number;
  private apiKey: string;
  private fetchImpl: typeof fetch;
  private batchSize: number;
  private maxRetries: number;
  private timeoutMs: number;
  private backoffMs: number;

  constructor(opts: GeminiEmbeddingOptions) {
    this.model = opts.model;
    this.dimensions = opts.dimensions;
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.batchSize = opts.batchSize ?? 20;
    this.maxRetries = opts.maxRetries ?? 4;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.backoffMs = opts.backoffMs ?? 1500;
  }

  async embed(texts: string[], task: EmbedTask): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      out.push(...(await this.batch(texts.slice(i, i + this.batchSize), task)));
    }
    return out;
  }

  private async batch(texts: string[], task: EmbedTask): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents`;
    const body = JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        outputDimensionality: this.dimensions,
      })),
    });
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body,
          signal: ctrl.signal,
        });
        if (!res.ok) throw new EmbeddingError(`embedding API ${res.status}`, res.status);
        const json = (await res.json()) as { embeddings?: { values: number[] }[] };
        if (!json.embeddings || json.embeddings.length !== texts.length)
          throw new EmbeddingError("embedding API returned an unexpected number of vectors");
        return json.embeddings.map((e) => l2normalize(e.values));
      } catch (e) {
        lastErr = e;
        const status = e instanceof EmbeddingError ? e.status : undefined;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt === this.maxRetries) break;
        await sleep(this.backoffMs * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    // Never surface the request itself (it carries the key header).
    throw lastErr instanceof EmbeddingError ? lastErr : new EmbeddingError("embedding request failed");
  }
}

/** Build the configured provider, or null when there is no key or provider is "none". */
export function createEmbeddingProvider(cfg: {
  provider: string;
  model: string;
  dimensions: number;
}): EmbeddingProvider | null {
  if (cfg.provider === "none") return null;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GeminiEmbeddings({ apiKey, model: cfg.model, dimensions: cfg.dimensions });
}
