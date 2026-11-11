import test from "node:test";
import assert from "node:assert/strict";
import { chunkMarkdown, stripNoise } from "../chunk";

const opts = { targetTokens: 300, overlapTokens: 50, tokensPerWord: 1.33 };

test("prefixes every chunk with title > heading and drops the repeated H1", () => {
  const body = "# My Title\nintro text\n\n## Features\n- one\n- two\n";
  const chunks = chunkMarkdown(body, "My Title", opts);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].text.startsWith("My Title\nintro"));
  assert.ok(chunks[1].text.startsWith("My Title > Features\n"));
});

test("splits on headings", () => {
  const body = "## A\nalpha\n\n## B\nbeta\n";
  const chunks = chunkMarkdown(body, "T", opts);
  assert.deepEqual(chunks.map((c) => c.heading), ["A", "B"]);
});

test("keeps nested heading path", () => {
  const chunks = chunkMarkdown("## A\n### B\nbody text here\n", "T", opts);
  assert.equal(chunks[0].heading, "A > B");
});

test("splits FAQ questions into their own chunks", () => {
  const body = "**Q: First?**\nAnswer one.\n\n**Q: Second?**\nAnswer two.\n";
  const chunks = chunkMarkdown(body, "FAQ", opts);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].heading, "Second?");
});

test("long sections are split near the target size with overlap", () => {
  const bullets = Array.from({ length: 60 }, (_, i) => `- item ${i} ${"word ".repeat(10)}`).join("\n");
  const chunks = chunkMarkdown(`## Big\n${bullets}`, "T", opts);
  assert.ok(chunks.length > 1, "expected multiple chunks");
  const maxWords = Math.floor(300 / 1.33);
  for (const c of chunks) assert.ok(c.text.split(/\s+/).length <= maxWords + 12, "chunk too large");
  // overlap: the last bullet of chunk N reappears at the start of chunk N+1
  const lastLine = chunks[0].text.trim().split("\n").pop()!;
  assert.ok(chunks[1].text.includes(lastLine), "expected overlap between consecutive chunks");
});

test("an oversized single paragraph is split by words", () => {
  const para = "word ".repeat(700);
  const chunks = chunkMarkdown(`## P\n${para}`, "T", opts);
  assert.ok(chunks.length >= 3);
});

test("HTML comments never reach a chunk", () => {
  const body = "## A\n<!-- approved by someone -->\nvisible text\n";
  assert.ok(!stripNoise(body).includes("approved"));
  const chunks = chunkMarkdown(body, "T", opts);
  assert.ok(chunks.every((c) => !c.text.includes("approved")));
});

test("empty sections produce no chunks", () => {
  assert.equal(chunkMarkdown("## A\n\n## B\n", "T", opts).length, 0);
});
