/**
 * HTTP adapter for the chat pipeline: validates the request and turns ChatEvents into a
 * Server-Sent-Events response. Pure Web APIs (Request/Response), so it is unit-testable.
 *
 * Wire format (text/event-stream), one JSON object per `data:` line:
 *   {"type":"token","text":"..."}      repeated
 *   {"type":"done","sources":[{title,url?}],"refused":false}   final
 *   {"type":"error","message":"..."}   instead of done on failure
 */
import { config } from "./config";
import { parseMessages, runChat, type ChatDeps, type ChatEvent } from "./chat";
import { serverTimingHeader, type Timings } from "./timing";

/** Requests this server instance has handled (the first one is a cold start). */
let instanceRequests = 0;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function jsonError(status: number, message: string, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...JSON_HEADERS, ...extra } });
}

export function originAllowed(req: Request, allowed: string[]): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl); abuse is handled by the rate limit
  if (allowed.includes(origin)) return true;
  // Vercel preview deployments and same-origin requests
  try {
    const host = req.headers.get("host");
    if (host && new URL(origin).host === host) return true;
  } catch {
    return false;
  }
  return false;
}

const encoder = new TextEncoder();
const sse = (e: ChatEvent) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`);

export async function handleChat(req: Request, deps: ChatDeps, preflight?: (req: Request) => Promise<Response | null>): Promise<Response> {
  if (!originAllowed(req, config.site.allowedOrigins)) return jsonError(403, "origin not allowed");
  if (preflight) {
    const blocked = await preflight(req);
    if (blocked) return blocked;
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return jsonError(415, "expected application/json");
  // Hard cap on the raw body before parsing (history + 500-char question fits well inside this).
  const raw = await req.text();
  if (raw.length > 20000) return jsonError(413, "request too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "invalid JSON");
  }
  const parsed = parseMessages(body);
  if (!parsed.ok) return jsonError(400, parsed.error);

  const timings: Timings = deps.timings ?? {};
  timings.cold = instanceRequests++ === 0;
  const gen = runChat(parsed.history, parsed.question, { ...deps, timings });

  // Run the pipeline up to the first event before answering, so the Server-Timing header can carry the
  // index/embed/retrieve/ttft timings and the provider actually used (headers cannot change once the
  // body has started). The client sees the same stream, just with headers that explain the latency.
  let pending: IteratorResult<ChatEvent, void> | undefined;
  let startFailed = false;
  try {
    pending = await gen.next();
  } catch {
    startFailed = true;
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (startFailed) {
          startFailed = false;
          controller.enqueue(sse({ type: "error", message: "The assistant is unavailable right now." }));
          return controller.close();
        }
        const r = pending ?? (await gen.next());
        pending = undefined;
        if (r.done) return controller.close();
        controller.enqueue(sse(r.value));
      } catch {
        controller.enqueue(sse({ type: "error", message: "The assistant is unavailable right now." }));
        controller.close();
      }
    },
    async cancel() {
      await gen.return(undefined);
    },
  });
  const headers: Record<string, string> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "x-accel-buffering": "no",
  };
  const serverTiming = serverTimingHeader(timings);
  if (serverTiming) headers["server-timing"] = serverTiming;
  return new Response(stream, { headers });
}
