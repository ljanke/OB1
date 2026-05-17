# Open Brain — Homelab + Tailscale

Self-hosted Open Brain on a single home box. No Supabase, no cloud, $0/month, data never leaves your network.

## What this is

Three docker-compose services on your always-on box:

- **postgres** — Postgres 16 + pgvector. Holds the `thoughts` table.
- **mcp** — The Open Brain MCP server (Deno + Hono). Talks to Postgres, embeds via Ollama, exposes MCP at `/mcp` over HTTP on `127.0.0.1:8787`. Gated by an `x-brain-key` header.
- **ollama** — Local embeddings (default model `nomic-embed-text`, 768 dim). Optional — if you already run Ollama on another tailnet box, point `OLLAMA_URL` at it and remove this service.

Tailscale on the host runs `tailscale serve` in front of the loopback MCP port, giving every device in your tailnet a real-cert HTTPS URL like `https://homebox.tailnet-name.ts.net/mcp`. Add that as a custom connector in Claude Desktop and your memory follows you across devices.

> **Trust boundary.** Anyone with `x-brain-key` plus the ability to send packets that pass Tailscale's WireGuard authentication (i.e., a tailnet member you've allowed via ACL) gets **full read/write** to your thoughts. There's no per-user RLS and no Supabase `auth.uid()`. Treat the access key like a database password and treat your tailnet ACLs as the perimeter. If you enable Tailscale Funnel, anyone on the public internet who guesses the key gets in — pick a long random key and rotate it if it ever leaves trusted hands.
>
> See the [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) for how to think about minimizing tool surface area once your stack is live.

## Architecture vs. upstream

This integration is **additive**: it lives entirely under `integrations/homelab-tailscale/` and never modifies upstream OB1 files. That keeps merge pain to ~30-60 minutes a month at most. Cribbed structurally from `integrations/kubernetes-deployment/` (which also drops Supabase) but split into smaller modules.

```
homelab-tailscale/
├── docker-compose.yml          three services
├── .env.example                copy → .env, fill in secrets
├── metadata.json               OB1 metadata
├── db/
│   ├── 00-roles.sh             creates openbrain_app + openbrain_readonly
│   └── 01-schema.sql           pgvector schema, vector(768), match_thoughts() RPC
└── server/
    ├── deno.json               deps (Hono, @hono/mcp, deno-postgres, zod)
    ├── Dockerfile              denoland/deno:2.3.3 base
    ├── config.ts               typed env-var loading
    ├── db.ts                   Postgres connection pool
    ├── embeddings.ts           Ollama /api/embed client
    ├── metadata.ts             optional chat-LLM metadata extraction
    ├── queries.ts              all SQL — pure, reusable
    ├── auth.ts                 x-brain-key middleware
    └── index.ts                Hono app + MCP tool registration
```

The `queries.ts` / `index.ts` split means a future REST gateway, CLI, or dashboard can be added in an afternoon without rewriting database code. None of that is built yet — explicitly out of scope.

## Prerequisites

- Always-on Linux box with Docker Engine + the compose plugin
- Tailscale installed on the box and on every device that should reach it
- (Recommended) An Nvidia GPU on the box for Ollama. Without it, comment out the `deploy:` block under `ollama:` in `docker-compose.yml` — embeddings will run on CPU, slower but still usable
- Claude Desktop on at least one device

## Setup

### 1. Generate secrets and copy env

```bash
cd integrations/homelab-tailscale
cp .env.example .env

# Generate strong values for each of these and paste into .env:
openssl rand -hex 24    # POSTGRES_PASSWORD
openssl rand -hex 24    # OPENBRAIN_APP_PASSWORD
openssl rand -hex 24    # OPENBRAIN_READONLY_PASSWORD
openssl rand -hex 32    # MCP_ACCESS_KEY
```

Edit `.env`. At minimum, fill in the four password fields and set `CITATION_BASE_URL` to your eventual tailnet hostname.

### 2. Pull the embedding model

If you're running Ollama in this stack, do this once to pre-warm the model so the first capture isn't slow:

```bash
docker compose up -d ollama
docker compose exec ollama ollama pull nomic-embed-text
```

If you're using an Ollama on another tailnet box, run `ollama pull nomic-embed-text` there instead and set `OLLAMA_URL=http://gpubox.tailnet-name.ts.net:11434` in `.env`.

### 3. Start everything

```bash
docker compose up -d
docker compose logs -f mcp
```

You should see `open-brain-homelab listening on :8787`. The Postgres init scripts run on first startup only; subsequent restarts skip them.

### 4. Smoke-test

```bash
# Public health endpoint (no auth, doesn't touch DB):
curl http://127.0.0.1:8787/health

# Auth-gated readiness probe (confirms DB is reachable):
curl http://127.0.0.1:8787/ready -H "x-brain-key: $MCP_ACCESS_KEY"
```

### 5. Tailscale wiring

The MCP server binds only to `127.0.0.1:8787` — the LAN cannot reach it directly. Tailnet access goes exclusively through `tailscale serve`, which terminates TLS on the tailnet IP with a Tailscale-issued cert and forwards to the loopback service. This is the architecturally clean tailnet-only stance: only WireGuard-authenticated peers in your tailnet can reach the service, and Tailscale ACLs gate which of them.

Make sure Tailscale is running on the host (`tailscale up`), then put it in front of the MCP server:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8787
```

That maps `https://<host>.<tailnet>.ts.net/` → `http://127.0.0.1:8787`. Verify from another tailnet device:

```bash
curl https://homebox.tailnet-name.ts.net/health
```

For phone / claude.ai web access (callers outside the tailnet), additionally enable Funnel — be aware this exposes the URL to the public internet, gated only by `x-brain-key`:

```bash
sudo tailscale funnel --bg 443
```

Tailscale CLI evolves; if these flags differ in your version, see [`tailscale serve`](https://tailscale.com/kb/1242/tailscale-serve) and [`tailscale funnel`](https://tailscale.com/kb/1223/funnel).

### 6. Connect Claude Desktop

Settings → Connectors → Add custom connector:

- **URL**: `https://homebox.tailnet-name.ts.net/mcp`
- **Headers**: `x-brain-key: <the value you set in .env>`

Open a chat, click the connector inspector, you should see tools: `capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`, `search`, `fetch`. Test by saying "remember that I set up Open Brain on the homelab today."

### 7. Direct DB inspection

For DBeaver, TablePlus, psql, or DataGrip, connect with the read-only role:

- Host: `homebox.tailnet-name.ts.net` (or `127.0.0.1` if you set `127.0.0.1:5432:5432` in compose)
- Database: `openbrain`
- User: `openbrain_readonly`
- Password: from `.env`

The role can `SELECT` from any table but nothing else. Safe for casual inspection without risking your data.

## Verification checklist

1. `docker compose ps` — all three services `running`, postgres `(healthy)`, mcp `(healthy)` after the start-period.
2. `docker compose logs postgres` — init scripts ran without errors.
3. `psql 'postgresql://openbrain_readonly:PASS@127.0.0.1/openbrain' -c 'SELECT count(*) FROM thoughts'` returns `0`.
4. `psql 'postgresql://openbrain_readonly:PASS@127.0.0.1/openbrain' -c "INSERT INTO thoughts (content) VALUES ('test')"` is rejected (`permission denied`).
5. `curl http://127.0.0.1:8787/health` returns `{"ok":true,...}` (from the host).
6. From another tailnet device, after `tailscale serve` is up: `curl https://homebox.tailnet-name.ts.net/ready -H "x-brain-key: $KEY"` returns `{"ok":true,"db":"connected"}`.
7. From the LAN (not on tailnet), `curl http://<lan-ip>:8787/health` should **fail** — port isn't bound to that interface. This confirms the loopback-only stance.
8. In Claude Desktop with the connector added: ask "remember that the homelab Open Brain works." Confirm it returns "Captured as ..."
9. `psql ... -c 'SELECT id, vector_dims(embedding) FROM thoughts'` shows `768` (or whatever `EMBED_DIM` you chose).
10. Ask Claude "what have I captured about the homelab?" — confirm semantic search returns the thought from step 8.
11. Capture the *same* text a second time. `SELECT count(*) FROM thoughts WHERE content = '<text>'` still returns 1 — dedupe via `content_fingerprint` is in effect.
12. `docker compose restart` — thoughts are still there after the restart.

## Common gotchas

- **Embedding dimension mismatch.** If `EMBED_DIM` in `.env` doesn't match what your model actually returns, every `capture_thought` will fail with a clear error from `embeddings.ts`. Fix: change `EMBED_DIM` (and the `vector(N)` in `01-schema.sql` if you've already initialized the DB) to match your model.
- **Schema didn't run.** Postgres only runs `/docker-entrypoint-initdb.d/*` when the data dir is empty. If you change the schema after first start, you need to either apply it manually with `psql` or `docker compose down -v` to wipe the volume (destroys all thoughts).
- **No GPU detected for Ollama.** Either install the NVIDIA Container Toolkit on the host or remove the `deploy: resources:` block from the `ollama` service in `docker-compose.yml`. CPU-only Ollama is fine for nomic-embed-text — slower per request but still sub-second.
- **Tailscale Funnel disabled.** Funnel must be enabled per-device in your Tailscale admin console (Access Controls). Without it, claude.ai web and Claude mobile (which fetch MCP server-side via Anthropic's backend) can't reach the URL. Tailscale-only (no Funnel) works for Claude Desktop on tailnet devices.
- **Metadata extraction silently degrading.** If `CHAT_API_BASE`/`CHAT_MODEL` are unset (or unreachable), `capture_thought` still works — but every thought gets `{topics: [uncategorized], type: observation}`. To enable real extraction, point at a chat-capable Ollama model or any OpenAI-compatible endpoint.

## Backups

This is your memory. Back it up.

```bash
# Daily, via cron:
docker compose exec -T postgres pg_dump -U postgres openbrain | gzip > /backups/openbrain-$(date +%Y%m%d).sql.gz

# Restore:
gunzip -c /backups/openbrain-20260503.sql.gz | docker compose exec -T postgres psql -U postgres openbrain
```

If you switch embedding models later, embeddings from the old model are mathematically incompatible with the new one — you'll need to re-embed all rows. For nomic-embed-text → mxbai-embed-large that's a one-time batch job; for OpenAI → local it requires regenerating from the original `content` text.

## Why this isn't upstream

The upstream OB1 mandate is "MCP servers must be remote (Supabase Edge Functions)." This integration is technically remote (HTTP over Tailscale) but doesn't fit the spirit (zero-ops, paste-a-URL UX). It's published as a personal-use integration under FSL-1.1-MIT.

## Upstream sync strategy

Monthly: `git fetch upstream && git log upstream/main..HEAD --oneline -- server/ schemas/`. Most upstream changes are additive (new schemas, new recipes) and merge cleanly because nothing in this directory touches upstream files. The one file worth watching is `server/index.ts` — when upstream adds a new MCP tool you want, port it manually into `server/queries.ts` + `server/index.ts` here. Historical pace: ~1 such commit per month.
