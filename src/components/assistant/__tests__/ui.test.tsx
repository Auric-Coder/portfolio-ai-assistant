import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { applyEvent, dedupeSources, friendlyHttpError, GENERIC_ERROR, SseParser, streamChat, toHistory } from "../chatClient";
import { Markdown, isSafeUrl } from "../markdown";
import { ChatPanel, PRIVACY_NOTE } from "../ChatPanel";
import { ChatWidget } from "../ChatWidget";
import type { ChatPanelConfig, UiMessage, WireEvent } from "../types";

const config: ChatPanelConfig = {
  assistantName: "Nova",
  subjectName: "Hemanga",
  greeting: "Hi, I'm Nova, Hemanga's AI assistant.",
  starterQuestions: ["What are Hemanga's best projects?", "What's his tech stack?"],
};
const noop = () => {};
const esc = (s: string) => s.replace(/'/g, "&#x27;");

// ---- SSE parsing ------------------------------------------------------------

test("SseParser handles events split across chunks and CRLF, skipping junk", () => {
  const p = new SseParser();
  assert.deepEqual(p.push('data: {"type":"token","te'), []);
  const b = p.push('xt":"Hi"}\n\ndata: not json\n\ndata: {"type":"done","sources":[],"refused":false}\r\n\r\n');
  assert.deepEqual(b, [
    { type: "token", text: "Hi" },
    { type: "done", sources: [], refused: false },
  ]);
  assert.deepEqual(p.push('data: {"type":"other"}\n\n'), []);
});

function streamResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}
const ev = (e: WireEvent) => `data: ${JSON.stringify(e)}\n\n`;

test("streamChat delivers events in order and posts only role/content", async () => {
  let sent: { messages: unknown } = { messages: null };
  const f = (async (_u: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return streamResponse([ev({ type: "token", text: "A" }), ev({ type: "token", text: "B" }), ev({ type: "done", sources: [{ title: "T" }], refused: false })]);
  }) as unknown as typeof fetch;
  const got: WireEvent[] = [];
  await streamChat({ messages: [{ role: "user", content: "q" }], fetchImpl: f, onEvent: (e) => got.push(e) });
  assert.deepEqual(got.map((e) => e.type), ["token", "token", "done"]);
  assert.deepEqual(sent.messages, [{ role: "user", content: "q" }]);
});

test("streamChat maps HTTP errors to friendly messages and never leaks the body", async () => {
  const f = (async () => new Response("secret upstream detail", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(
    streamChat({ messages: [], fetchImpl: f, onEvent: noop }),
    (e: Error) => e.message === friendlyHttpError(429) && !e.message.includes("secret"),
  );
  const down = (async () => {
    throw new Error("ECONNREFUSED http://x");
  }) as unknown as typeof fetch;
  await assert.rejects(streamChat({ messages: [], fetchImpl: down, onEvent: noop }), (e: Error) => e.message === GENERIC_ERROR);
});

test("a stream that ends without done yields a final error event", async () => {
  const f = (async () => streamResponse([ev({ type: "token", text: "partial" })])) as unknown as typeof fetch;
  const got: WireEvent[] = [];
  await streamChat({ messages: [], fetchImpl: f, onEvent: (e) => got.push(e) });
  assert.equal(got[got.length - 1].type, "error");
});

test("applyEvent builds a message and de-duplicates sources", () => {
  let m: UiMessage = { id: "1", role: "assistant", content: "" };
  m = applyEvent(m, { type: "token", text: "Hel" });
  m = applyEvent(m, { type: "token", text: "lo" });
  m = applyEvent(m, { type: "done", sources: [{ title: "A" }, { title: "A" }, { title: "B", url: "https://x.test" }], refused: false });
  assert.equal(m.content, "Hello");
  assert.deepEqual(m.sources?.map((s) => s.title), ["A", "B"]);
  const e = applyEvent({ id: "2", role: "assistant", content: "" }, { type: "error", message: "boom" });
  assert.equal(e.error, true);
  assert.equal(dedupeSources(undefined).length, 0);
});

test("toHistory keeps completed turns only, bounded to 6 past messages", () => {
  const msgs: UiMessage[] = Array.from({ length: 10 }, (_, i) => ({ id: String(i), role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  msgs.push({ id: "e", role: "assistant", content: "failed", error: true });
  const h = toHistory(msgs, "new");
  assert.equal(h.length, 7);
  assert.deepEqual(h[h.length - 1], { role: "user", content: "new" });
  assert.ok(!h.some((x) => x.content === "failed"));
});

// ---- markdown safety --------------------------------------------------------

test("Markdown renders formatting, links and lists without raw HTML", () => {
  const html = renderToStaticMarkup(<Markdown text={"**Bold** and *it* and `code`\n\n- one\n- two\n\nSee https://hemangakashyap.in/#contact."} />);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>it<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<a href="https:\/\/hemangakashyap\.in\/#contact" target="_blank" rel="noopener noreferrer">https:\/\/hemangakashyap\.in\/#contact<\/a>\./);
});

test("Markdown escapes HTML and drops javascript: links", () => {
  const html = renderToStaticMarkup(<Markdown text={"<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://a.test)"} />);
  assert.ok(!html.includes("<img"));
  assert.ok(!/href="javascript:/i.test(html));
  assert.match(html, /href="https:\/\/a\.test"/);
  assert.equal(isSafeUrl("javascript:alert(1)"), false);
  assert.equal(isSafeUrl("data:text/html,x"), false);
});

// ---- panel rendering (state -> markup) --------------------------------------

test("minimized mode renders only the chip, with an accessible name", () => {
  const html = renderToStaticMarkup(<ChatPanel mode="minimized" pinned={false} config={config} onModeChange={noop} onPinnedChange={noop} />);
  assert.match(html, /class="nova-chip"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Ask Nova/);
  assert.ok(!html.includes('class="nova-panel"'));
});

test("expanded mode shows label, static greeting, starter chips, input and privacy note", () => {
  const html = renderToStaticMarkup(<ChatPanel mode="expanded" pinned onModeChange={noop} onPinnedChange={noop} config={config} />);
  assert.match(html, /AI assistant · Nova/);
  assert.ok(html.includes(esc(config.greeting)));
  for (const q of config.starterQuestions) assert.ok(html.includes(esc(q)), q);
  assert.match(html, /aria-label="Minimize chat"/);
  assert.match(html, /role="log"/);
  assert.match(html, /aria-live="polite"/);
  assert.ok(html.includes(esc(PRIVACY_NOTE)));
  assert.match(html, /maxLength="500"|maxlength="500"/i);
});

test("the panel never contains secrets or server env names", () => {
  const html = renderToStaticMarkup(<ChatPanel mode="expanded" pinned onModeChange={noop} onPinnedChange={noop} config={config} />);
  assert.ok(!/nvapi-|AIza|API_KEY|process\.env/.test(html));
});

test("sheet layout is exposed for narrow viewports", () => {
  const html = renderToStaticMarkup(<ChatPanel mode="expanded" pinned layout="sheet" onModeChange={noop} onPinnedChange={noop} config={config} />);
  assert.match(html, /data-layout="sheet"/);
});

test("ChatWidget renders a closed launcher by default", () => {
  const html = renderToStaticMarkup(<ChatWidget config={config} />);
  assert.match(html, /nova-launcher/);
  assert.match(html, /aria-expanded="false"/);
  assert.ok(!html.includes('class="nova-panel"'));
});

// ---- output guard event and hidden sources ----------------------------------------

test("a replace event overwrites everything streamed so far (output guard) and the SSE parser accepts it", () => {
  const events = new SseParser().push('data: {"type":"replace","text":"I can only discuss Hemanga."}\n\n');
  assert.deepEqual(events, [{ type: "replace", text: "I can only discuss Hemanga." }]);
  let m: UiMessage = { id: "1", role: "assistant", content: "" };
  m = applyEvent(m, { type: "token", text: "Sure, here is code:\n``" });
  m = applyEvent(m, { type: "token", text: "`python" });
  m = applyEvent(m, { type: "replace", text: "I can only discuss Hemanga." });
  m = applyEvent(m, { type: "done", sources: [], refused: true, reason: "off-topic" });
  assert.equal(m.content, "I can only discuss Hemanga.");
  assert.equal(m.refused, true);
});

function fakeChat(messages: UiMessage[]) {
  return { messages, status: "idle" as const, busy: false, send: async () => {}, retry: async () => {}, stop: () => {}, reset: () => {} };
}
const answered: UiMessage[] = [
  { id: "u", role: "user", content: "Tell me about MultiDocChat" },
  { id: "a", role: "assistant", content: "It is a hybrid RAG platform.", sources: [{ title: "MultiDocChat v2", url: "https://x.test" }] },
];

test("showSources false: no source chips and no Sources line are rendered, even when the API returned sources", () => {
  const html = renderToStaticMarkup(
    <ChatPanel mode="expanded" pinned onModeChange={noop} onPinnedChange={noop} config={{ ...config, showSources: false }} controller={fakeChat(answered)} />,
  );
  assert.ok(html.includes("It is a hybrid RAG platform."), "the answer is shown");
  assert.ok(!html.includes('aria-label="Sources"') && !html.includes("MultiDocChat v2") && !html.includes("https://x.test"));
});

test("showSources true (and the generic default) renders the chips with their links", () => {
  for (const cfg of [{ ...config, showSources: true }, config]) {
    const html = renderToStaticMarkup(<ChatPanel mode="expanded" pinned onModeChange={noop} onPinnedChange={noop} config={cfg} controller={fakeChat(answered)} />);
    assert.ok(html.includes('aria-label="Sources"') && html.includes("MultiDocChat v2") && html.includes('href="https://x.test"'));
  }
});
