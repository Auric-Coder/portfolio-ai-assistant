/**
 * kb-build-index: build data/assistant-index.json from PUBLIC knowledge files.
 *
 * Usage: npm run kb:index [-- --no-embeddings] [-- --rebuild]
 *   --no-embeddings  build a BM25-only index (no API calls; keeps existing vectors)
 *   --rebuild        ignore the previous index and re-embed everything
 *
 * Only `visibility: public` files are indexed. _raw/ and _intake-report.md are
 * never read (see kb-common.listKbFiles). Aborts if kb-lint reports errors.
 */
import fs from "node:fs";
import path from "node:path";
import { chunkMarkdown, sha256 } from "../src/lib/assistant/chunk";
import { config } from "../src/lib/assistant/config";
import { createEmbeddingProvider, type EmbeddingProvider } from "../src/lib/assistant/embeddings";
import { assembleIndex, planUpdate, type NewChunk } from "../src/lib/assistant/indexer";
import type { AssistantIndex } from "../src/lib/assistant/types";
import { lintAll } from "./kb-lint";
import { kbRoot, loadEnvFiles, type KbFile } from "./kb-common";

export function chunksForFile(file: KbFile): NewChunk[] {
  const fm = file.frontmatter ?? {};
  const title = String(fm.title ?? file.rel);
  const links: Record<string, string> = {};
  if (fm.links && typeof fm.links === "object")
    for (const [k, v] of Object.entries(fm.links as Record<string, unknown>)) if (typeof v === "string") links[k] = v;
  const raw = chunkMarkdown(file.body, title, config.chunking);
  return raw.map((c, i) => ({
    id: `${file.rel}#${i}`,
    file: file.rel,
    title,
    heading: c.heading,
    type: String(fm.type ?? ""),
    date: fm.date === undefined || fm.date === null ? undefined : String(fm.date),
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    links,
    text: c.text,
    hash: sha256(c.text),
  }));
}

export function readPreviousIndex(p: string): AssistantIndex | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as AssistantIndex;
  } catch {
    return null;
  }
}

export async function buildIndex(opts: {
  root?: string;
  outPath?: string;
  provider: EmbeddingProvider | null;
  rebuild?: boolean;
}) {
  const root = opts.root ?? kbRoot();
  const outPath = path.resolve(process.cwd(), opts.outPath ?? config.indexPath);
  const { files, findings } = lintAll(root);
  const errors = findings.filter((f) => f.level === "error");
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e.file}${e.line ? ":" + e.line : ""} [${e.rule}] ${e.message}`);
    throw new Error(`kb-lint reported ${errors.length} error(s); refusing to build the index`);
  }
  const publicFiles = files.filter((f) => f.frontmatter?.visibility === "public");
  const fresh = publicFiles.flatMap(chunksForFile);
  const previous = opts.rebuild ? null : readPreviousIndex(outPath);
  const plan = planUpdate(previous, fresh, opts.provider, config.indexSchemaVersion);
  const { index, embeddingCalls, embedded } = await assembleIndex(plan, fresh, opts.provider, config.indexSchemaVersion, previous, config.site.starterQuestions);
  const json = JSON.stringify(index);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : null;
  const changed = existing !== json;
  if (changed) fs.writeFileSync(outPath, json);
  return {
    outPath,
    changed,
    files: publicFiles.length,
    chunks: index.chunks.length,
    embedded,
    reused: plan.reuse.length,
    removed: plan.removed,
    embeddingCalls,
    embeddingModel: index.embeddingModel,
    reason: plan.reason,
    bytes: Buffer.byteLength(json),
  };
}

async function main() {
  loadEnvFiles();
  const args = process.argv.slice(2);
  let provider: EmbeddingProvider | null = null;
  if (!args.includes("--no-embeddings")) {
    provider = createEmbeddingProvider(config.embedding);
    if (!provider) console.warn("No embedding provider available (GEMINI_API_KEY missing): building a BM25-only index.");
  }
  const r = await buildIndex({ provider, rebuild: args.includes("--rebuild") });
  console.log(
    [
      `Index: ${path.relative(process.cwd(), r.outPath)} ${r.changed ? "(written)" : "(unchanged)"}`,
      `Public files: ${r.files}   Chunks: ${r.chunks}   (${r.reason})`,
      `Embedded: ${r.embedded}   Reused: ${r.reused}   Removed: ${r.removed}   Embedding API calls: ${r.embeddingCalls}`,
      `Embedding model: ${r.embeddingModel ?? "none (BM25 only)"}`,
      `Size: ${(r.bytes / 1024).toFixed(1)} KB`,
    ].join("\n"),
  );
}

if (process.argv[1] && /kb-build-index\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((e) => {
    console.error(`kb-build-index failed: ${(e as Error).message}`);
    process.exit(1);
  });
}
