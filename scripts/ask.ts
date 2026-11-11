/**
 * ask: CLI retrieval check. Question in, retrieved chunks + scores out (no LLM call).
 * Usage: npm run ask "tell me about MultiDocChat"
 */
import { config } from "../src/lib/assistant/config";
import { refusalMessage } from "../src/lib/assistant/guardrails";
import { loadIndexFromFile, prepareContext } from "../src/lib/assistant/runtime";
import { resolvePronouns } from "../src/lib/assistant/pronouns";
import { loadEnvFiles } from "./kb-common";

async function main() {
  loadEnvFiles();
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npm run ask "your question"');
    process.exit(2);
  }
  const index = loadIndexFromFile();
  const ctx = await prepareContext(question, index);
  const r = ctx.retrieval;
  if (r) {
    console.log(
      `mode=${r.mode}  topCosine=${r.topCosine?.toFixed(3) ?? "n/a"}  topBm25=${r.topBm25.toFixed(2)}${r.note ? "  (" + r.note + ")" : ""}`,
    );
  }
  if (ctx.refused) {
    console.log(`REFUSED (${ctx.reason}): ${refusalMessage(ctx.reason!, config.site.contactUrl, config.site.subjectName, resolvePronouns(config.site.pronouns))}`);
    if (r) console.log("\n(top chunks that were not used)");
  }
  r?.hits.forEach((h, i) => {
    const preview = h.chunk.text.replace(/\s+/g, " ").slice(0, 110);
    console.log(
      `${i + 1}. rrf=${h.score.toFixed(4)} cos=${h.cosine?.toFixed(3) ?? "-"} bm25=${h.bm25?.toFixed(2) ?? "-"}  [${h.chunk.file}] ${preview}`,
    );
  });
}

main().catch((e) => {
  console.error(`ask failed: ${(e as Error).message}`);
  process.exit(1);
});
