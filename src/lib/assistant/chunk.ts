/**
 * Markdown chunking (plan section 6): split on headings, ~300 tokens with
 * ~50 overlap, and prefix every chunk with `title > heading` so it stands alone.
 */
import { createHash } from "node:crypto";

export interface ChunkOptions {
  targetTokens: number;
  overlapTokens: number;
  tokensPerWord: number;
}

export interface RawChunk {
  heading: string;
  text: string; // includes the `title > heading` prefix
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function stripNoise(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n");
}

interface Section {
  heading: string;
  lines: string[];
}

/** Split a body into sections on markdown headings (and `**Q:` lines for FAQs). */
export function splitSections(body: string, fileTitle: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: "", lines: [] };
  const stack: string[] = [];
  const push = () => {
    if (current.lines.join("\n").trim()) sections.push(current);
  };
  for (const line of body.split("\n")) {
    const h = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    const q = /^\*\*Q:\s*(.+?)\*\*\s*$/.exec(line);
    if (h) {
      push();
      const level = h[1].length;
      stack.length = level - 1;
      stack[level - 1] = h[2];
      // The level-1 heading usually repeats the file title; do not repeat it in the prefix.
      const path = stack.filter(Boolean).filter((s, i) => !(i === 0 && s.trim() === fileTitle.trim()));
      current = { heading: path.join(" > "), lines: [] };
    } else if (q) {
      push();
      current = { heading: q[1], lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  push();
  return sections;
}

/** Break section text into units (paragraphs / bullets), splitting oversized ones by words. */
function toUnits(text: string, maxWords: number): string[] {
  const units: string[] = [];
  for (const block of text.split(/\n(?=\s*(?:[-*]|\d+\.)\s)|\n{2,}/)) {
    const t = block.trim();
    if (!t) continue;
    const words = t.split(/\s+/);
    if (words.length <= maxWords) units.push(t);
    else for (let i = 0; i < words.length; i += maxWords) units.push(words.slice(i, i + maxWords).join(" "));
  }
  return units;
}

export function chunkMarkdown(body: string, fileTitle: string, opts: ChunkOptions): RawChunk[] {
  const maxWords = Math.max(20, Math.floor(opts.targetTokens / opts.tokensPerWord));
  const overlapWords = Math.floor(opts.overlapTokens / opts.tokensPerWord);
  const out: RawChunk[] = [];

  for (const section of splitSections(stripNoise(body), fileTitle)) {
    const prefix = section.heading ? `${fileTitle} > ${section.heading}` : fileTitle;
    const units = toUnits(section.lines.join("\n"), maxWords);
    let buf: string[] = [];
    let bufWords = 0;
    const emit = () => {
      if (!buf.length) return;
      out.push({ heading: section.heading, text: `${prefix}\n${buf.join("\n")}` });
    };
    for (const u of units) {
      const w = wordCount(u);
      if (bufWords + w > maxWords && buf.length) {
        emit();
        // Carry trailing units as overlap, never the whole buffer.
        const carry: string[] = [];
        let cw = 0;
        for (let i = buf.length - 1; i > 0 && cw < overlapWords; i--) {
          carry.unshift(buf[i]);
          cw += wordCount(buf[i]);
        }
        buf = cw <= overlapWords + 5 ? carry : [];
        bufWords = buf.reduce((a, b) => a + wordCount(b), 0);
      }
      buf.push(u);
      bufWords += w;
    }
    emit();
  }
  return out;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
