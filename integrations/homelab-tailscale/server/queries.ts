// Pure SQL business logic. No HTTP concerns. A future REST gateway, CLI, or
// scheduled job can call these same functions without touching the MCP layer.

import { Pool } from "postgres";
import type { ThoughtMatch, ThoughtRecord } from "./db.ts";
import { toVectorLiteral } from "./embeddings.ts";

export type SearchOptions = {
  query: string;
  embedding: number[];
  limit?: number;
  threshold?: number;
};

export async function searchThoughts(
  pool: Pool,
  opts: SearchOptions,
): Promise<ThoughtMatch[]> {
  const { embedding, limit = 10, threshold = 0.5 } = opts;
  const embStr = toVectorLiteral(embedding);
  const client = await pool.connect();
  try {
    const result = await client.queryObject<ThoughtMatch>(
      `SELECT id, content, metadata, created_at,
              1 - (embedding <=> $1::vector) AS similarity
       FROM thoughts
       WHERE 1 - (embedding <=> $1::vector) >= $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [embStr, threshold, limit],
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export type ListOptions = {
  limit?: number;
  type?: string;
  topic?: string;
  person?: string;
  days?: number;
};

export async function listThoughts(
  pool: Pool,
  opts: ListOptions,
): Promise<ThoughtRecord[]> {
  const { limit = 10, type, topic, person, days } = opts;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  if (type) {
    conditions.push(`metadata->>'type' = $${p++}`);
    params.push(type);
  }
  if (topic) {
    conditions.push(`metadata->'topics' ? $${p++}`);
    params.push(topic);
  }
  if (person) {
    conditions.push(`metadata->'people' ? $${p++}`);
    params.push(person);
  }
  if (days && Number.isFinite(days)) {
    conditions.push(`created_at >= NOW() - ($${p++}::int * INTERVAL '1 day')`);
    params.push(Math.floor(days));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const client = await pool.connect();
  try {
    const result = await client.queryObject<ThoughtRecord>(
      `SELECT id, content, metadata, created_at, updated_at
       FROM thoughts
       ${where}
       ORDER BY created_at DESC
       LIMIT $${p}`,
      [...params, limit],
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function fetchThought(
  pool: Pool,
  id: string,
): Promise<ThoughtRecord | null> {
  const client = await pool.connect();
  try {
    const result = await client.queryObject<ThoughtRecord>(
      `SELECT id, content, metadata, created_at, updated_at
       FROM thoughts WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export type CaptureInput = {
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
};

export async function captureThought(
  pool: Pool,
  input: CaptureInput,
): Promise<{ id: string }> {
  const embStr = toVectorLiteral(input.embedding);
  const client = await pool.connect();
  try {
    const result = await client.queryObject<{ id: string }>(
      `INSERT INTO thoughts (content, embedding, metadata)
       VALUES ($1, $2::vector, $3::jsonb)
       RETURNING id`,
      [input.content, embStr, JSON.stringify(input.metadata)],
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

export type Stats = {
  count: number;
  earliest: string | null;
  latest: string | null;
  types: [string, number][];
  topics: [string, number][];
  people: [string, number][];
};

export async function getStats(pool: Pool): Promise<Stats> {
  const client = await pool.connect();
  try {
    const countRes = await client.queryObject<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM thoughts",
    );
    const dataRes = await client.queryObject<{
      metadata: Record<string, unknown>;
      created_at: string;
    }>(
      "SELECT metadata, created_at FROM thoughts ORDER BY created_at DESC",
    );

    const count = countRes.rows[0]?.count ?? 0;
    const rows = dataRes.rows;

    const types: Record<string, number> = {};
    const topics: Record<string, number> = {};
    const people: Record<string, number> = {};

    for (const r of rows) {
      const m = r.metadata || {};
      const t = m.type;
      if (typeof t === "string") types[t] = (types[t] || 0) + 1;
      if (Array.isArray(m.topics)) {
        for (const x of m.topics) {
          if (typeof x === "string") topics[x] = (topics[x] || 0) + 1;
        }
      }
      if (Array.isArray(m.people)) {
        for (const x of m.people) {
          if (typeof x === "string") people[x] = (people[x] || 0) + 1;
        }
      }
    }

    const sort = (o: Record<string, number>): [string, number][] =>
      Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10);

    return {
      count,
      earliest: rows.at(-1)?.created_at ?? null,
      latest: rows[0]?.created_at ?? null,
      types: sort(types),
      topics: sort(topics),
      people: sort(people),
    };
  } finally {
    client.release();
  }
}

export async function pingDb(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.queryObject("SELECT 1");
    return true;
  } finally {
    client.release();
  }
}
