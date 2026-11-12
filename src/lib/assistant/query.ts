/** Normalises a visitor question so that a starter chip typed or clicked verbatim hits the precomputed embedding. */
export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[?.!\s]+$/g, "")
    .trim();
}
