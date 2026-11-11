/**
 * Pronouns the assistant uses when it talks ABOUT the person (third person), taken from
 * assistant.config.ts so a fork can switch to she/her, they/them, etc. The defaults are the
 * values the Hemanga deployment has always used, so leaving the config field out changes nothing.
 */
export interface Pronouns {
  /** "he", "she", "they" */
  subject: string;
  /** "him", "her", "them" */
  object: string;
  /** "his", "her", "their" */
  possessive: string;
}

export const DEFAULT_PRONOUNS: Pronouns = { subject: "he", object: "him", possessive: "his" };

export function resolvePronouns(p?: Partial<Pronouns> | null): Pronouns {
  return { ...DEFAULT_PRONOUNS, ...(p ?? {}) };
}

/** Escape text for use inside a RegExp source. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
