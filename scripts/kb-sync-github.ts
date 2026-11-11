/**
 * kb-sync-github: writes knowledge/_auto/repos/<name>.md for each repo in knowledge/_sources.yml
 * (and repos with the configured topic). Hand-written public project files that already link to
 * the repo take priority, so no auto file is written for them. Auto files are `draft` unless the
 * repo is listed under `publish:` in _sources.yml. A GitHub outage never breaks the build: files
 * that could not be refreshed are kept as they are (use --strict to fail instead).
 *
 * Usage: npm run kb:sync [-- --strict]
 * Optional env: GITHUB_TOKEN (raises the API rate limit; never printed).
 */
import fs from "node:fs";
import path from "node:path";
import { kbRoot, listKbFiles, loadEnvFiles, readKbFile } from "./kb-common";
import { autoFileName, cleanReadme, githubClient, matchesRepo, parseSources, renderRepoFile } from "./kb-sync-core";

async function main() {
  loadEnvFiles();
  const strict = process.argv.includes("--strict");
  const root = kbRoot();
  const sourcesPath = path.join(root, "_sources.yml");
  if (!fs.existsSync(sourcesPath)) {
    console.log("kb-sync: no _sources.yml, nothing to do");
    return;
  }
  const cfg = parseSources(fs.readFileSync(sourcesPath, "utf8"));
  const gh = githubClient(fetch, process.env.GITHUB_TOKEN?.trim() || undefined);

  const slugs = new Set(cfg.repos);
  if (cfg.topic && cfg.owner) {
    try {
      for (const s of await gh.byTopic(cfg.owner, cfg.topic)) slugs.add(s);
    } catch (e) {
      console.warn(`kb-sync: topic search failed (${(e as Error).message}); using the listed repos only`);
    }
  }

  // Hand-written public files take priority: collect the repo URLs they link to.
  const handWritten = new Set<string>();
  for (const abs of listKbFiles(root)) {
    const f = readKbFile(abs, root);
    if (f.rel.startsWith("_auto/") || f.rel.startsWith("_generated/") || !f.frontmatter) continue;
    const links = f.frontmatter.links as Record<string, unknown> | undefined;
    if (f.frontmatter.visibility === "public" && typeof links?.repo === "string") handWritten.add(links.repo.toLowerCase().replace(/\/$/, ""));
  }

  const dir = path.join(root, "_auto", "repos");
  fs.mkdirSync(dir, { recursive: true });
  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const slug of [...slugs].sort()) {
    if (matchesRepo(cfg.exclude, slug)) continue;
    try {
      const info = await gh.repo(slug);
      const file = path.join(dir, autoFileName(info.name));
      if (info.private) throw new Error("private repository; refusing to publish its content");
      if (handWritten.has(info.html_url.toLowerCase().replace(/\/$/, ""))) {
        if (fs.existsSync(file)) fs.rmSync(file);
        skipped++;
        console.log(`  skip   ${slug} (hand-written public file takes priority)`);
        continue;
      }
      const [languages, readme] = await Promise.all([gh.languages(slug), gh.readme(slug)]);
      const out = renderRepoFile(info, languages, cleanReadme(readme), matchesRepo(cfg.publish, slug));
      const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (before !== out) fs.writeFileSync(file, out);
      written += before !== out ? 1 : 0;
      console.log(`  ${before === out ? "same  " : "write "} ${slug}`);
    } catch (e) {
      failed++;
      console.warn(`  FAILED ${slug}: ${(e as Error).message}`);
    }
  }
  console.log(`kb-sync: ${written} written, ${skipped} skipped, ${failed} failed`);
  if (strict && failed) process.exit(1);
}

main().catch((e) => {
  console.error(`kb-sync crashed: ${(e as Error).message}`);
  process.exit(1);
});
