// Open Brain MCP server — Homelab + Tailscale variant.
//
// HTTP transport: Streamable HTTP at /mcp, gated by x-brain-key header.
// Storage: vanilla Postgres + pgvector (no @supabase/supabase-js, no auth.uid).
// Embeddings: local Ollama (default model nomic-embed-text, 768 dim).
//
// Architecture is split into queries.ts (pure DB), embeddings.ts (Ollama),
// metadata.ts (optional chat-LLM extraction), auth.ts (header check), and this
// file (Hono app + MCP tool registration). A future REST gateway, CLI, or
// dashboard would import queries.ts directly.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";

import { CITATION_BASE_URL, PORT } from "./config.ts";
import { pool } from "./db.ts";
import { embed } from "./embeddings.ts";
import { extractMetadata } from "./metadata.ts";
import { requireBrainKey } from "./auth.ts";
import {
  captureThought,
  fetchThought,
  getStats,
  listThoughts,
  pingDb,
  searchThoughts,
} from "./queries.ts";

// ---------- Helpers --------------------------------------------------------

function thoughtTitle(content: string, createdAt?: string): string {
  const firstLine = content.replace(/\s+/g, " ").trim().slice(0, 80);
  const datePrefix = createdAt
    ? new Date(createdAt).toLocaleDateString()
    : "Open Brain";
  return firstLine ? `${datePrefix} - ${firstLine}` : `${datePrefix} thought`;
}

function thoughtUrl(id: string): string {
  return `${CITATION_BASE_URL.replace(/\/$/, "")}/${id}`;
}

function err(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

// ---------- MCP Server -----------------------------------------------------

const server = new McpServer({ name: "open-brain-homelab", version: "1.0.0" });

// ChatGPT-compatible search/fetch shapes (read-only). The standard names
// `search` and `fetch` are what restricted-connector surfaces look for.
server.registerTool(
  "search",
  {
    title: "Search Open Brain",
    description:
      "Search Open Brain memories by meaning. Read-only compatibility tool for ChatGPT-style search/fetch consumers.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe("The search query to run against Open Brain"),
    },
  },
  async ({ query }) => {
    try {
      const embedding = await embed(query);
      const rows = await searchThoughts(pool, { query, embedding });
      const results = rows.map((t) => ({
        id: t.id,
        title: thoughtTitle(t.content, t.created_at),
        url: thoughtUrl(t.id),
      }));
      return text(JSON.stringify({ results }));
    } catch (e) {
      return err((e as Error).message);
    }
  },
);

server.registerTool(
  "fetch",
  {
    title: "Fetch Open Brain Thought",
    description:
      "Fetch one Open Brain thought by ID after using search. Read-only compatibility tool.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      id: z.string().describe("The thought ID returned by search"),
    },
  },
  async ({ id }) => {
    try {
      const t = await fetchThought(pool, id);
      if (!t) return err(`No thought found for ID ${id}.`);
      const document = {
        id: t.id,
        title: thoughtTitle(t.content, t.created_at),
        text: t.content,
        url: thoughtUrl(t.id),
        metadata: {
          ...t.metadata,
          created_at: t.created_at,
          updated_at: t.updated_at,
        },
      };
      return text(JSON.stringify(document));
    } catch (e) {
      return err((e as Error).message);
    }
  },
);

server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use when the user asks about a topic, person, or idea they've previously captured.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.5),
    },
  },
  async ({ query, limit, threshold }) => {
    try {
      const embedding = await embed(query);
      const rows = await searchThoughts(pool, { query, embedding, limit, threshold });
      if (!rows.length) return text(`No thoughts found matching "${query}".`);
      const lines = rows.map((t, i) => {
        const m = t.metadata || {};
        const parts = [
          `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
          `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
          `Type: ${m.type ?? "unknown"}`,
        ];
        if (Array.isArray(m.topics) && m.topics.length) {
          parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
        }
        if (Array.isArray(m.people) && m.people.length) {
          parts.push(`People: ${(m.people as string[]).join(", ")}`);
        }
        if (Array.isArray(m.action_items) && m.action_items.length) {
          parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
        }
        parts.push(`\n${t.content}`);
        return parts.join("\n");
      });
      return text(`Found ${rows.length} thought(s):\n\n${lines.join("\n\n")}`);
    } catch (e) {
      return err((e as Error).message);
    }
  },
);

server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description:
      "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      limit: z.number().optional().default(10),
      type: z.string().optional()
        .describe("Filter by type: observation, task, idea, reference, person_note"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
    },
  },
  async (opts) => {
    try {
      const rows = await listThoughts(pool, opts);
      if (!rows.length) return text("No thoughts found.");
      const lines = rows.map((t, i) => {
        const m = t.metadata || {};
        const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
        return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${m.type ?? "??"}${tags ? " - " + tags : ""})\n   ${t.content}`;
      });
      return text(`${rows.length} recent thought(s):\n\n${lines.join("\n\n")}`);
    } catch (e) {
      return err((e as Error).message);
    }
  },
);

server.registerTool(
  "thought_stats",
  {
    title: "Thought Statistics",
    description: "Summary of all captured thoughts: totals, types, top topics, people.",
    annotations: { readOnlyHint: true },
    inputSchema: {},
  },
  async () => {
    try {
      const s = await getStats(pool);
      const lines: string[] = [
        `Total thoughts: ${s.count}`,
        `Date range: ${
          s.earliest && s.latest
            ? new Date(s.earliest).toLocaleDateString() +
              " -> " +
              new Date(s.latest).toLocaleDateString()
            : "N/A"
        }`,
        "",
        "Types:",
        ...s.types.map(([k, v]) => `  ${k}: ${v}`),
      ];
      if (s.topics.length) {
        lines.push("", "Top topics:");
        for (const [k, v] of s.topics) lines.push(`  ${k}: ${v}`);
      }
      if (s.people.length) {
        lines.push("", "People mentioned:");
        for (const [k, v] of s.people) lines.push(`  ${k}: ${v}`);
      }
      return text(lines.join("\n"));
    } catch (e) {
      return err((e as Error).message);
    }
  },
);

server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description:
      "Save a new thought. Generates an embedding via Ollama and (if configured) extracts metadata.",
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: { content: z.string().describe("The thought to capture") },
  },
  async ({ content }) => {
    try {
      const [embedding, metadata] = await Promise.all([
        embed(content),
        extractMetadata(content),
      ]);
      const meta = { ...metadata, source: "mcp" };
      const { id } = await captureThought(pool, { content, embedding, metadata: meta });

      const parts: string[] = [`Captured as ${meta.type ?? "thought"}`];
      if (Array.isArray(meta.topics) && meta.topics.length) {
        parts.push(`-- ${(meta.topics as string[]).join(", ")}`);
      }
      if (Array.isArray(meta.people) && meta.people.length) {
        parts.push(`| People: ${(meta.people as string[]).join(", ")}`);
      }
      if (Array.isArray(meta.action_items) && meta.action_items.length) {
        parts.push(`| Actions: ${(meta.action_items as string[]).join("; ")}`);
      }
      parts.push(`(id: ${id})`);
      return text(parts.join(" "));
    } catch (e) {
      return err((e as Error).message);
    }
  },
);

// ---------- Hono App ------------------------------------------------------

const app = new Hono();

// Public health endpoint (no auth) — used by docker healthcheck and quick
// curl-from-the-tailnet smoke tests. Does NOT touch the DB to keep it cheap.
app.get("/health", (c) => c.json({ ok: true, service: "open-brain-homelab" }));

// Deeper health probe that confirms DB connectivity. Auth-gated because the
// failure mode reveals whether the DB is reachable.
app.get("/ready", requireBrainKey, async (c) => {
  try {
    await pingDb(pool);
    return c.json({ ok: true, db: "connected" });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 503);
  }
});

// MCP transport. Auth runs first; transport is stateless per request.
app.all("/mcp", requireBrainKey, async (c) => {
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

// Backward-compat: also serve the MCP transport at the root for clients that
// don't add /mcp to the URL.
app.all("/", requireBrainKey, async (c) => {
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

console.log(`open-brain-homelab listening on :${PORT}`);
Deno.serve({ port: PORT }, app.fetch);
