/**
 * ensure-index: make sure data/assistant-index.json exists so `npm run dev` / `npm run build` work on a
 * fresh clone. If it is missing, build a BM25-only index from your knowledge folder (no API calls, no keys).
 * For dense (embedding) retrieval run `npm run kb:index` once with GEMINI_API_KEY set.
 *
 * Authored in the mirror (not synced). Calls the synced kb-build-index script.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const target = path.resolve(process.cwd(), "data", "assistant-index.json");
if (fs.existsSync(target)) process.exit(0);

console.log("ensure-index: data/assistant-index.json not found; building a BM25-only index (no API calls).");
const r = spawnSync("npx", ["tsx", "scripts/kb-build-index.ts", "--no-embeddings"], { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
