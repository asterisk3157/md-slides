# pptx_auto — 手書き風スライド自動生成ツール

## プロジェクトの目的

タイプした文字を **本人の手書き筆跡** として PowerPoint スライドに再現し、
お手本pptxと同じ「書き順に沿って文字が現れる」アニメーションを自動生成する。

最終目標は「手書き風解説スライドを全自動で作成できるツール／Skill」。

## アーキテクチャ

```
pptx_auto/
├── AGENTS.md                         # このファイル
├── samples/
│   └── 20260421_第8回_接線の本数.pptx   # 解析対象のお手本pptx
├── analysis/                         # お手本の解析結果（リファレンス）
│
├── handwriting_pptx/                 # ★スライド生成ライブラリ (Python)
│   ├── api.py                        # 公開API (Presentation, Slide, ...)
│   ├── dict_loader.py                # 辞書JSON読み込み
│   ├── stroke.py                     # Stroke/Glyph データクラス
│   ├── inkml.py                      # InkML XML 生成
│   ├── slide_xml.py                  # スライドXML (contentPart + Fallback)
│   ├── timing.py                     # アニメーション (clickEffect + drawProgress)
│   ├── layout.py                     # 5ブロック自動配置
│   ├── builder.py                    # .pptx パッケージング
│   └── units.py                      # EMU/cm/InkML単位変換
│
├── dict_app/                         # ★辞書登録 Web アプリ
│   ├── functions/                    # Cloudflare Pages Functions (TypeScript)
│   │   ├── _middleware.ts            #   Basic 認証
│   │   └── api/
│   │       ├── chars.ts              #   GET /api/chars  文字一覧
│   │       ├── chars/[c]/
│   │       │   ├── variants.ts       #   GET/POST /api/chars/:c/variants
│   │       │   └── variants/[id].ts  #   DELETE /api/chars/:c/variants/:id
│   │       ├── bulk/
│   │       │   └── missing.ts        #   GET /api/bulk/missing  未達成文字
│   │       └── export.ts             #   GET /api/export  辞書JSON
│   ├── public/                       # 静的HTML/JS/CSS
│   │   ├── index.html                #   文字一覧（グラデーション + モーダル）
│   │   ├── char.html                 #   バリエーション+手書きパッド
│   │   ├── bulk.html                 #   連続登録モード本体
│   │   └── js/
│   │       ├── stroke_pad.js         #   共通 Canvas 手書きパッド (StrokePadクラス)
│   │       ├── presets.js            #   プリセット文字セット定義
│   │       ├── index.js / char.js / bulk.js
│   ├── schema.sql                    # D1 スキーマ
│   ├── wrangler.toml                 # Cloudflare 設定
│   └── package.json
│
├── data/
│   └── dict.json                     # エクスポート済み辞書 (生成MVPの入力)
├── docs/
│   └── deploy.md                     # Cloudflare デプロイ手順
├── examples/
│   └── quickstart.py                 # 使い方サンプル
└── tests/
```

## データ調達方針

| 案 | 採否 | 備考 |
|---|---|---|
| **A: お手本から抽出して辞書化** | 採用（後回し） | 553ストロークあるが「どのインクが何の文字か」のラベル付けが必要 |
| **B: 自前ハードコード** | 不採用 | 文字数限定すぎる |
| **C: TTF + ワイプで妥協** | フォールバック | 辞書未登録文字に対するハイブリッド代替（次フェーズ） |
| **E: 漢字手書き登録ツール** | 採用（本筋） | 本人の筆跡を Web 手書きパッドで登録 → 辞書化 → 生成に投入 |

**戦略**: 登録ツールでまず手書きデータを蓄積し、生成側はその辞書を引いて使う。
不足文字は登録を促す（MVPでは警告 + プレースホルダ、後でTTFフォールバック）。

## 辞書JSONフォーマット仕様

```json
{
  "version": "1",
  "exported_at": "2026-05-18T03:00:00Z",
  "characters": {
    "∫": {
      "variants": [
        {
          "id": "v1",
          "strokes": [
            {
              "points": [[x1, y1], [x2, y2], ...],   // 0..1 正規化座標
              "pressures": [p1, p2, ...]              // 0..1, points と同じ長さ。省略可
            }
          ],
          "bbox": [x_min, y_min, x_max, y_max],      // 0..1 正規化
          "advance": 1.0,                             // 横送り（全角=1.0, 半角=0.5）
          "anchors": [                                // 任意。数式組版用の意味的位置
            { "type": "sub",  "x": 0.7, "y": 0.95 }, // 下添字（積分下限・Σ始点等）
            { "type": "sup",  "x": 0.3, "y": 0.05 }, // 上添字（積分上限・Σ上限等）
            { "type": "body", "x": 1.0, "y": 0.5 }   // 本体（被積分関数等）の開始位置
          ],
          "registered_at": "2026-05-18T02:50:00Z",
          "registered_by": "user_name"               // Basic認証ユーザー名
        }
      ]
    }
  }
}
```

- 正規化座標系: 文字バウンディングボックスを `[0,1] × [0,1]` に正規化
- 配置時に `font_size_cm` で実寸スケール、`(x_origin, y_origin)` で位置決め
- `pressures` は省略可。あれば InkML の `F` チャネルに反映、なければ一定値（例: 16384）
- `anchors` は任意。数式描画時に ∫_a^b f(x)dx のような構造を組み立てるために使用

## アニメーション仕様（お手本準拠）

各文字（または各ストローク群）を `<p:contentPart>` で配置し、以下のタイミングを与える：

```xml
<p:par>
  <p:cTn id="N" presetID="63" presetClass="entr" presetSubtype="0"
         fill="hold" nodeType="clickEffect">
    <p:stCondLst><p:cond delay="0"/></p:stCondLst>
    <p:childTnLst>
      <p:set>...style.visibility = visible...</p:set>
      <p:anim>drawProgress 0→1 over 1000ms</p:anim>
    </p:childTnLst>
  </p:cTn>
</p:par>
```

- `presetID="63"` = PowerPoint の「リプレイ／手書き再生」効果
- `clickEffect` で1ブロックごとにクリック前進
- 5ブロック → 5回クリックで完成

## 5ブロックレイアウト（暫定）

```
16:9 スライド (33.867 × 19.05 cm)
┌────────────────────────────────────────┐
│  見出し  x=1.5, y=1.0, h=1.8cm        │
│                                        │
│  ・ 箇条1  x=2.0, y=4.0, h=1.0cm      │
│  ・ 箇条2  x=2.0, y=6.0, h=1.0cm      │
│  ・ 箇条3  x=2.0, y=8.0, h=1.0cm      │
│  ・ 箇条4  x=2.0, y=10.0, h=1.0cm     │
└────────────────────────────────────────┘
```

行頭マーク `・` は手書きで描画（1ストロークの黒点）。

## 単位系

| 系 | 用途 | 換算 |
|---|---|---|
| **cm** | ユーザーAPI / 寸法指定 | 基準 |
| **EMU** (English Metric Unit) | PowerPoint XMLの `<a:off>`, `<a:ext>` | 1cm = 360,000 EMU |
| **InkML単位** | InkML の trace 座標 | 1cm = 1,000 単位（resolution=1000） |

## 技術スタック

| レイヤ | 技術 | 理由 |
|---|---|---|
| スライド生成 | Python 3.9+ / lxml / Pillow | XML生成、フォールバックPNG生成 |
| 辞書アプリ バックエンド | Cloudflare Pages Functions (TypeScript) | D1直結、サーバーレス |
| 辞書アプリ DB | Cloudflare D1 (SQLite) | 無料枠5GB、構造クエリしやすい |
| 辞書アプリ フロント | Vanilla HTML/JS/CSS | ビルド不要、Canvas + Pointer Events |
| 認証 | HTTP Basic Auth | シンプル、複数ユーザー対応 |
| ローカル開発 | `npx wrangler pages dev` | wranglerはローカルプロジェクトから実行 |

## D1スキーマ

```sql
CREATE TABLE variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  char TEXT NOT NULL,          -- 1文字 (Unicode)
  strokes_json TEXT NOT NULL,  -- 上の辞書JSONの "strokes" を直シリアライズ
  bbox_json TEXT NOT NULL,
  advance REAL NOT NULL DEFAULT 1.0,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  registered_by TEXT
);
CREATE INDEX idx_variants_char ON variants(char);

CREATE TABLE auth_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL  -- bcrypt または SHA256+salt
);
```

## 開発・実装の進行ルール

- このプロジェクトは個人開発で `.Codex/` ローカル運用、未だ git init していない
- Bash の中で `cd` は最小限、絶対パス利用
- 外部 GitHub からの DL は禁止（ユーザー指示）
- 外部 npm パッケージは原則 npm レジストリ経由のみ（DB除外）
- 日本語でやり取りする
- **デプロイは基本しない／ローカルでテストする方針**：公開版(`pptx-auto-dict.pages.dev` / カスタムドメイン)は実ユーザーがテスト中のため、開発中の変更は `npx wrangler pages dev` 等のローカルで検証する。`npm run deploy` はユーザーが明示的に指示したときだけ実行（変更はローカルに溜めておく）。

## 実装済み

### Phase 1 — MVP
1. ✅ AGENTS.md（このファイル）
2. ✅ スライド生成ライブラリ (`handwriting_pptx/`)
3. ✅ 辞書登録Webアプリ (`dict_app/`)
4. ✅ 連続登録モード (`bulk.html`) — プリセット文字セット + 自動進行
5. ✅ 統合テスト: Web → dict.json → pptx 一気通貫
6. ✅ デプロイ手順書 (`docs/deploy.md`) / 連続登録仕様書 (`docs/bulk_register_spec.md`)

### Phase 2〜4 — パイプライン・数式・記法
- ✅ 複数スライド
- ✅ MD パイプライン (`audit`/`generate` CLI, `docs/md_spec.md`)
- ✅ 数式エンジン: べき/添字, `\frac`, `\sqrt[n]`, `\int`/`\sum`(canvas+anchor), ギリシャ/演算子
- ✅ ベクトル `\vec`（`docs/future_vectors.md`）
- ✅ √ 上線自動延長（`docs/future_root_extension.md`）
- ✅ 関数 `\sin\cos\tan\log\ln\lim`（合成。手書き単一グリフ化は下記Bで進行中）
- ✅ 太字 `**…**`（1 ink 内に通常/太字ブラシ、同クリック同時アニメ）
- ✅ 不足文字の QR 警告画面 (`warning_page.py`) ＋ ローカル Web サーバー (`server.py`)

## 進行中の方針（詳細は `docs/design_decisions.md`）

設計の確定事項は **`docs/design_decisions.md`** に集約。要点:
- 入力は **`.md` スーパーセット**、装飾は **インライン HTML スパン**＋**意味ロール class**
- **意味属性→記法 / 空間属性→UI** の線引き
- 真実 = **`.md`（内容＋色）＋ overrides（空間）**、UI は同じ記法を書き戻す
- テーマ(styles)は **D1 保存・`/api/export` 相乗り・3層マージ**
- WYSIWYG のため **配置ロジックを JS 移植＋配置ルールをデータ化**

### 推奨実装順（残タスク）
1. ✅ ④ 配置ルールの辞書データ化（`metrics.py`）
2. ✅ 構造バグ修正（太字引き伸ばし／関数引数の自動縮小撤廃／インク幅advance 等）
3. ✅ ② Python 製 SVG プレビュー（`svg_preview.py`＋`/preview`）
4. ✅ JS レンダラ移植（フル移植・node でPython座標一致を検証済 / `dict_app/public/js/render/`）
5. ✅ **pptx組み立てのJS化**（`pptxbuild.js`＋自作`zip.js`＋`skeleton.json`）
   — 生成した動的パートが Python pptx と **byte完全一致**を検証。`/preview` に pptxダウンロード統合
   — **案A達成: MD→プレビュー→pptx をブラウザ完結（Cloudflare無料・ローカルPython不要）**
6. ✅ ③ マウス編集エディタ＋overrides（`/preview` でブロック選択→ドラッグ移動/角ハンドルでリサイズ）
   — `overrides.js`(空間適用) ＋ frontmatter `overrides:` 永続化。プレビュー・pptx両方に同一適用
   — 現状はブロック単位の移動/リサイズ(空間オーバーライド)。色はMD `<span class>` 記法で対応済
7. ✅ ① Cloudflare Access 認証＋テーマ D1 保存（`/api/theme`・export相乗り・3層マージ）
- ✅ B: 関数手書き登録（`decodeCharParam`多文字対応＋guide＋preset。iPad実機テスト待ち）
- ✅ D: コンテンツ記法拡張（**表(増減表)**・ブロック数式 `$$…$$`・可変bullet・多段見出し・段落・コメント）
  — `layout_flow`（縦フロー＋自動縮小）、`Table/BlockMath/SubHeading/Paragraph` コンテンツモデル
- ✅ 数式サブ要素の個別編集（分子/分母/上限/下限/本体を文字編集モードで個別移動。`formula.js` parts ＋ `layout.js` 要素化）
- ✅ エクスポート潰れ修正（override後にブロックbbox再計算 → contentPart `<a:ext>` がink実寸と一致）
- ✅ E: MDアップロード導線（`/preview` 統合）— renderer が `missingChars`(=□文字)/`missingWords`(=未登録関数名) を返す → 未登録バー＋ドロップ時に**全画面QR**(`/bulk?custom=…&words=…`) → iPad登録 → 「登録完了」で `/api/export` 再取得・再チェック。QRは自己完結生成器 `js/qr.js`（外部依存なし・RS/round-trip検証済）
- ✅ スライド分割を `#`(H1)見出しでも実施（`---`不要・併用可）
- ✅ アンカー位置上書き `anchor_pos`（metrics層）— ∫ の上限/下限が登録時に上下逆だったのをデータで修正（下限=下左 / 上限=上右）
- ✅ 増減表(2回微分)用カーブ矢印 `\incurveup \incurvedown \decurveup \decurvedown`（手続き描画・登録不要・Python/JS byte一致）
- ✅ color を CSS準拠に拡張（`theme.py`/`theme.js`：147 CSS色名＋`#rgb`/`#rrggbb`/`rgb()`。PALETTE優先。Python↔JS一致）
- ✅ 編集UI改善：要素の当たり判定を矩形化（`ehit` 余白+最小12px、インククリックでも選択）→ 太字/分数の分子分母も掴める。スナップ配置トグル（0.5cmグリッド・Altで一時解除）
- ✅ ブランド化：プロダクト名 **Tegaki Slides**＋ロゴ `logo.svg`（md→pptx）。ルート `/`=ランディング（概要＋「使ってみる」→`/preview`）、辞書一覧は `/chars` へ移設。全ページ共通ヘッダー（ロゴ＋ナビ 作成/文字辞書）。絵文字を除去
- ✅ `/preview` 下部に **LLM向け記法ルール**（コピペ用 textarea＋コピーボタン。`String.raw` でLaTeX保持）
- ✅ サンプルを機能ショーケース化 `examples/demo_slides.md`（8スライド・全記法網羅／授業内容ではなく表現紹介・byte一致検証済）
- 🚧 **em座標方式**（`coord_space:"em"`）— 登録マスの基準線(cap/x-height/baseline/descender)基準で描いた占有比率・位置をそのまま反映。char_metrics不使用で大文字小文字/記号/小書き仮名の大小が自動。bbox既存字と**併存**（後方互換・段階移行）。実装: 描画 `layout.js/py`+`formula.js/py`、登録 `stroke_pad.js`(基準線グリッド+em出力)+`char.js/bulk.js`(通常字で有効化)。Python↔JS配置一致を合成glyphで検証。**既存262字はbboxのまま→順次em再登録で恩恵**

### 記号登録プリセット（要 iPad 登録）
矢印 → ← ↗ ↘ ↖ ↙ ⇒ ⇔ ／ 省略・範囲 ⋯ … ∞ 〜 ≡ ∝ ／ 論理・証明 ∴ ∵ □ ∎ ／ 関数 sin cos tan log ln lim

### さらに将来
- お手本pptxからの自動抽出 + 半自動ラベル付け（553ストロークの文字化）
- TTFフォールバック / 画像埋め込み / 文字単位 clickEffect / Skill化
