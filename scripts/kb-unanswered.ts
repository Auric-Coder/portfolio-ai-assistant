/**
 * kb-unanswered: the to-do list for new knowledge-base content. Reads the anonymised question log
 * and prints the questions the assistant could not answer, most frequent first.
 *
 * Sources (first that applies): --file <path.jsonl>, ASSISTANT_LOG_FILE, or the Upstash list
 * (UPSTASH_REDIS_REST_URL/TOKEN). Usage: npm run kb:unanswered [-- --file data/log.jsonl]
 */
import fs from "node:fs";
import { LOG_LIST_KEY, summariseUnanswered, type LogEntry } from "../src/lib/assistant/log";
import { loadEnvFiles } from "./kb-common";

async function readEntries(): Promise<{ entries: LogEntry[]; source: string }> {
  const argFile = process.argv.indexOf("--file");
  const file = (argFile > 0 ? process.argv[argFile + 1] : undefined) ?? process.env.ASSISTANT_LOG_FILE?.trim();
  if (file) {
    const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    return { entries: lines.map((l) => JSON.parse(l) as LogEntry), source: file };
  }
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) throw new Error("no log source: pass --file, set ASSISTANT_LOG_FILE, or set UPSTASH_REDIS_REST_URL/TOKEN (needs keys)");
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([["LRANGE", LOG_LIST_KEY, 0, 1999]]),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const [r] = (await res.json()) as { result?: string[] }[];
  return { entries: (r.result ?? []).map((s) => JSON.parse(s) as LogEntry), source: "upstash" };
}

async function main() {
  loadEnvFiles();
  const { entries, source } = await readEntries();
  const rows = summariseUnanswered(entries);
  console.log(`kb-unanswered: ${entries.length} logged questions from ${source}; ${rows.length} distinct unanswered`);
  for (const r of rows.slice(0, 50)) console.log(`${String(r.count).padStart(4)}x  ${r.q}   (last ${r.last.slice(0, 10)})`);
  if (rows.length) console.log("\nAdd the missing facts with /kb-add; answers must come from Hemanga, never invented.");
}

main().catch((e) => {
  console.error(`kb-unanswered failed: ${(e as Error).message}`);
  process.exit(1);
});
