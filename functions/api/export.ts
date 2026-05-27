/**
 * GET /api/export
 *
 * 戻り値: CLAUDE.md「辞書JSONフォーマット仕様」と同形式の dict.json
 * {
 *   "version": "1",
 *   "exported_at": "ISO8601",
 *   "characters": {
 *     "あ": {
 *       "variants": [
 *         { "id": "v1", "strokes": [...], "bbox": [...], "advance": 1.0,
 *           "registered_at": "...", "registered_by": "..." }
 *       ]
 *     }
 *   }
 * }
 */

interface Env {
  DB: D1Database;
}

interface Row {
  id: number;
  char: string;
  strokes_json: string;
  registered_at: string;
  registered_by: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const res = await env.DB.prepare(
    "SELECT id, char, strokes_json, registered_at, registered_by FROM variants ORDER BY char ASC, id ASC"
  ).all<Row>();

  const rows = res.results ?? [];
  const characters: Record<string, { variants: unknown[] }> = {};

  for (const r of rows) {
    let payload: { strokes?: unknown; bbox?: unknown; advance?: unknown; anchors?: unknown };
    try {
      payload = JSON.parse(r.strokes_json);
    } catch {
      payload = { strokes: [] };
    }

    const variant: Record<string, unknown> = {
      id: `v${r.id}`,
      strokes: payload.strokes ?? [],
      bbox: payload.bbox ?? [0, 0, 1, 1],
      advance: typeof payload.advance === "number" ? payload.advance : 1.0,
      registered_at: r.registered_at,
      registered_by: r.registered_by,
    };
    if (Array.isArray(payload.anchors) && payload.anchors.length > 0) {
      variant.anchors = payload.anchors;
    }
    const cs = (payload as { coord_space?: unknown }).coord_space;
    if (typeof cs === "string" && cs !== "bbox") {
      variant.coord_space = cs;
    }

    if (!characters[r.char]) characters[r.char] = { variants: [] };
    characters[r.char].variants.push(variant);
  }

  // テーマ (装飾styles・配置metrics) を相乗りさせる
  let theme: unknown = {};
  try {
    const trow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'theme'")
      .first<{ value: string }>();
    if (trow && trow.value) theme = JSON.parse(trow.value);
  } catch {
    theme = {};
  }

  const body = {
    version: "1",
    exported_at: new Date().toISOString(),
    characters,
    theme,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="dict.json"',
    },
  });
};
