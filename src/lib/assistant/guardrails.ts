/**
 * Guardrails: input validation, pre-filter (blocked patterns) and the relevance gate.
 * Everything here runs BEFORE any LLM call, so refused questions cost nothing.
 */
import { config } from "./config";
import { DEFAULT_PRONOUNS, escapeRegExp, resolvePronouns, type Pronouns } from "./pronouns";
import type { RetrievalResult } from "./retrieval";

export type RefusalReason = "too-long" | "empty" | "contact-details" | "secrets" | "injection" | "irrelevant" | "off-topic";

export interface GuardResult {
  blocked: boolean;
  reason?: RefusalReason;
}

export const MAX_QUESTION_CHARS = 500;

/**
 * Patterns that ask for contact details. The ones that mention the person (name and pronouns) are
 * built from assistant.config.ts so a fork protects its own subject; for Hemanga the sources are
 * byte-identical to the previous hand-written literals (checked by the snapshot test).
 */
export function buildContactPatterns(subjectName: string, pronouns: Pronouns = DEFAULT_PRONOUNS): RegExp[] {
  const n = escapeRegExp(subjectName.toLowerCase());
  const him = escapeRegExp(pronouns.object);
  const he = escapeRegExp(pronouns.subject);
  const his = escapeRegExp(pronouns.possessive);
  return [
    /\b(phone|mobile|cell|whatsapp|telephone)\b.{0,20}\b(number|no\.?|num)\b/i,
    new RegExp(String.raw`\b(${his}|${n}'?s?)\b.{0,20}\b(phone|mobile|number|whatsapp)\b`, "i"),
    /\b(home|residential|house|street|permanent|current)\s+address\b/i,
    new RegExp(String.raw`\bwhere\s+(does|do)\s+(${he}|${n}|you)\s+live\b`, "i"),
    new RegExp(String.raw`\bwhat('?s| is)\s+(your|${his})\s+(address|phone|mobile|number)\b`, "i"),
    /\b(pin\s?code|postal code|zip code)\b/i,
    /\b(aadhaar|aadhar|passport|pan card|ssn|social security)\b/i,
    new RegExp(String.raw`\bcall\s+(${him}|you|${n})\b`, "i"),
    // email addresses are not shared either (the contact link is the way to reach them).
    // Kept narrow on purpose: "his email classifier project" must still be answerable.
    /\b(e-?mail|gmail)\s+(address|id)\b/i,
    /\bmail\s?id\b/i,
    new RegExp(String.raw`\b(${his}|${n}'?s?|your)\s+(personal\s+|official\s+|work\s+|college\s+|contact\s+)?(e-?mail|gmail)\s*[?.!]*\s*$`, "i"),
  ];
}

const CONTACT = buildContactPatterns(config.site.subjectName, resolvePronouns(config.site.pronouns));

const SECRETS = [
  /\bpasswords?\b/i,
  /\bapi[\s_-]?keys?\b/i,
  /\b(secret|access|auth)\s+(key|token)s?\b/i,
  /\bprivate\s+key\b/i,
  /\.env\b/i,
  /\b(nvapi-|AIza|ghp_|github_pat_)\S*/i,
  /\bsk-[A-Za-z0-9_-]{8,}/,
];

const INJECTION = [
  /ignore\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /disregard\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier)?\s*(instructions?|rules?|prompts?)/i,
  /forget\s+(everything|all|your)\s+(you|instructions?|rules?)/i,
  /(reveal|show|print|repeat|display|leak|tell me)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions?|rules?)/i,
  /system\s+prompt/i,
  /\byou\s+are\s+now\b/i,
  /\bact\s+as\b.{0,40}\b(dan|jailbroken|unrestricted|developer mode)\b/i,
  /\bjailbreak\b/i,
  /\bpretend\s+(to be|you('re| are))\b/i,
  /\bdeveloper\s+mode\b/i,
];

export function preFilter(input: string): GuardResult {
  const q = input.trim();
  if (!q) return { blocked: true, reason: "empty" };
  if (q.length > MAX_QUESTION_CHARS) return { blocked: true, reason: "too-long" };
  if (INJECTION.some((r) => r.test(q))) return { blocked: true, reason: "injection" };
  if (SECRETS.some((r) => r.test(q))) return { blocked: true, reason: "secrets" };
  if (CONTACT.some((r) => r.test(q))) return { blocked: true, reason: "contact-details" };
  return { blocked: false };
}

export interface GateConfig {
  /** Minimum best cosine similarity for a hybrid retrieval to count as relevant. */
  minCosine: number;
  /** Minimum best BM25 score when only keyword search is available. */
  minBm25: number;
  /** Cosine at or above this passes even without a keyword match. */
  strongCosine: number;
  /** Minimum BM25 score alongside a cosine pass (guards against pure-semantic false positives). */
  minBm25WithCosine: number;
}

/** Relevance gate: false means "not in my knowledge base", answered with a canned reply. */
export function passesRelevanceGate(r: RetrievalResult, g: GateConfig): boolean {
  if (!r.hits.length) return false;
  if (r.topCosine === null) return r.topBm25 >= g.minBm25;
  if (r.topCosine >= g.strongCosine) return true;
  return r.topCosine >= g.minCosine && r.topBm25 >= g.minBm25WithCosine;
}

export function refusalMessage(reason: RefusalReason, contactUrl: string, subject: string, pronouns: Pronouns = DEFAULT_PRONOUNS): string {
  switch (reason) {
    case "contact-details":
      return `I don't share personal contact details. The best way to reach ${subject} is the contact section of this site: ${contactUrl}`;
    case "secrets":
      return "I can't help with passwords, keys or other secrets.";
    case "injection":
      return `I can only answer questions about ${subject}, and I can't change how I work.`;
    case "off-topic":
      // Used by the output guard when a reply turns into off-topic work (code, recipes, essays...).
      return `I can only discuss ${subject} and ${pronouns.possessive} portfolio, so I can't help with that, but I'd be happy to tell you about ${pronouns.possessive} projects, skills or achievements.`;
    case "too-long":
      return `That message is too long. Please keep questions under ${MAX_QUESTION_CHARS} characters.`;
    case "empty":
      return "Please ask a question.";
    case "irrelevant":
    default:
      return `I don't have information about that, and I'd rather not guess. You can ask ${subject} directly through the contact section: ${contactUrl}`;
  }
}
