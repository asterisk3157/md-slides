/**
 * DELETE /api/chars/:c/variants/:id  → 204
 */

interface Env {
  DB: D1Database;
}

// :c は Unicodeコードポイントの16進。複数文字は '-' 連結 ("73-69-6e" → "sin")。
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

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const c = decodeCharParam(params.c);
  const idStr = String(params.id ?? "");
  const id = Number.parseInt(idStr, 10);

  if (!c || !Number.isFinite(id) || id <= 0) {
    return new Response(JSON.stringify({ error: "invalid parameters" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  await env.DB.prepare("DELETE FROM variants WHERE id = ?1 AND char = ?2")
    .bind(id, c)
    .run();

  return new Response(null, { status: 204 });
};
