/**
 * Pure helpers for the GitHub sync (plan 5.2 item 2): parse _sources.yml, call the public
 * GitHub REST API through an injected fetch, and render knowledge/_auto/repos/<name>.md.
 * Never reads secrets other than an optional GITHUB_TOKEN passed in by the caller.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface SourcesConfig {
  owner?: string;
  /** Topic that also pulls a repo in automatically (needs `owner`). */
  topic?: string;
  repos: string[]; // "owner/name"
  exclude: string[]; // repo names or "owner/name"
  /** Repos whose auto file is written with visibility: public. Default: everything is draft. */
  publish: string[];
}

export function parseSources(text: string): SourcesConfig {
  const raw = (parseYaml(text) ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return {
    owner: typeof raw.owner === "string" ? raw.owner : undefined,
    topic: typeof raw.topic === "string" ? raw.topic : undefined,
    repos: list(raw.repos),
    exclude: list(raw.exclude),
    publish: list(raw.publish),
  };
}

export const matchesRepo = (list: string[], slug: string) => {
  const name = slug.split("/")[1] ?? slug;
  return list.some((x) => x.toLowerCase() === slug.toLowerCase() || x.toLowerCase() === name.toLowerCase());
};

export interface RepoInfo {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  topics?: string[];
  language: string | null;
  pushed_at: string;
  fork?: boolean;
  archived?: boolean;
  private?: boolean;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** README to plain, bounded, public-safe text: no HTML, images, badges, emails; cut at a paragraph. */
export function cleanReadme(md: string, max = 3500): string {
  const text = md
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(EMAIL_RE, "[email removed]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const para = cut.lastIndexOf("\n\n");
  return `${(para > max * 0.5 ? cut.slice(0, para) : cut).trimEnd()}\n\n(README truncated.)`;
}

/** Demote README headings so they cannot clash with the generated file's own structure. */
function demoteHeadings(md: string): string {
  return md.replace(/^(#{1,5})\s/gm, (_m, h: string) => `${h}# `);
}

export function renderRepoFile(info: RepoInfo, languages: Record<string, number>, readme: string, publish: boolean): string {
  const total = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
  const langs = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k} (${Math.round((v / total) * 100)}%)`);
  const links: Record<string, string> = { repo: info.html_url };
  if (info.homepage && /^https?:\/\//i.test(info.homepage)) links.demo = info.homepage;
  const fm = {
    title: `${info.name} (GitHub summary)`,
    type: "project",
    date: info.pushed_at.slice(0, 7),
    status: "auto-synced from GitHub",
    tags: ["github", "auto-synced", ...(info.topics ?? [])],
    visibility: publish ? "public" : "draft",
    links,
  };
  const lines = [
    "---",
    stringifyYaml(fm).trimEnd(),
    "---",
    `# ${info.name} (GitHub summary)`,
    "",
    "Generated automatically from the GitHub repository; do not edit by hand. A hand-written project file, when it exists, is the authoritative description.",
    "",
    `- Repository: ${info.html_url}`,
    `- Description: ${info.description?.trim() || "(none)"}`,
    `- Main language: ${info.language ?? "n/a"}${langs.length ? `; languages: ${langs.join(", ")}` : ""}`,
    `- Last pushed: ${info.pushed_at.slice(0, 10)}`,
    info.topics?.length ? `- Topics: ${info.topics.join(", ")}` : "",
    "",
    "## README excerpt",
    "",
    readme ? demoteHeadings(readme) : "(no README)",
    "",
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "" )).join("\n");
}

export interface GithubClient {
  repo(slug: string): Promise<RepoInfo>;
  languages(slug: string): Promise<Record<string, number>>;
  readme(slug: string): Promise<string>;
  byTopic(owner: string, topic: string): Promise<string[]>;
}

export function githubClient(fetchImpl: typeof fetch = fetch, token?: string): GithubClient {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "portfolio-kb-sync" };
  if (token) headers.authorization = `Bearer ${token}`;
  const get = async (url: string, accept?: string) => {
    const res = await fetchImpl(url, { headers: accept ? { ...headers, accept } : headers });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${url.replace("https://api.github.com", "")}`);
    return res;
  };
  return {
    repo: async (slug) => (await (await get(`https://api.github.com/repos/${slug}`)).json()) as RepoInfo,
    languages: async (slug) => (await (await get(`https://api.github.com/repos/${slug}/languages`)).json()) as Record<string, number>,
    readme: async (slug) => {
      try {
        return await (await get(`https://api.github.com/repos/${slug}/readme`, "application/vnd.github.raw+json")).text();
      } catch {
        return "";
      }
    },
    byTopic: async (owner, topic) => {
      const res = await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(`user:${owner} topic:${topic}`)}&per_page=50`);
      const j = (await res.json()) as { items?: { full_name: string }[] };
      return (j.items ?? []).map((i) => i.full_name);
    },
  };
}

/** Auto file name for a repo: lower-case, safe characters. */
export const autoFileName = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}.md`;
