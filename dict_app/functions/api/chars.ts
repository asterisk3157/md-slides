/**
 * GET /api/chars
 * → [{ "char": "あ", "count": 3 }, ...]  Unicode順
 */

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const result = await env.DB.prepare(
    "SELECT char AS char, COUNT(*) AS count FROM variants GROUP BY char ORDER BY char ASC"
  ).all<{ char: string; count: number }>();

  const rows = result.results ?? [];
  return new Response(JSON.stringify(rows), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};

/**
 * DELETE /api/chars?confirm=ALL  → 登録文字(variants)を全削除。
 * 破壊的操作のため confirm=ALL を必須にする (誤爆防止)。テーマ(settings)は残す。
 * → { "deleted": <件数> }
 */
export const onRequestDelete: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== "ALL") {
    return new Response(JSON.stringify({ error: "confirm=ALL query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM variants").first<{ n: number }>();
  await env.DB.prepare("DELETE FROM variants").run();
  return new Response(JSON.stringify({ deleted: before?.n ?? 0 }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
