/**
 * Pure timeline generation (plan 5.2 item 3). No I/O, deterministic output (no timestamps),
 * so the CI job only commits when the knowledge actually changed.
 */

export interface TimelineInput {
  rel: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Things built or achieved. Aggregate files (education, experience, certifications) are left out:
 * one file with one date makes a misleading timeline entry. Per-item files added with /kb-add
 * (e.g. knowledge/achievements/<name>.md) show up automatically.
 */
export const TIMELINE_TYPES = new Set(["project", "achievement"]);

/** Normalises a frontmatter date (YYYY, YYYY-MM, a YAML date, or a number) to a string, or null. */
export function normalizeDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) ? s : null;
}

/** Sort key: later dates sort higher; a bare year sorts below any month of that year. */
export function sortKey(date: string): string {
  const [y, m = "00", d = "00"] = date.split("-");
  return `${y}-${m}-${d}`;
}

/** First sentence of the body's prose (headings, comments, lists and markup skipped). */
export function firstSentence(body: string, max = 220): string {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("-") && !l.startsWith("*") && !l.startsWith(">") && !l.startsWith("|"))
    .join(" ")
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const m = /^(.+?[.!?])(\s|$)/.exec(text);
  const sentence = m ? m[1] : text;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

export function buildTimeline(files: TimelineInput[], limit = 15): string {
  const items = files
    .filter((f) => {
      const fm = f.frontmatter;
      if (f.rel.startsWith("_auto/") || f.rel.startsWith("_generated/")) return false;
      if (fm.visibility !== "public") return false;
      if (!TIMELINE_TYPES.has(String(fm.type))) return false;
      return normalizeDate(fm.date) !== null;
    })
    .map((f) => ({
      date: normalizeDate(f.frontmatter.date) as string,
      type: String(f.frontmatter.type),
      title: String(f.frontmatter.title ?? f.rel),
      summary: firstSentence(f.body),
      rel: f.rel,
    }))
    .sort((a, b) => sortKey(b.date).localeCompare(sortKey(a.date)) || a.title.localeCompare(b.title))
    .slice(0, limit);

  const lines = items.map((i) => `- **${i.date}** · ${i.type} · **${i.title}**${i.summary ? `: ${i.summary}` : ""}`);
  return [
    "---",
    "title: Timeline of recent work and milestones",
    "type: about",
    "tags: [timeline, recent, latest]",
    "visibility: public",
    "---",
    "# Recent timeline",
    "",
    `The newest ${items.length} dated items, newest first. Use this for questions like "what has he built recently?" or "what did he do in 2026?".`,
    "",
    ...lines,
    "",
  ].join("\n");
}
