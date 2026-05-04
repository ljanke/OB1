import type { MiddlewareHandler } from "hono";
import { MCP_ACCESS_KEY } from "./config.ts";

// Constant-time comparison so timing attacks can't enumerate the key one byte
// at a time.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const requireBrainKey: MiddlewareHandler = async (c, next) => {
  const headerKey = c.req.header("x-brain-key");
  const queryKey = new URL(c.req.url).searchParams.get("key");
  const provided = headerKey || queryKey || "";
  if (!provided || !safeEqual(provided, MCP_ACCESS_KEY)) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }
  await next();
};
