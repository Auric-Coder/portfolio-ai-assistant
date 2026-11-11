/**
 * kb-timeline: writes knowledge/_generated/timeline.md (newest 15 dated public items).
 * Never edit the output by hand. Usage: npm run kb:timeline
 */
import fs from "node:fs";
import path from "node:path";
import { kbRoot, listKbFiles, readKbFile } from "./kb-common";
import { buildTimeline } from "./kb-timeline-core";

const root = kbRoot();
const inputs = listKbFiles(root)
  .map((abs) => readKbFile(abs, root))
  .filter((f) => f.frontmatter && !f.rel.startsWith("_generated/"))
  .map((f) => ({ rel: f.rel, frontmatter: f.frontmatter as Record<string, unknown>, body: f.body }));

const out = buildTimeline(inputs);
const target = path.join(root, "_generated", "timeline.md");
fs.mkdirSync(path.dirname(target), { recursive: true });
const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
if (before === out) {
  console.log("kb-timeline: unchanged");
} else {
  fs.writeFileSync(target, out);
  console.log(`kb-timeline: wrote ${path.relative(process.cwd(), target)} (${out.split("\n").filter((l) => l.startsWith("- ")).length} items)`);
}
