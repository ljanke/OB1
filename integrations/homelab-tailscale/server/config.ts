// Environment-driven configuration. All knobs live here so the rest of the
// server reads typed constants instead of poking Deno.env directly.

function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const DB_HOST = Deno.env.get("DB_HOST") || "127.0.0.1";
export const DB_PORT = parseInt(Deno.env.get("DB_PORT") || "5432", 10);
export const DB_NAME = Deno.env.get("DB_NAME") || "openbrain";
export const DB_USER = Deno.env.get("DB_USER") || "openbrain_app";
export const DB_PASSWORD = required("DB_PASSWORD");
export const DB_POOL_SIZE = parseInt(Deno.env.get("DB_POOL_SIZE") || "10", 10);

export const OLLAMA_URL = Deno.env.get("OLLAMA_URL") || "http://localhost:11434";
export const EMBED_MODEL = Deno.env.get("EMBED_MODEL") || "nomic-embed-text";
export const EMBED_DIM = parseInt(Deno.env.get("EMBED_DIM") || "768", 10);

// Optional chat-completion endpoint for metadata extraction (topics, people,
// type, etc.). If unset, capture still works — falls back to minimal default
// metadata. Any OpenAI-compatible /chat/completions endpoint will do, including
// a local Ollama with `OLLAMA_URL/v1` set as CHAT_API_BASE and a chat model
// like `llama3.1:8b` set as CHAT_MODEL.
export const CHAT_API_BASE = Deno.env.get("CHAT_API_BASE") || "";
export const CHAT_API_KEY = Deno.env.get("CHAT_API_KEY") || "";
export const CHAT_MODEL = Deno.env.get("CHAT_MODEL") || "";
export const ENABLE_METADATA_EXTRACTION = Boolean(CHAT_API_BASE && CHAT_MODEL);

export const MCP_ACCESS_KEY = required("MCP_ACCESS_KEY");
export const PORT = parseInt(Deno.env.get("PORT") || "8787", 10);

export const CITATION_BASE_URL =
  Deno.env.get("CITATION_BASE_URL") || "https://openbrain.local/thoughts";
