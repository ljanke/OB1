FROM denoland/deno:2.3.3

WORKDIR /app

COPY deno.json ./
RUN deno install

COPY *.ts ./

# Cache and type-check at build time so first request is fast.
RUN deno cache index.ts

USER deno

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD deno eval "const r = await fetch('http://127.0.0.1:8787/health'); if (!r.ok) Deno.exit(1);"

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "index.ts"]
