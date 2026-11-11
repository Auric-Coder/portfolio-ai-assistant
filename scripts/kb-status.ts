/**
 * kb-status: list draft vs public knowledge files and counts (plan 5.5 step 6).
 *
 * Usage: npm run kb:status
 * Only files with `visibility: public` are ever indexed. This script never
 * changes visibility; promoting a file is a manual edit by Hemanga.
 */
import { countNeedsReview, kbRoot, listKbFiles, readKbFile } from "./kb-common";

const root = kbRoot();
const files = listKbFiles(root).map((abs) => readKbFile(abs, root));

type Row = { rel: string; type: string; date: string; vis: string; marks: number; note: string };
const rows: Row[] = files.map((f) => {
  const fm = f.frontmatter;
  const vis = fm ? String(fm.visibility ?? "(missing)") : "(no frontmatter)";
  return {
    rel: f.rel,
    type: fm ? String(fm.type ?? "?") : "?",
    date: fm && fm.date != null ? String(fm.date) : "-",
    vis,
    marks: countNeedsReview(f.raw),
    note: f.frontmatterError ?? "",
  };
});

const group = (v: string) => rows.filter((r) => r.vis === v);
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

function print(title: string, list: Row[]) {
  console.log(`\n${title} (${list.length})`);
  for (const r of list) {
    const marks = r.marks ? `  [${r.marks} NEEDS REVIEW]` : "";
    console.log(`  ${pad(r.rel, 36)} ${pad(r.type, 14)} ${pad(r.date, 8)}${marks}${r.note ? "  " + r.note : ""}`);
  }
}

console.log(`Knowledge base: ${root}`);
print("PUBLIC  (indexed)", group("public"));
print("DRAFT   (not indexed)", group("draft"));
const other = rows.filter((r) => r.vis !== "public" && r.vis !== "draft");
if (other.length) print("INVALID visibility / frontmatter", other);

const pub = group("public").length;
const dr = group("draft").length;
const totalMarks = rows.reduce((a, r) => a + r.marks, 0);
console.log(
  `\nTotal: ${rows.length} file(s) — ${pub} public, ${dr} draft${other.length ? `, ${other.length} invalid` : ""}; ${totalMarks} open [NEEDS REVIEW] marker(s).`,
);
console.log("Excluded from all of the above: _raw/, _intake-report.md");
