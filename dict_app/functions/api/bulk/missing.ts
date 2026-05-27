/**
 * GET /api/bulk/missing?chars=<urlencoded>&target=3
 *
 * クエリ:
 *   chars  : URLエンコードされた文字列。各 1文字（Unicodeコードポイント）を対象とする
 *   target : 目標バリエーション数（既定: 3）
 *
 * レスポンス:
 *   { "missing": ["え", "お", ...] }  // count(*) < target の文字のみを入力順で返す
 */

interface Env {
  DB: D1Database;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const charsRaw = url.searchParams.get("chars") ?? "";
  // words: カンマ区切りの単語トークン (関数名 "sin","cos" 等の単語グリフ用)
  const wordsRaw = url.searchParams.get("words") ?? "";
  const targetRaw = url.searchParams.get("target") ?? "3";
  const target = Math.max(1, Number.parseInt(targetRaw, 10) || 3);

  if (!charsRaw && !wordsRaw) {
    return jsonResponse({ error: "chars or words query is required" }, 400);
  }

  // ユニーク化しつつ入力順を保持。chars は 1文字単位、words は単語単位。
  const seen = new Set<string>();
  const unique: string[] = [];
  const push = (t: string) => {
    if (!t || seen.has(t)) return;
    seen.add(t);
    unique.push(t);
  };
  for (const ch of charsRaw) push(ch);
  for (const w of wordsRaw.split(",")) push(w.trim());

  if (unique.length === 0) {
    return jsonResponse({ missing: [] });
  }

  // D1 は 1クエリあたりのbindパラメータ上限が 100。多数の文字でも 500 にならないよう
  // 90件ずつにバッチ分割して IN クエリを複数回投げ、count をマージする。
  const BATCH = 90;
  const countMap = new Map<string, number>();
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const placeholders = batch.map((_, j) => `?${j + 1}`).join(",");
    const sql = `SELECT char AS char, COUNT(*) AS count FROM variants WHERE char IN (${placeholders}) GROUP BY char`;
    const res = await env.DB.prepare(sql).bind(...batch).all<{ char: string; count: number }>();
    for (const r of (res.results ?? [])) countMap.set(r.char, Number(r.count) || 0);
  }

  const missing = unique.filter((ch) => (countMap.get(ch) ?? 0) < target);

  return jsonResponse({ missing });
};
