/** BM25 Okapi keyword search over index chunks (pure TypeScript, no dependencies). */

const STOP = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have he her him his how i if in into is it its " +
    "me my of on or our she so than that the their them then there these they this those to too us was we were what when where " +
    "which who whom why will with would you your about tell also any some more most very just like get got"
  ).split(" "),
);

/** Normalise tokens that punctuation would otherwise destroy (c++, node.js ...). */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/c\+\+/g, "cpp")
    .replace(/c#/g, "csharp")
    .replace(/\.js\b/g, "js")
    .replace(/\bml\/ai\b|\bai\/ml\b/g, "ai ml")
    .replace(/[’']s\b/g, "");
}

export function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is|js)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string, keepStopwords = false): string[] {
  const out: string[] = [];
  for (const t of normalise(text).split(/[^a-z0-9]+/)) {
    if (!t) continue;
    if (!keepStopwords && STOP.has(t)) continue;
    out.push(stem(t));
  }
  return out;
}

export interface Bm25Hit {
  index: number;
  score: number;
}

export class BM25 {
  private tf: Map<string, number>[] = [];
  private len: number[] = [];
  private df = new Map<string, number>();
  private avg = 0;

  constructor(
    docs: string[],
    private k1 = 1.5,
    private b = 0.75,
  ) {
    for (const d of docs) {
      const toks = tokenize(d);
      const m = new Map<string, number>();
      for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
      this.tf.push(m);
      this.len.push(toks.length);
      for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avg = this.len.reduce((a, b) => a + b, 0) / Math.max(1, this.len.length);
  }

  /** Okapi BM25 with the non-negative idf variant. */
  search(query: string, k: number): Bm25Hit[] {
    const q = [...new Set(tokenize(query))];
    const N = this.tf.length;
    const hits: Bm25Hit[] = [];
    for (let i = 0; i < N; i++) {
      let score = 0;
      for (const t of q) {
        const f = this.tf[i].get(t);
        if (!f) continue;
        const n = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.len[i]) / (this.avg || 1)));
      }
      if (score > 0) hits.push({ index: i, score });
    }
    hits.sort((a, b) => b.score - a.score || a.index - b.index);
    return hits.slice(0, k);
  }
}
