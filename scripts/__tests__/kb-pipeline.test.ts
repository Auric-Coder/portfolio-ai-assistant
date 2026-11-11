import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTimeline, firstSentence, normalizeDate, sortKey } from "../kb-timeline-core";
import { autoFileName, cleanReadme, githubClient, matchesRepo, parseSources, renderRepoFile, type RepoInfo } from "../kb-sync-core";

// ---- timeline ----------------------------------------------------------------

const item = (rel: string, fm: Record<string, unknown>, body = "A thing happened. More text.") => ({ rel, frontmatter: fm, body });

test("timeline lists the newest 15 dated public items, newest first, deterministically", () => {
  const files = [
    item("a.md", { title: "Old", type: "project", date: "2024", visibility: "public" }),
    item("b.md", { title: "New", type: "achievement", date: "2026-03", visibility: "public" }),
    item("c.md", { title: "Year only", type: "project", date: "2026", visibility: "public" }),
    item("d.md", { title: "Draft", type: "project", date: "2027", visibility: "draft" }),
    item("e.md", { title: "Undated", type: "project", visibility: "public" }),
    item("f.md", { title: "Skill", type: "certification", date: "2026-05", visibility: "public" }),
    item("_auto/repos/x.md", { title: "Auto", type: "project", date: "2026-09", visibility: "public" }),
    item("_generated/timeline.md", { title: "Self", type: "project", date: "2026-10", visibility: "public" }),
    item("g.md", { title: "A date object", type: "achievement", date: new Date("2025-07-15"), visibility: "public" }),
  ];
  const out = buildTimeline(files);
  const order = out.split("\n").filter((l) => l.startsWith("- ")).map((l) => /\*\*([^*]+)\*\* ·/.exec(l)?.[0] ?? "");
  const titles = out.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.split("**")[3]);
  assert.deepEqual(titles, ["New", "Year only", "A date object", "Old"]);
  assert.equal(order.length, 4);
  for (const hidden of ["Draft", "Undated", "Skill", "Auto", "Self"]) assert.ok(!out.includes(`**${hidden}**`), hidden);
  assert.equal(buildTimeline(files), out, "same input, same output");
  assert.match(out, /^---\ntitle: .*\ntype: about\n/);
});

test("timeline is capped at 15", () => {
  const files = Array.from({ length: 30 }, (_, i) => item(`f${i}.md`, { title: `T${i}`, type: "project", date: `20${String(10 + (i % 15))}`, visibility: "public" }));
  assert.equal(buildTimeline(files).split("\n").filter((l) => l.startsWith("- ")).length, 15);
});

test("date and sentence helpers", () => {
  assert.equal(normalizeDate(2026), "2026");
  assert.equal(normalizeDate("2026-07"), "2026-07");
  assert.equal(normalizeDate("July 2026"), null);
  assert.ok(sortKey("2026-07") > sortKey("2026"));
  assert.equal(firstSentence("# Title\n\n<!-- c -->\nHe built **a thing**. Second sentence."), "He built a thing.");
  assert.equal(firstSentence("- only a list"), "");
});

// ---- github sync -------------------------------------------------------------

test("parseSources and matching", () => {
  const c = parseSources("owner: o\ntopic: t\nrepos: [o/A, o/B]\nexclude: [B]\npublish: [o/A]\n");
  assert.deepEqual(c.repos, ["o/A", "o/B"]);
  assert.equal(matchesRepo(c.exclude, "o/B"), true);
  assert.equal(matchesRepo(c.exclude, "o/A"), false);
  assert.equal(matchesRepo(c.publish, "O/a"), true);
  assert.deepEqual(parseSources("").repos, []);
});

test("cleanReadme strips HTML, images and emails and truncates at a paragraph", () => {
  const md = "<p align=center><img src=x></p>\n# Title\n![badge](https://b)\nContact me@example.com now\n\n" + "para\n\n".repeat(900);
  const out = cleanReadme(md, 500);
  assert.ok(!/<[^>]+>/.test(out) && !out.includes("me@example.com") && !out.includes("badge"));
  assert.match(out, /\[email removed\]/);
  assert.match(out, /\(README truncated\.\)$/);
  assert.ok(out.length < 560);
});

const info: RepoInfo = {
  full_name: "o/Repo",
  name: "Repo",
  description: "A repo",
  html_url: "https://github.com/o/Repo",
  homepage: "https://demo.example",
  topics: ["rag"],
  language: "Python",
  pushed_at: "2026-07-20T10:00:00Z",
};

test("renderRepoFile is draft by default, has valid frontmatter and demotes README headings", () => {
  const out = renderRepoFile(info, { Python: 80, Shell: 20 }, "# Heading\ntext", false);
  assert.match(out, /visibility: draft/);
  assert.match(out, /date: 2026-07/);
  assert.match(out, /repo: https:\/\/github.com\/o\/Repo/);
  assert.match(out, /Python \(80%\)/);
  assert.match(out, /\n## Heading\n/);
  assert.match(renderRepoFile(info, {}, "", true), /visibility: public/);
  assert.equal(autoFileName("My Repo_v2!"), "my-repo_v2-.md");
});

test("githubClient sends the token only as a header and surfaces HTTP errors without bodies", async () => {
  const seen: { url: string; auth?: string }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: (init?.headers as Record<string, string>)?.authorization });
    return url.endsWith("/readme") ? new Response("", { status: 404 }) : new Response(JSON.stringify(info), { status: 200 });
  }) as unknown as typeof fetch;
  const gh = githubClient(f, "tok123");
  assert.equal((await gh.repo("o/Repo")).name, "Repo");
  assert.equal(await gh.readme("o/Repo"), "");
  assert.ok(seen.every((s) => s.auth === "Bearer tok123" && !s.url.includes("tok123")));
  const bad = githubClient((async () => new Response("secret body", { status: 500 })) as unknown as typeof fetch);
  await assert.rejects(bad.repo("o/x"), (e: Error) => /500/.test(e.message) && !e.message.includes("secret"));
});

// ---- the CI safety gate: a file with a fake phone number must fail kb:lint ----

function lint(dir: string) {
  return spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/kb-lint.ts"], { env: { ...process.env, KB_DIR: dir }, encoding: "utf8" });
}
const FM = "---\ntitle: T\ntype: about\nvisibility: public\n---\n";

test("kb-lint passes a clean file and fails on a fake phone number, a key and an unlisted email", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-gate-"));
  try {
    fs.writeFileSync(path.join(dir, "ok.md"), `${FM}# T\nHe builds things.\n`);
    assert.equal(lint(dir).status, 0, "clean KB passes");
    for (const [name, text] of [
      ["phone.md", "Call me on +91 98765 43210 any time."],
      ["key.md", "token nvapi-abcdefghijklmnopqrstuvwxyz123456"],
      ["mail.md", "Write to someone@example.com"],
    ] as const) {
      fs.writeFileSync(path.join(dir, name), `${FM}# T\n${text}\n`);
      const r = lint(dir);
      assert.notEqual(r.status, 0, `${name} must fail the gate`);
      fs.rmSync(path.join(dir, name));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
