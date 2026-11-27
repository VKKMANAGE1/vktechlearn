/**
 * vktechlearn views API — global per-post view counter.
 *
 * POST /api/view          {slug}          -> increment and return the new count
 * GET  /api/top?limit=12                  -> most viewed posts
 * GET  /api/counts?slugs=a,b,c            -> counts for the given slugs
 * GET  /api/health                        -> readiness probe
 *
 * Storage: Cloudflare D1 (binding DB). The schema is created on first use so a
 * fresh environment needs no manual migration step.
 */

const ALLOWED_ORIGINS = [
  "https://vktechlearn.site",
  "https://www.vktechlearn.site",
  "https://vktechlearn.freebuff.page",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8080",
];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,120}$/;

let schemaReady = false;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS post_views (slug TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)"
  ).run();
  schemaReady = true;
}

async function increment(env, slug) {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    "INSERT INTO post_views (slug, views, updated_at) VALUES (?, 1, ?) " +
      "ON CONFLICT(slug) DO UPDATE SET views = views + 1, updated_at = excluded.updated_at " +
      "RETURNING views"
  )
    .bind(slug, now)
    .first();
  return row && row.views ? row.views : 1;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!env.DB) {
      return json({ error: "database binding DB is missing" }, 503, cors);
    }

    try {
      await ensureSchema(env);

      if (request.method === "GET" && url.pathname === "/api/health") {
        const row = await env.DB.prepare("SELECT COUNT(*) AS posts FROM post_views").first();
        return json({ ok: true, posts: (row && row.posts) || 0 }, 200, cors);
      }

      if (request.method === "GET" && url.pathname === "/api/top") {
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "12", 10) || 12, 1), 50);
        const { results } = await env.DB.prepare(
          "SELECT slug, views FROM post_views WHERE views > 0 ORDER BY views DESC, updated_at DESC LIMIT ?"
        )
          .bind(limit)
          .all();
        return json({ items: results || [] }, 200, cors);
      }

      if (request.method === "GET" && url.pathname === "/api/counts") {
        const slugs = (url.searchParams.get("slugs") || "")
          .split(",")
          .map((value) => value.trim())
          .filter((value) => SLUG_PATTERN.test(value))
          .slice(0, 50);
        if (!slugs.length) return json({ items: [] }, 200, cors);
        const placeholders = slugs.map(() => "?").join(",");
        const { results } = await env.DB.prepare(
          `SELECT slug, views FROM post_views WHERE slug IN (${placeholders})`
        )
          .bind(...slugs)
          .all();
        return json({ items: results || [] }, 200, cors);
      }

      if (request.method === "POST" && url.pathname === "/api/view") {
        let slug = "";
        try {
          const body = await request.json();
          slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
        } catch (error) {
          return json({ error: "invalid json body" }, 400, cors);
        }
        if (!SLUG_PATTERN.test(slug)) return json({ error: "invalid slug" }, 400, cors);
        const views = await increment(env, slug);
        return json({ ok: true, slug, views }, 200, cors);
      }

      return json({ error: "not found" }, 404, cors);
    } catch (error) {
      return json({ error: "server error", detail: String(error && error.message ? error.message : error) }, 500, cors);
    }
  },
};
