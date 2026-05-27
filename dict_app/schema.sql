-- D1 schema for dict_app
-- 手書き文字バリエーション辞書

CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  char TEXT NOT NULL,
  strokes_json TEXT NOT NULL,   -- {"strokes":[{"points":[[x,y],...],"pressures":[...]}], "bbox":[x_min,y_min,x_max,y_max], "advance":1.0}
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  registered_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_variants_char ON variants(char);

-- アプリ設定 (テーマ等)。key='theme' に装飾styles・配置metricsのJSONを保存。
-- 例: {"styles":{"key":{"color":"red","bold":true}}, "metrics":{"char_metrics":{...}}}
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
