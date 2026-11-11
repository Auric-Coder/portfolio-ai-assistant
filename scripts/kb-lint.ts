/**
 * kb-lint: safety + schema gate for the knowledge base (plan 5.1 / 5.3).
 *
 * Usage: npm run kb:lint            (KB_DIR env overrides the directory)
 *
 * Errors (exit 1):
 *   - missing/invalid frontmatter (schema in plan 5.1)
 *   - phone-number patterns, API key/token patterns, emails not on the allowlist,
 *     home-address keywords  (checked in ALL files, draft or public)
 *   - [NEEDS REVIEW] markers or a missing/invalid `date` in PUBLIC files
 * Warnings: unknown frontmatter keys, missing `date` in drafts.
 *
 * `_raw/` and `_intake-report.md` are excluded entirely.
 */
import config from "../assistant.config";
import {
  DATE_REQUIRED_TYPES,
  KB_TYPES,
  KNOWN_KEYS,
  NEEDS_REVIEW_RE,
  VISIBILITIES,
  kbRoot,
  listKbFiles,
  readKbFile,
  type KbFile,
} from "./kb-common";

export interface Finding {
  file: string;
  line?: number;
  level: "error" | "warning";
  rule: string;
  message: string;
}

interface PatternRule {
  rule: string;
  re: RegExp;
  message: string;
}

const PHONE_RULES: PatternRule[] = [
  {
    rule: "phone",
    message: "looks like a phone number",
    re: /(?<![\w.])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?)?\d{3,5}[\s.-]\d{3,5}(?:[\s.-]\d{2,5})?(?!\w|\.\d|\s?%)/g,
  },
  { rule: "phone", message: "looks like a phone number (+country code)", re: /(?<!\w)\+\d{1,3}[\s-]?\d{6,}/g },
  { rule: "phone", message: "looks like a 10-digit mobile number", re: /(?<!\d)[6-9]\d{9}(?!\d)/g },
];

const SECRET_RULES: PatternRule[] = [
  { rule: "secret", message: "NVIDIA API key pattern (nvapi-)", re: /nvapi-[A-Za-z0-9_-]{8,}/g },
  { rule: "secret", message: "Google API key pattern (AIza)", re: /AIza[0-9A-Za-z_-]{20,}/g },
  { rule: "secret", message: "GitHub token pattern (ghp_)", re: /ghp_[A-Za-z0-9]{20,}/g },
  { rule: "secret", message: "GitHub fine-grained token pattern", re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { rule: "secret", message: "secret key pattern (sk-)", re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g },
  { rule: "secret", message: "AWS access key id pattern", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { rule: "secret", message: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

const ADDRESS_RULES: PatternRule[] = [
  { rule: "address", message: "address keyword (house/flat/plot number)", re: /\b(?:house|flat|plot|door)\s*(?:no\.?|number|#)\s*\d+/gi },
  { rule: "address", message: "address keyword (pin/postal code)", re: /\b(?:pin\s*code|pincode|postal\s*code|zip\s*code)\b/gi },
  { rule: "address", message: "address keyword (home/residential address)", re: /\b(?:home|residential|street|permanent|postal)\s+address\b|\bresid(?:es|ing)\s+at\b/gi },
  { rule: "address", message: "street-style address", re: /\b\d{1,4},?\s+[A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,3}\s+(?:Street|St\.|Road|Rd\.|Lane|Nagar|Colony|Marg)\b/g },
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

function scanPatterns(file: KbFile, rules: PatternRule[], out: Finding[]) {
  // Scan frontmatter + body so `links:` cannot smuggle anything through.
  const text = file.raw;
  const offsetLine = (i: number) => text.slice(0, i).split("\n").length;
  for (const r of rules) {
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      out.push({
        file: file.rel,
        line: offsetLine(m.index ?? 0),
        level: "error",
        rule: r.rule,
        message: `${r.message}: "${redact(m[0])}"`,
      });
    }
  }
}

function redact(s: string): string {
  return s.length <= 6 ? s : `${s.slice(0, 4)}…(${s.length} chars)`;
}

export function lintFile(file: KbFile, allowedEmails: string[]): Finding[] {
  const out: Finding[] = [];
  const f = (level: Finding["level"], rule: string, message: string, line?: number) =>
    out.push({ file: file.rel, level, rule, message, line });

  // ---- frontmatter schema ------------------------------------------------
  const fm = file.frontmatter;
  if (!fm) {
    f("error", "frontmatter", file.frontmatterError ?? "invalid frontmatter", 1);
  } else {
    const isPublic = fm.visibility === "public";
    const str = (k: string) => (fm[k] === undefined || fm[k] === null ? "" : String(fm[k]).trim());

    if (!str("title")) f("error", "frontmatter", "`title` is required");

    const type = str("type");
    if (!type) f("error", "frontmatter", "`type` is required");
    else if (!(KB_TYPES as readonly string[]).includes(type))
      f("error", "frontmatter", `invalid type "${type}" (allowed: ${KB_TYPES.join("|")})`);

    const vis = str("visibility");
    if (!vis) f("error", "frontmatter", "`visibility` is required (public | draft)");
    else if (!(VISIBILITIES as readonly string[]).includes(vis))
      f("error", "frontmatter", `invalid visibility "${vis}" (allowed: public|draft)`);

    const date = str("date");
    if (date) {
      if (!/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(date))
        f("error", "frontmatter", `invalid date "${date}" (use YYYY or YYYY-MM)`);
    } else if (DATE_REQUIRED_TYPES.has(type)) {
      f(isPublic ? "error" : "warning", "frontmatter", `\`date\` is missing for type "${type}"`);
    }

    if (fm.status !== undefined && typeof fm.status !== "string")
      f("error", "frontmatter", "`status` must be a string");

    if (fm.tags !== undefined) {
      if (!Array.isArray(fm.tags) || fm.tags.some((t) => typeof t !== "string"))
        f("error", "frontmatter", "`tags` must be a list of strings");
    }

    if (fm.links !== undefined) {
      const l = fm.links as unknown;
      if (l === null || typeof l !== "object" || Array.isArray(l)) {
        f("error", "frontmatter", "`links` must be a mapping of name -> URL");
      } else {
        for (const [k, v] of Object.entries(l as Record<string, unknown>)) {
          if (typeof v !== "string" || !/^https?:\/\/\S+$/.test(v))
            f("error", "frontmatter", `links.${k} must be an http(s) URL`);
        }
      }
    }

    for (const k of Object.keys(fm))
      if (!KNOWN_KEYS.has(k)) f("warning", "frontmatter", `unknown frontmatter key "${k}"`);

    // ---- publish gates ---------------------------------------------------
    if (isPublic) {
      NEEDS_REVIEW_RE.lastIndex = 0;
      for (const m of file.raw.matchAll(NEEDS_REVIEW_RE)) {
        f("error", "needs-review", "[NEEDS REVIEW] marker in a public file", file.raw.slice(0, m.index).split("\n").length);
      }
      if (!file.body.trim()) f("error", "frontmatter", "public file has an empty body");
    }
  }

  // ---- safety patterns (all files, draft or public) -----------------------
  scanPatterns(file, PHONE_RULES, out);
  scanPatterns(file, SECRET_RULES, out);
  scanPatterns(file, ADDRESS_RULES, out);

  const allow = new Set(allowedEmails.map((e) => e.toLowerCase()));
  EMAIL_RE.lastIndex = 0;
  for (const m of file.raw.matchAll(EMAIL_RE)) {
    if (!allow.has(m[0].toLowerCase())) {
      f("error", "email", `email not on the allowlist (assistant.config.ts allowedEmails): "${redact(m[0])}"`, file.raw.slice(0, m.index).split("\n").length);
    }
  }
  return out;
}

export function lintAll(root = kbRoot(), allowedEmails = config.allowedEmails) {
  const files = listKbFiles(root).map((abs) => readKbFile(abs, root));
  const findings = files.flatMap((file) => lintFile(file, allowedEmails));
  return { files, findings };
}

function main() {
  const root = kbRoot();
  const { files, findings } = lintAll(root);
  const errors = findings.filter((x) => x.level === "error");
  const warnings = findings.filter((x) => x.level === "warning");

  for (const x of [...errors, ...warnings]) {
    const loc = x.line ? `${x.file}:${x.line}` : x.file;
    console.log(`${x.level === "error" ? "ERROR  " : "warning"} ${loc}  [${x.rule}] ${x.message}`);
  }
  console.log(
    `\nkb-lint: ${files.length} file(s) in ${root} — ${errors.length} error(s), ${warnings.length} warning(s)`,
  );
  process.exit(errors.length ? 1 : 0);
}

// Run only when executed directly (tsx scripts/kb-lint.ts), not when imported by tests.
if (process.argv[1] && /kb-lint\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) main();
