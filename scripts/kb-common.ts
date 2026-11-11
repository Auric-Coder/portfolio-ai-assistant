/**
 * Shared helpers for the knowledge-base scripts (kb-lint, kb-status, ...).
 * Extractable boundary: imports only npm packages, node builtins and the
 * root-level assistant.config.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import config from "../assistant.config";

export const KB_TYPES = [
  "project",
  "achievement",
  "education",
  "experience",
  "skill",
  "certification",
  "hobby",
  "faq",
  "about",
] as const;
export const VISIBILITIES = ["public", "draft"] as const;

/** Types whose content is time-bound, so `date` is mandatory once public. */
export const DATE_REQUIRED_TYPES = new Set<string>([
  "project",
  "achievement",
  "education",
  "experience",
  "certification",
]);

export const KNOWN_KEYS = new Set([
  "title",
  "type",
  "date",
  "status",
  "tags",
  "visibility",
  "links",
]);

/** Marker that must not survive into public files. */
export const NEEDS_REVIEW_RE = /\[NEEDS REVIEW/gi;

export function kbRoot(): string {
  return path.resolve(process.cwd(), process.env.KB_DIR ?? config.kbDir);
}

export interface KbFile {
  abs: string;
  rel: string; // posix-style, relative to kb root
  raw: string;
  frontmatter: Record<string, unknown> | null;
  frontmatterError: string | null;
  body: string;
  bodyStartLine: number; // 1-based line where body begins
}

/** Paths (relative to the KB root) that are never linted, indexed or mirrored. */
export function isExcluded(rel: string): boolean {
  const first = rel.split("/")[0];
  return first === "_raw" || rel === "_intake-report.md";
}

export function listKbFiles(root = kbRoot()): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (isExcluded(rel)) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(abs);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}

export function readKbFile(abs: string, root = kbRoot()): KbFile {
  const raw = fs.readFileSync(abs, "utf8").replace(/^﻿/, "");
  const rel = path.relative(root, abs).split(path.sep).join("/");
  const text = raw.replace(/\r\n/g, "\n");
  const result: KbFile = {
    abs,
    rel,
    raw: text,
    frontmatter: null,
    frontmatterError: null,
    body: text,
    bodyStartLine: 1,
  };
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) {
    result.frontmatterError = "missing frontmatter block (file must start with ---)";
    return result;
  }
  result.body = text.slice(m[0].length);
  result.bodyStartLine = m[0].split("\n").length;
  try {
    const parsed = parseYaml(m[1]);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      result.frontmatterError = "frontmatter must be a YAML mapping";
    } else {
      result.frontmatter = parsed as Record<string, unknown>;
    }
  } catch (e) {
    result.frontmatterError = `invalid YAML: ${(e as Error).message.split("\n")[0]}`;
  }
  return result;
}

export function countNeedsReview(text: string): number {
  return (text.match(NEEDS_REVIEW_RE) ?? []).length;
}

/**
 * Load .env.local / .env into process.env for CLI scripts (never prints values).
 * Existing environment variables win. Silent when the files do not exist.
 */
export function loadEnvFiles(cwd = process.cwd()): void {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(cwd, name);
    if (!fs.existsSync(p)) continue;
    try {
      const loader = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
      if (!loader) continue;
      // process.loadEnvFile does not override variables that are already set.
      loader.call(process, p);
    } catch {
      /* unreadable env file: ignore */
    }
  }
}
