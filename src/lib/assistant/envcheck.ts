/**
 * Which environment variables are absent, and what that costs. Used for one startup note per server
 * instance. Names and effects only: values are never read into the message.
 */
export interface EnvRequirement {
  name: string;
  effect: string;
}

export const ENV_REQUIREMENTS: EnvRequirement[] = [
  { name: "NVIDIA_API_KEY", effect: "primary model unavailable, every answer falls back to Gemini" },
  { name: "GEMINI_API_KEY", effect: "no query embeddings (keyword-only retrieval) and no fallback model" },
  { name: "UPSTASH_REDIS_REST_URL", effect: "rate limit and question log are per server instance only" },
  { name: "UPSTASH_REDIS_REST_TOKEN", effect: "rate limit and question log are per server instance only" },
  { name: "IP_HASH_SALT", effect: "visitor IPs are hashed with a random per-process salt (limits reset on every cold start)" },
];

export function missingEnv(env: Record<string, string | undefined>): EnvRequirement[] {
  return ENV_REQUIREMENTS.filter((r) => !env[r.name]?.trim());
}

/** One line for the log, or null when nothing is missing. */
export function missingEnvNote(env: Record<string, string | undefined>): string | null {
  const missing = missingEnv(env);
  if (!missing.length) return null;
  return `[assistant] missing environment variables: ${missing.map((m) => `${m.name} (${m.effect})`).join("; ")}`;
}
