// Environment-driven configuration. All knobs live here so the rest of the
// server reads typed constants instead of poking Deno.env directly.
//
// All values are validated at module load. Misconfiguration crashes fast
// with a clear error rather than producing NaN, empty strings, or other
// silent failure modes deep in request handlers.

function required(name: string): string {
  const v = Deno.env.get(name)?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function requiredInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid integer env var ${name}: "${raw}"`);
  }
  return value;
}

function optionalTrimmed(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
}

export const DB_HOST = optionalTrimmed("DB_HOST") || "127.0.0.1";
export const DB_PORT = requiredInt("DB_PORT", 5432);
export const DB_NAME = optionalTrimmed("DB_NAME") || "openbrain";
export const DB_USER = optionalTrimmed("DB_USER") || "openbrain_app";
export const DB_PASSWORD = required("DB_PASSWORD");
export const DB_POOL_SIZE = requiredInt("DB_POOL_SIZE", 10);

export const OLLAMA_URL = optionalTrimmed("OLLAMA_URL") || "http://localhost:11434";
export const EMBED_MODEL = optionalTrimmed("EMBED_MODEL") || "nomic-embed-text";
export const EMBED_DIM = requiredInt("EMBED_DIM", 768);

// Optional chat-completion endpoint for metadata extraction (topics, people,
// type, etc.). If unset, capture still works — falls back to minimal default
// metadata. Any OpenAI-compatible /chat/completions endpoint will do, including
// a local Ollama with `OLLAMA_URL/v1` set as CHAT_API_BASE and a chat model
// like `llama3.1:8b` set as CHAT_MODEL.
export const CHAT_API_BASE = optionalTrimmed("CHAT_API_BASE");
export const CHAT_API_KEY = optionalTrimmed("CHAT_API_KEY");
export const CHAT_MODEL = optionalTrimmed("CHAT_MODEL");
export const ENABLE_METADATA_EXTRACTION = Boolean(CHAT_API_BASE && CHAT_MODEL);

export const MCP_ACCESS_KEY = required("MCP_ACCESS_KEY");
export const PORT = requiredInt("PORT", 8787);

// CITATION_BASE_URL is used to mint per-thought URLs in the ChatGPT-compat
// search/fetch tools. Set it to your tailnet hostname (e.g.
// https://homebox.tailnet-name.ts.net/thoughts). The placeholder default
// won't resolve to anything useful — operators should override it.
export const CITATION_BASE_URL =
  optionalTrimmed("CITATION_BASE_URL") || "https://openbrain.local/thoughts";

// Outbound fetch timeout for Ollama embeddings and the optional chat API.
// 15 seconds is long enough for a slow first-load embed model warm-up and
// short enough that a hung backend can't tie up an MCP request indefinitely.
export const FETCH_TIMEOUT_MS = requiredInt("FETCH_TIMEOUT_MS", 15_000);
