/**
 * Site-specific values for the assistant. This is the ONLY file you edit to make the assistant yours
 * (plus the markdown files in your knowledge folder). The assistant code never hard-codes a name or URL.
 *
 * This repo ships a clearly fictional sample persona ("Arlo Quill") so everything runs out of the box.
 * Replace the values below and the files in knowledge.example/ with your own.
 */

export interface AssistantConfig {
  /** Display name of the assistant persona. */
  assistantName: string;
  /** Name of the person the assistant talks about (third person). */
  subjectName: string;
  /** Public site URL (used for contact / resume pointers). */
  siteUrl: string;
  /** Where visitors are sent when the knowledge base cannot answer. */
  contactUrl: string;
  /** Public résumé link shown when the assistant is resting (daily cap reached). Optional. */
  resumeUrl?: string;
  /** GitHub profile, offered with project links when a visitor asks where to see the code. Optional. */
  githubUrl?: string;
  /**
   * Pronouns used when the assistant talks about the person (third person). Optional: defaults to he/him/his.
   * For a different person use e.g. { subject: "she", object: "her", possessive: "her" } or they/them/their.
   */
  pronouns?: { subject: string; object: string; possessive: string };
  /** Knowledge base directory, relative to the repo root. Override with the KB_DIR env var. */
  kbDir: string;
  /** Origins allowed to call /api/chat. Add your production domain. */
  allowedOrigins: string[];
  /** Emails that may appear in knowledge files. Everything else fails `npm run kb:lint`. */
  allowedEmails: string[];
  /** Show source chips under answers. Sources always stay in the API's final event. */
  showSources: boolean;
  autoSummon: "first-click" | "never" | "every-click";
  greeting: string;
  starterQuestions: string[];
}

const config: AssistantConfig = {
  assistantName: "Sage",
  subjectName: "Arlo",
  pronouns: { subject: "he", object: "him", possessive: "his" },
  siteUrl: "https://example.com",
  contactUrl: "https://example.com/#contact",
  resumeUrl: "https://example.com/resume.pdf",
  githubUrl: "https://github.com/example-user",
  kbDir: "knowledge.example",
  allowedOrigins: ["http://localhost:3000"],
  allowedEmails: [],
  showSources: true,
  autoSummon: "first-click",
  greeting:
    "Hi, I'm Sage, an AI assistant for Arlo Quill's (fictional) portfolio. Ask about his projects, skills, education or achievements. I only answer from the sample notes in knowledge.example/, so if I don't know something, I'll say so.",
  starterQuestions: [
    "What are Arlo's best projects?",
    "What's his tech stack?",
    "Tell me about TideWatch",
    "What is he looking for next?",
  ],
};

export default config;
