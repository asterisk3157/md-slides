/**
 * GET  /api/chars/:c/variants  → 一覧
 * POST /api/chars/:c/variants  → { strokes_json } を登録、{ id } を返却
 */

interface Env {
  DB: D1Database;
}

interface Variant {
  id: number;
  strokes_json: string;
  registered_at: string;
  registered_by: string | null;
}

function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// :c は Unicodeコードポイントの16進。例: "2e" → "."。
// 複数文字 (関数名 "sin" 等の単語グリフ) は '-' 連結: "73-69-6e" → "sin"。
function decodeCharParam(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const cps: number[] = [];
  for (const p of s.split("-")) {
    if (!/^[0-9a-fA-F]{1,6}$/.test(p)) return null;
    const cp = parseInt(p, 16);
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return null;
    cps.push(cp);
  }
  try {
    return String.fromCodePoint(...cps);
  } catch {
    return null;
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const c = decodeCharParam(params.c);
  if (!c) return badRequest("char id must be Unicode codepoint hex (e.g. '2e' for '.')");

  const result = await env.DB.prepare(
    "SELECT id, strokes_json, registered_at, registered_by FROM variants WHERE char = ?1 ORDER BY id ASC"
  )
    .bind(c)
    .all<Variant>();

  return new Response(JSON.stringify(result.results ?? []), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request, params, data }) => {
  const c = decodeCharParam(params.c);
  if (!c) return badRequest("char id must be Unicode codepoint hex (e.g. '2e' for '.')");

  let body: { strokes_json?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const strokesJson = body?.strokes_json;
  if (typeof strokesJson !== "string" || strokesJson.length === 0) {
    return badRequest("strokes_json (string) is required");
  }

  // バリデーション: strokes_json は有効なJSONで {strokes:[...]} を持つこと
  let parsed: unknown;
  try {
    parsed = JSON.parse(strokesJson);
  } catch {
    return badRequest("strokes_json is not valid JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { strokes?: unknown }).strokes)
  ) {
    return badRequest("strokes_json must contain a 'strokes' array");
  }

  const username = (data as Record<string, unknown>).username as string | undefined;

  const insert = await env.DB.prepare(
    "INSERT INTO variants (char, strokes_json, registered_by) VALUES (?1, ?2, ?3) RETURNING id"
  )
    .bind(c, strokesJson, username ?? null)
    .first<{ id: number }>();

  return new Response(JSON.stringify({ id: insert?.id ?? null }), {
    status: 201,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};

/**
 * DELETE /api/chars/:c/variants  → その文字の全バリエーションを削除 (再登録用)。
 * → { "deleted": <件数> }
 */
export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const c = decodeCharParam(params.c);
  if (!c) return badRequest("char id must be Unicode codepoint hex (e.g. '2e' for '.')");

  const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM variants WHERE char = ?1")
    .bind(c)
    .first<{ n: number }>();
  await env.DB.prepare("DELETE FROM variants WHERE char = ?1").bind(c).run();

  return new Response(JSON.stringify({ deleted: before?.n ?? 0 }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
