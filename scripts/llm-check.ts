/**
 * llm:check: pings every configured LLM provider with a tiny request through the same
 * provider classes the route uses. Fails (exit 1) on permanent errors (401/403/404/410),
 * an empty answer, or a missing key; a transient 429/5xx/timeout only warns.
 * Never prints keys. Used by the daily GitHub Action (Phase 5).
 * Usage: npm run llm:check
 */
import { config } from "../src/lib/assistant/config";
import { buildProviderChain, LLMError, type LLMProvider } from "../src/lib/assistant/llm";
import { loadEnvFiles } from "./kb-common";

const PERMANENT = new Set([400, 401, 403, 404, 410]);

type Outcome = { provider: string; model: string; status: "ok" | "warn" | "fail"; detail: string; ms: number };

async function ping(p: LLMProvider): Promise<Outcome> {
  const t = Date.now();
  try {
    let text = "";
    for await (const piece of p.stream({
      system: "Reply with one short word.",
      messages: [{ role: "user", content: "Say hello." }],
      maxTokens: config.llm.maxTokens,
      temperature: 0,
    })) {
      text += piece;
    }
    const ms = Date.now() - t;
    return text.trim()
      ? { provider: p.name, model: p.model, status: "ok", detail: `answered (${text.trim().length} chars)`, ms }
      : { provider: p.name, model: p.model, status: "fail", detail: "empty answer", ms };
  } catch (e) {
    const ms = Date.now() - t;
    const status = e instanceof LLMError ? e.status : undefined;
    if (status !== undefined && PERMANENT.has(status)) return { provider: p.name, model: p.model, status: "fail", detail: `HTTP ${status}`, ms };
    return { provider: p.name, model: p.model, status: "warn", detail: status ? `HTTP ${status} (transient)` : "timeout or network error (transient)", ms };
  }
}

async function main() {
  loadEnvFiles();
  const nvidiaKey = process.env.NVIDIA_API_KEY?.trim() || undefined;
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || undefined;
  const results: Outcome[] = [];
  if (!nvidiaKey) results.push({ provider: "nvidia", model: config.llm.nvidiaModel, status: "fail", detail: "NVIDIA_API_KEY is not set", ms: 0 });
  if (!geminiKey) results.push({ provider: "gemini", model: config.llm.geminiModel, status: "fail", detail: "GEMINI_API_KEY is not set", ms: 0 });
  const chain = buildProviderChain({
    nvidiaKey,
    nvidiaModel: config.llm.nvidiaModel,
    nvidiaBaseUrl: config.llm.nvidiaBaseUrl,
    geminiKey,
    geminiModel: config.llm.geminiModel,
    timeoutMs: 30000,
  });
  for (const p of chain) results.push(await ping(p));
  for (const r of results) console.log(`${r.status.toUpperCase().padEnd(4)} ${r.provider.padEnd(7)} ${r.model}  ${r.detail}${r.ms ? `  ${r.ms}ms` : ""}`);
  if (results.some((r) => r.status === "fail")) {
    console.error("llm:check failed: fix the model id or key above.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`llm:check crashed: ${(e as Error).message}`);
  process.exit(1);
});
