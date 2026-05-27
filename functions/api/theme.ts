/**
 * GET  /api/theme  → 現在のテーマ JSON を返す (未設定なら {})
 * PUT  /api/theme  → テーマ JSON を保存 (upsert)
 *
 * テーマ形式:
 *   {
 *     "styles":  { "key": {"color":"red","bold":true}, ... },   // 装飾クラス
 *     "metrics": { "char_metrics": {...}, "anchor_nudge": {...} } // 配置ルール上書き
 *   }
 *
 * 全ユーザー共通の1レコード (settings.key='theme')。
 */

interface Env {
  DB: D1Database;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'theme'")
    .first<{ value: string }>();
  if (!row || !row.value) return json({});
  try {
    return json(JSON.parse(row.value));
  } catch {
    return json({});
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ env, request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return json({ error: "theme must be an object" }, 400);
  }
  const value = JSON.stringify(body);
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('theme', ?1, datetime('now')) " +
    "ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = datetime('now')"
  ).bind(value).run();
  return json({ ok: true });
};
