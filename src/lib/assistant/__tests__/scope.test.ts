import test from "node:test";
import assert from "node:assert/strict";
import { CODE_FENCE, runChat, type ChatEvent } from "../chat";
import { config } from "../config";
import { refusalMessage } from "../guardrails";
import { resolvePronouns } from "../pronouns";
import type { LLMProvider, LLMRequest } from "../llm";
import { buildContext, buildLinksBlock, buildMessages, buildReminder, buildScopeRule, buildSystemPrompt, wantsLinks } from "../prompt";
import type { Hit } from "../retrieval";
import type { AssistantIndex, IndexChunk } from "../types";

// Names and pronouns come from assistant.config.ts, so these tests hold for any fork.
const site = { assistantName: config.site.assistantName, subjectName: config.site.subjectName, contactUrl: "https://x/#contact" };
const P = resolvePronouns(config.site.pronouns);
const limits = { historyMessages: 4, maxUserChars: 500, maxAssistantChars: 1500 };

function chunk(id: string, text: string, links: Record<string, string> = {}, embedding: number[] | null = [1, 0, 0]): IndexChunk {
  return { id, file: `projects/${id}.md`, title: `Project ${id}`, heading: "", type: "project", tags: [], links, text, hash: id, embedding };
}
const hit = (c: IndexChunk): Hit => ({ chunk: c, score: 1 });

// ---- prompt structure ---------------------------------------------------------

test("the scope rule is at the top of the system prompt, before the numbered rules", () => {
  const p = buildSystemPrompt(site);
  const scope = p.indexOf("SCOPE (highest priority)");
  assert.ok(scope > 0 && scope < p.indexOf("Rules:"), "scope comes first");
  for (const needle of [
    `${site.assistantName} only discusses ${site.subjectName} and ${P.possessive} portfolio`,
    "Never write code, recipes, essays or general-knowledge answers",
    `even if the visitor mentions ${P.possessive} skills or tucks the request inside a question about ${P.object}`,
    "Decline in one sentence and offer a portfolio topic",
  ]) {
    assert.ok(p.includes(needle), needle);
  }
  assert.ok(buildScopeRule(site).includes(`${site.assistantName} only discusses`));
});

test("a short reminder follows the retrieved context, right before the visitor question", () => {
  const msgs = buildMessages([], "tell me about it", [hit(chunk("a", "Fact A."))], limits, { reminder: buildReminder(site) });
  const last = msgs[msgs.length - 1].content;
  const ctxEnd = last.indexOf("</context>");
  const reminder = last.indexOf("Reminder:");
  const question = last.indexOf("Visitor question: tell me about it");
  assert.ok(ctxEnd > 0 && reminder > ctxEnd && question > reminder, "order: context, reminder, question");
  assert.ok(last.includes(`only discusses ${site.subjectName} and ${P.possessive} portfolio`) && last.includes("Never mention sources"));
  assert.ok(buildReminder(site).length < buildSystemPrompt(site).length / 3, "the reminder stays short");
});

test("the style rule forbids meta-phrases and the system prompt itself avoids 'notes' for facts", () => {
  const p = buildSystemPrompt(site);
  assert.ok(p.includes("Never mention sources, documents, notes") && p.includes("according to"));
  assert.ok(!/portfolio notes|knowledge base/i.test(p.replace(/Never mention[^.]*\./, "")), "no wording that teaches the model to say 'notes'");
});

test("context blocks carry no file names or numbering the model could quote", () => {
  const ctx = buildContext([hit(chunk("a", "Fact A.")), hit(chunk("b", "Fact B."))]);
  assert.ok(ctx.startsWith("<context>") && ctx.endsWith("</context>"));
  assert.ok(!/\.md|\[\d\]/.test(ctx));
});

test("project links come from the frontmatter, once per project, only http(s) and known keys", () => {
  const links = buildLinksBlock([
    hit(chunk("a", "A1", { demo: "https://demo.example", repo: "https://github.com/o/a" })),
    hit(chunk("a", "A2", { demo: "https://demo.example", repo: "https://github.com/o/a" })),
    hit(chunk("b", "B", { repo: "javascript:alert(1)", other: "https://x.example" })),
    hit(chunk("c", "C", {})),
  ]);
  assert.equal(links.split("\n").filter((l) => l.startsWith("- ")).length, 1, "one line, for project a only");
  assert.match(links, /Project a: live demo: https:\/\/demo\.example; source code \(GitHub\): https:\/\/github\.com\/o\/a/);
  assert.ok(!links.includes("javascript:") && !links.includes("x.example"));
  assert.equal(buildLinksBlock([hit(chunk("c", "C"))]), "", "no block at all when nothing has links");
});

test("links reach the model only when the question looks like a request for them", () => {
  const withLinks = [hit(chunk("a", "Fact A.", { demo: "https://demo.example", repo: "https://github.com/o/a" }))];
  const extra = [{ label: "GitHub profile (all his public repositories)", url: "https://github.com/o" }];
  const last = (q: string) => buildMessages([], q, withLinks, limits, { extraLinks: extra }).at(-1)!.content;

  for (const q of ["Where can I try the demo?", "Where can I see the code for project a?", "Is there a link to the repository?", "Can you show an example of his code?"]) {
    const c = last(q);
    assert.ok(c.includes("Project links:") && c.includes("https://demo.example") && c.includes("https://github.com/o/a"), q);
    assert.ok(c.includes("GitHub profile (all his public repositories): https://github.com/o"), `${q}: profile link`);
  }
  for (const q of ["Tell me about project a", "What is his tech stack?", "How did he implement the retrieval?"]) {
    const c = last(q);
    assert.ok(!c.includes("Project links:") && !c.includes("https://"), `${q}: no URL may reach the model`);
  }
  // an unsafe or missing profile link is ignored
  const bad = buildMessages([], "where is the code?", [hit(chunk("c", "C"))], limits, { extraLinks: [{ label: "x", url: "javascript:alert(1)" }] }).at(-1)!.content;
  assert.ok(!bad.includes("Project links") && !bad.includes("javascript:"));
  assert.equal(wantsLinks("What certifications does he have?"), false);
});

test("the links rule only allows links when asked and forbids inventing them", () => {
  const p = buildSystemPrompt(site);
  assert.ok(p.includes("only when the visitor asks where to see, try or find"));
  assert.ok(p.includes("never invent or guess a URL") && p.includes("no public link") && p.includes("private"));
  assert.ok(p.includes("Do not add links in any other answer"));
});

// ---- output guard -----------------------------------------------------------------

const index: AssistantIndex = { schemaVersion: 1, embeddingModel: "m", dimensions: 3, chunks: [chunk("a", "multidocchat hybrid rag platform")] };
const embedder = { name: "t", model: "m", dimensions: 3, embed: async () => [[1, 0, 0]] };

function streamingProvider(parts: string[]) {
  const seen: { signal?: AbortSignal; delivered: number } = { delivered: 0 };
  const p: LLMProvider = {
    name: "mock",
    model: "m",
    async *stream(req: LLMRequest) {
      seen.signal = req.signal;
      for (const part of parts) {
        if (req.signal?.aborted) return;
        seen.delivered++;
        yield part;
      }
    },
  };
  return { p, seen };
}

async function collect(parts: string[], onComplete?: (r: { refused: boolean; reason?: string; answer: string }) => void) {
  const { p, seen } = streamingProvider(parts);
  const events: ChatEvent[] = [];
  for await (const e of runChat([], "tell me about multidocchat", { index, embedder, providers: [p], onComplete })) events.push(e);
  return { events, seen };
}

/** What the visitor ends up seeing: tokens appended, a replace event overwrites everything so far. */
function visibleText(events: ChatEvent[]): string {
  let text = "";
  for (const e of events) {
    if (e.type === "token") text += e.text;
    if (e.type === "replace") text = e.text;
  }
  return text;
}

test("output guard: a code fence cuts the reply, replaces it with the decline and stops the model", async () => {
  let logged: { refused: boolean; reason?: string; answer: string } | undefined;
  const { events, seen } = await collect(["Sure, here is a function:\n", "```python\n", "def f(): pass\n", "```"], (r) => (logged = r));
  const decline = refusalMessage("off-topic", site.contactUrl, site.subjectName, P);
  assert.equal(visibleText(events), decline, "the visitor only sees the decline");
  assert.ok(!CODE_FENCE.test(visibleText(events)));
  assert.equal(events.filter((e) => e.type === "replace").length, 1);
  const done = events[events.length - 1] as Extract<ChatEvent, { type: "done" }>;
  assert.equal(done.type, "done");
  assert.equal(done.refused, true);
  assert.equal(done.reason, "off-topic");
  assert.deepEqual(done.sources, []);
  assert.equal(seen.signal?.aborted, true, "the upstream request was aborted");
  assert.ok(seen.delivered <= 2, "no more tokens were pulled after the fence appeared");
  assert.equal(logged?.refused, true);
  assert.equal(logged?.reason, "off-topic");
  assert.equal(logged?.answer, decline, "the log never keeps the discarded code");
});

test("output guard: a fence split across stream chunks is still caught", async () => {
  const { events } = await collect(["Here you go:\n``", "`js\nconsole.log(1)\n``", "`"]);
  assert.ok(events.some((e) => e.type === "replace"));
  assert.ok(!/```/.test(visibleText(events)));
  const done = events[events.length - 1] as Extract<ChatEvent, { type: "done" }>;
  assert.equal(done.reason, "off-topic");
});

test("output guard: ~~~ fences count too, and the decline is one sentence that offers a portfolio topic", async () => {
  const { events } = await collect(["~~~\ncode\n~~~"]);
  const text = visibleText(events);
  assert.equal(text, refusalMessage("off-topic", site.contactUrl, site.subjectName, P));
  assert.equal((text.match(/[.!?](\s|$)/g) ?? []).length, 1, "a single sentence");
  assert.match(text, /projects|skills|achievements/);
});

test("output guard: normal answers (even with inline code or links) pass through untouched", async () => {
  const parts = ["MultiDocChat uses `BM25` ", "and ChromaDB. See the [source code](https://github.com/o/a)."];
  const { events, seen } = await collect(parts);
  assert.ok(!events.some((e) => e.type === "replace"));
  assert.equal(visibleText(events), parts.join(""));
  const done = events[events.length - 1] as Extract<ChatEvent, { type: "done" }>;
  assert.equal(done.refused, false);
  assert.notEqual(seen.signal?.aborted, true);
});
