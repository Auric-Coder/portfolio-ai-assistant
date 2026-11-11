# How this was built

This assistant was built phase by phase with [Claude Code](https://claude.com/claude-code), working from a written plan with an acceptance check per phase. A phase only started once the previous one passed. This page records the phases, the prompts that drove them, and the knowledge-file schema you need to use it.

The plan lived in the author's private portfolio repository, where the assistant was built first and then extracted into this standalone, public repository by an allowlist script. The **fine-tuning track is in progress and is not described as complete anywhere in this repository.**

## Working agreements

These rules were given to the coding agent up front and they are worth copying if you build something similar:

- Never put real secrets in the repo; read them from the environment.
- Never invent biographical facts. If the knowledge base lacks something, record a gap instead.
- Small, tested modules; every phase ends with passing tests.
- If a free-tier limit or model id turns out to be wrong, stop and report rather than silently switching.
- Never commit or push without the author's explicit go-ahead.
- Draft knowledge is never promoted to public by the agent; a human reviews and promotes it.

## Phases

### Phase 0: knowledge-base cleanup and seed
Convert raw notes into structured knowledge files with frontmatter, all `visibility: draft`, and write a report of conflicts and anything that looks private. Write the linter and a status command. Set up the code boundary so the assistant can later be lifted out of the site (it may import only itself, npm packages and one config file).

> "Read the plan, sections 4 and 5. First list the existing knowledge/ folder and tell me what you found. Then run the raw-notes intake: structured drafts with `visibility: draft`, an intake report, no invented facts. Add the frontmatter schema to every file, implement scripts/kb-lint.ts and `kb:status`, and add both to package.json. Do not promote any file to public; I will review the report."

### Phase 1: index builder
Chunk markdown on headings, embed through a swappable provider, write one JSON index with content hashes, the embedding model and a schema version. Incremental: unchanged chunks are never re-embedded.

> "Implement Phase 1. Embedding provider must be behind an interface so it can be swapped. Include unit tests for chunking and the incremental hash logic."

### Phase 2: retrieval and guardrails (CLI first)
BM25, dense cosine, Reciprocal Rank Fusion, a pre-filter for blocked intents and a relevance gate, all driven from a CLI (`npm run ask`) before any HTTP or UI exists. A unit test pins the similarity direction (higher cosine is more similar).

> "Implement Phase 2 with unit tests. Thresholds go in config.ts with TODO(tune in Phase 6)."

### Phase 3: the LLM layer and `/api/chat`
A streaming route handler, one file per LLM provider, automatic failover before the first token, refusals that never reach the model.

> "Implement Phase 3. Keep provider code isolated so adding a third provider is one file."

### Phase 4: chat UI
A generic chat panel, a streaming hook and a plain floating-button widget (the one used in this repository). On the live site the same panel is driven by the site's own animated pet instead; that integration is site-specific and not part of this repository.

> "Implement Phase 4b. Do not change any existing pet behaviour. If a rule conflicts with something the pet already does, stop and ask me which should win."

### Phase 5: auto-update pipeline
GitHub repo summaries and a generated timeline feed the index; a workflow lints, re-indexes and commits only when something changed, using repository secrets and a bot identity.

> "Implement Phase 5. The workflow must use repo secrets, commit with a bot identity, and skip when nothing changed."

### Phase 6: evaluation and tuning
A labelled question set (technical, project, comparison, out-of-scope, sensitive, prompt-injection) and a harness that measures retrieval quality, faithfulness and refusal accuracy against the endpoint. The relevance thresholds were tuned on it. The question set stays private; this repository will publish aggregate numbers only.

### Phase 7: hardening
Per-visitor and daily limits, an output-length cap, an anonymised log of unanswered questions (no IPs, no answers), and abuse tests: rapid-fire requests, very long input, injection prompts.

### Phase 8: this public repository
An allowlist manifest decides exactly which source files are copied here; a check refuses to pass if any secret, private string, real knowledge folder, real index or site-specific code is present; the standalone shell, sample knowledge, docs and README are authored here.

### Phase 9: fine-tuning track (in progress)
A style-only QLoRA fine-tune with RAG still supplying every fact, and an ablation against the base model. No results yet.

## The knowledge-file schema

Every markdown file in your knowledge folder starts with frontmatter:

```yaml
---
title: TideWatch (river-level dashboard)
type: project          # project | achievement | education | experience | skill | certification | hobby | faq | about
date: 2025-11          # YYYY or YYYY-MM. Required for project, achievement, education, experience, certification once public
status: shipped        # optional free text
tags: [python, postgresql]
visibility: public     # public | draft. ONLY "public" files are indexed
links: { repo: "https://...", demo: "https://..." }   # optional; offered only when a visitor asks where to see something
---
```

Rules enforced by `npm run kb:lint`:

- `title`, `type` and `visibility` are required; `type` and `visibility` must be one of the listed values.
- A valid `date` is required for time-bound types once the file is `public`.
- No `[NEEDS REVIEW` markers in `public` files.
- No phone-number patterns, API-key patterns, address keywords, or emails outside `allowedEmails` in any file, public or draft.
- Unknown frontmatter keys produce a warning.

Special files and folders:

- `_sources.yml` lists GitHub repos for `npm run kb:sync`, which writes `_auto/repos/*.md` drafts. Hand-written project files take priority.
- `_generated/timeline.md` is produced by `npm run kb:timeline`; never edit it by hand.
- `_raw/` and `_intake-report.md` (if you use an intake workflow) are never linted, indexed or published.

Writing tips that improved answers:

- One topic per file; start each with a plain-language summary sentence, because retrieval returns chunks and each chunk should stand alone.
- Say explicitly what is *not* true ("participation only, no placement") so the assistant cannot over-claim.
- Write facts, not marketing. The assistant repeats what you wrote.

## Running the tests

`npm test` runs the unit tests with no network and no keys; LLM and embedding providers are replaced by in-test fakes. `npm run typecheck` and `npm run build` cover the rest.
