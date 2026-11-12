export interface KbLinks {
  [name: string]: string;
}

export interface IndexChunk {
  id: string;
  file: string; // path relative to the KB root
  title: string;
  heading: string; // "" when the chunk is the file's lead section
  type: string;
  date?: string;
  tags: string[];
  links: KbLinks;
  /** Text including the `title > heading` prefix, ready to embed and to show the LLM. */
  text: string;
  hash: string;
  embedding: number[] | null;
}

export interface AssistantIndex {
  schemaVersion: number;
  /** null when the index was built without embeddings (BM25-only). */
  embeddingModel: string | null;
  dimensions: number | null;
  chunks: IndexChunk[];
  /** Precomputed query embeddings for the starter questions (same model as the chunks), so the chips need no embedding call. */
  queryEmbeddings?: { text: string; embedding: number[] }[];
}

export interface SourceChunk {
  title: string;
  url?: string;
}
