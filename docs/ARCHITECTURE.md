# Architecture

This document explains how a question becomes an answer and why the system is shaped this way. Tunable numbers (thresholds, limits, token caps, model ids) live in [`src/lib/assistant/config.ts`](../src/lib/assistant/config.ts); they are deliberately not repeated here so this page does not go stale.

## Request flow

```
Visitor
  │  chat widget (client)
  ▼
POST /api/chat  (src/app/api/chat/route.ts, Node runtime, streamed)
  │
  ├─ 1. validate        origin allow-list, JSON shape, message count and length caps
  ├─ 2. rate limit      per-visitor and global daily budget (Upstash Redis or in-memory fallback)
  ├─ 3. pre-filter      blocked intents: personal contact details, credentials, jailbreak phrasing
  ├─ 4. retrieve        BM25 + dense (cosine) over the in-memory index, fused with RRF
  ├─ 5. relevance gate  nothing relevant enough -> canned decline, NO LLM call
  ├─ 6. prompt          system rules + retrieved chunks only + the last few turns
  ├─ 7. generate        primary provider, automatic failover to the next one before the first token
  ├─ 8. output guard    a reply that drifts out of scope (e.g. a code fence) is cut and replaced
  └─ 9. stream          tokens, then a final event with sources and a `refused` flag
```

Knowledge flows the other way, offline:

```
knowledge/*.md ──► kb:lint (schema, PII, secrets) ──► chunk ──► embed changed chunks ──► data/assistant-index.json
```

## Code map

| Path | Role |
|---|---|
| `src/app/api/chat/route.ts` | the HTTP edge: wires config, index, providers, limiter and log |
| `src/lib/assistant/http.ts` | request validation, origin check, SSE response |
| `src/lib/assistant/chat.ts` | orchestrates retrieval, gate, prompt, generation, output guard |
| `src/lib/assistant/guardrails.ts` | pre-filter, relevance gate, refusal messages |
| `src/lib/assistant/retrieval.ts`, `bm25.ts` | hybrid retrieval and rank fusion |
| `src/lib/assistant/embeddings.ts` | embedding provider interface and the Gemini implementation |
| `src/lib/assistant/llm/` | one file per LLM provider plus the failover chain |
| `src/lib/assistant/ratelimit.ts`, `log.ts` | abuse and cost controls, anonymised log |
| `src/lib/assistant/chunk.ts`, `indexer.ts` | markdown chunking and incremental index updates |
| `src/components/assistant/` | the chat panel, the launcher widget, the streaming hook |
| `scripts/kb-*.ts` | lint, index, status, timeline, GitHub sync, unanswered-question report |
| `assistant.config.ts` | the only file with site-specific values |

The assistant code imports only from itself, npm packages and the root-level `assistant.config.ts`. That boundary is what lets it be lifted out of a site and run standalone, as in this repository.

## Decisions and their reasons

**No external vector database.** The knowledge base is a few hundred chunks. A build-time JSON index held in memory is faster, free, and removes a service that could fail or cost money.

**Hybrid retrieval with Reciprocal Rank Fusion.** BM25 catches exact names and rare terms ("TideWatch"); embeddings catch paraphrases. RRF combines the two ranked lists without needing comparable scores. Similarity direction is a classic bug (distance versus similarity), so a unit test pins it: higher cosine always means more similar.

**A relevance gate before the LLM.** If retrieval finds nothing relevant, the assistant declines without calling a model. That is both the cheapest and the safest path for off-topic questions, and it keeps the free-tier budget for real questions. Thresholds are tuned on a labelled question set, not guessed.

**Third-person persona that says it is an AI.** The widget is honest about what it is: an assistant that talks *about* the person. It never speaks as them.

**Provider chain with failover.** Free tiers have rate limits and models get retired. A provider that fails before producing any text (bad key, 429, 5xx, timeout) is skipped and the next one is tried. A failure after text has started is surfaced, because part of the answer has already reached the visitor.

**Embedding model is pinned in the index.** Index and query must use the same model. The index records the model name and a schema version; if either changes, the builder does a full rebuild instead of mixing vectors.

**BM25-only is a first-class mode.** If no embedding key is configured (or the embedding call fails), retrieval degrades to BM25 instead of failing. A fresh clone therefore runs with no keys at all.

**Lint before index.** The knowledge base becomes public the moment it is indexed and deployed, so `kb:lint` fails the build on phone numbers, address keywords, API-key patterns and any email not on the allow-list in `assistant.config.ts`. Files default to `visibility: draft`; only `public` files are indexed.

**Privacy by default in logging.** The log stores scrubbed question text, scores and outcome only: no IP, no answer text. IPs are hashed with a salt for rate limiting.

## Failure behaviour

| Situation | What the visitor sees |
|---|---|
| No LLM key configured or all providers fail | a short "unavailable, try again" message |
| Off-topic, blocked or irrelevant question | a one-sentence decline that points to a portfolio topic or the contact link |
| Rate limit hit | a friendly message; when the daily budget is spent, a "resting" note with the résumé link |
| Embedding call fails | answers continue using BM25 only |

## Known limitations

- Pronouns come from `pronouns` in `assistant.config.ts` (default he/him/his). The prompt wording and the personal-contact pre-filter have been tested with the default set most; if you switch to she/her or they/them, try a few questions about contact details and scope before deploying.
- Free-tier limits and model ids change. Check them in your provider consoles before relying on the defaults.
