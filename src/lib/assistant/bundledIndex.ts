/**
 * The build-time index, bundled with the server (route handler only). Kept in its own
 * module so tests and the CLI, which read the index from disk, never pull it in.
 */
import indexJson from "../../../data/assistant-index.json";
import type { AssistantIndex } from "./types";

export function loadBundledIndex(): AssistantIndex {
  return indexJson as unknown as AssistantIndex;
}
