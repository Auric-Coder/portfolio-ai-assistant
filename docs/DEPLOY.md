# Deploy

Goal: your own assistant, live, from a fork. About thirty minutes once you have the API keys.

## 1. Fork and clone

Fork this repository on GitHub, then clone your fork and run `npm install`.

## 2. Edit your knowledge

1. Edit [`assistant.config.ts`](../assistant.config.ts): `assistantName`, `subjectName`, `siteUrl`, `contactUrl`, `resumeUrl`, `githubUrl`, the greeting and starter questions.
2. Set `allowedOrigins` to your production domain plus `http://localhost:3000`. The API rejects other origins.
3. Replace the notes in `knowledge.example/` (or create a `knowledge/` folder and set `kbDir: "knowledge"`). One topic per file, with frontmatter (see [HOWTO.md](HOWTO.md#the-knowledge-file-schema)). Keep new files as `visibility: draft` until you have read them, then switch to `public`.
4. Run `npm run kb:lint` until it reports no errors, and `npm run kb:status` to confirm which files are public.

> Everything that is `public` becomes publicly readable once deployed. Do not put anything private in it.

## 3. Get API keys (all have free tiers; limits change, check the consoles)

| Variable | Purpose |
|---|---|
| `NVIDIA_API_KEY` | primary LLM through NVIDIA NIM |
| `GEMINI_API_KEY` | fallback LLM and the dense embeddings |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | optional shared rate-limit store; without it an in-memory limiter is used per server instance |
| `IP_HASH_SALT` | any long random string |

Copy `.env.example` to `.env.local` for local work. Never commit `.env.local`; it is gitignored.

Run `npm run llm:check` to confirm the model ids are still valid for your account. Model ids can be overridden with `NVIDIA_MODEL` and `GEMINI_LLM_MODEL` without code changes.

## 4. Build the index

```bash
npm run kb:index
```

This writes `data/assistant-index.json` (chunk text, vectors, content hashes, embedding model, schema version). Re-running it re-embeds only chunks whose text changed.

The index is gitignored in this repository because the repository ships only sample data. For your own deployment **you need the index at build time**. Choose one:

- **Build it on the host (simplest).** Set `GEMINI_API_KEY` in the Vercel project and add `npm run kb:index` to the build command, e.g. `npm run kb:index && next build`.
- **Commit it.** Remove `/data/assistant-index.json` from `.gitignore` in your fork and commit the file after each `kb:index`. Do this only for a knowledge base you intend to be public.

Without an index the build falls back to a BM25-only index automatically (no embedding calls).

## 5. Deploy to Vercel

1. Import your fork into Vercel (framework: Next.js, defaults are fine).
2. Add the environment variables above in *Project Settings → Environment Variables*.
3. Deploy. Open the site, click the chat button, and ask one of the starter questions.

The route handler runs on the Node runtime and streams its response, so it works within normal Vercel function limits.

## 6. Mount the widget on your own site

The shell in `src/app/page.tsx` is a placeholder. Put the widget on your real pages with:

```tsx
import { ChatWidget } from "@/components/assistant/ChatWidget";
<ChatWidget config={{ assistantName, subjectName, greeting, starterQuestions, showSources }} />
```

If the widget lives on a different origin from the API, set `endpoint` on `ChatWidget` and add that origin to `allowedOrigins`.

## 7. Keep it fresh

- Edit or add a markdown note, run `npm run kb:lint && npm run kb:index`, and redeploy.
- `npm run kb:unanswered` (with the log configured) lists questions the assistant could not answer; each one is a note you could write.
- Optional: automate the index rebuild with a scheduled GitHub Actions workflow that runs `kb:lint` and `kb:index` using repository secrets and commits the changed index.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "The assistant is unavailable right now" | no LLM key set, or both providers failed; run `npm run llm:check` |
| `403 origin not allowed` | add your domain to `allowedOrigins` in `assistant.config.ts` |
| Answers feel keyword-only | the index was built without embeddings; set `GEMINI_API_KEY` and run `npm run kb:index` |
| Build fails on `data/assistant-index.json` | run `npm run kb:index:offline` once, or use the `prebuild` hook (it does this automatically) |
| Lint fails on a phone number or email | remove it, or add the email to `allowedEmails` if you intend it to be public |
