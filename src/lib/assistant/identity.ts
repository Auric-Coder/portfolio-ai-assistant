import { escapeRegExp } from "./pronouns";

/**
 * Questions about the assistant itself ("Who are you?", "Are you a bot?", "Are you a real person?").
 * They are about the assistant, not about the person, so they score low against the knowledge base
 * and the relevance gate would answer with "I don't have information about that". They bypass the gate
 * and go to the model, whose prompt says to answer plainly that it is an AI assistant.
 */
export function buildIdentityPatterns(assistantName: string, subjectName: string): RegExp[] {
  const a = escapeRegExp(assistantName.toLowerCase());
  const s = escapeRegExp(subjectName.toLowerCase());
  return [
    /^\s*(so\s+|and\s+|hey\s+|hi\s+)?(who|what)\s+(are|r)\s+(you|u)\b/i,
    /\b(are|r)\s+(you|u)\s+(a\s+|an\s+|the\s+)?(real\s+|actual\s+|live\s+)?(person|human|robot|bot|chatbot|ai|a\.i\.|assistant|machine|program|llm|language model)\b/i,
    /\bam\s+i\s+(talking|speaking|chatting|texting)\s+(to|with)\s+(a\s+|an\s+)?(person|human|bot|ai|robot|someone|something)\b/i,
    /\bis\s+this\s+(a\s+|an\s+)?(real\s+)?(person|human|bot|ai|chatbot|robot)\b/i,
    /\b(your|ur)\s+name\b/i,
    /\bwhat\s+should\s+i\s+call\s+you\b/i,
    /\bwho\s+(made|built|created|developed|designed|programmed|trained|coded)\s+(you|u)\b/i,
    /\bhow\s+(do|does|did)\s+(you|u|this\s+(assistant|chat|chatbot|bot|thing))\s+(work|function|know)\b/i,
    /\bhow\s+(were|are)\s+(you|u)\s+(made|built|created|trained)\b/i,
    /\bwhat\s+can\s+(you|u)\s+(do|help\s+(me\s+)?with)\b/i,
    new RegExp(String.raw`\bdid\s+${s}\s+(make|build|create|develop|design|code)\s+(you|u)\b`, "i"),
    new RegExp(String.raw`\bare\s+(you|u)\s+${a}\b`, "i"),
    new RegExp(String.raw`\bare\s+(you|u)\s+${s}\b`, "i"),
  ];
}

export function isIdentityQuestion(question: string, assistantName: string, subjectName: string): boolean {
  const q = question.trim();
  return buildIdentityPatterns(assistantName, subjectName).some((r) => r.test(q));
}
