import type { MiddlewareHandler } from "hono";
import { MCP_ACCESS_KEY } from "./config.ts";

// Constant-time comparison so timing attacks can't enumerate the key one byte
// at a time. The loop always runs `expected.length` iterations regardless of
// the provided value's length, and any length mismatch is folded into the
// diff accumulator instead of short-circuiting. `charCodeAt` returns NaN past
// the end of a string; `| 0` coerces that to 0, so length-mismatched inputs
// still XOR cleanly without an early return that would leak length.
function safeEqual(provided: string, expected: string): boolean {
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) {
    diff |= (provided.charCodeAt(i) | 0) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// Header-only authentication. Query-string credentials (`?key=...`) leak
// through proxy logs, server access logs, browser history, and Referrer
// headers, so they're rejected here even though some upstream OB1 variants
// accept them.
export const requireBrainKey: MiddlewareHandler = async (c, next) => {
  const provided = c.req.header("x-brain-key") ?? "";
  if (!provided || !safeEqual(provided, MCP_ACCESS_KEY)) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }
  await next();
};
