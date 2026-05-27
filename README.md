# pptx_auto

手書き風の解説スライド（.pptx）を自動生成するツール。
タイプした文字を本人の手書き筆跡として再現し、書き順アニメーションで現れるスライドを作る。

## 全体像

```
┌─────────────────────────┐         ┌──────────────────────────┐
│  辞書登録 Web アプリ      │         │  スライド生成ライブラリ    │
│  (Cloudflare Pages)     │         │  (Python)                │
│                         │         │                          │
│  手書きで字を登録 → DB    │ ──┐  ┌─▶│  辞書JSON を引いて        │
│  バリエーション数の濃淡 │   │  │   │  .pptx を生成             │
│  でカバレッジを可視化   │   │  │   │  書き順アニメ付き         │
│  Basic認証で限定公開    │   │  │   │                          │
└─────────────────────────┘   │  │   └──────────────────────────┘
                              ▼  │
                          辞書 JSON
                       (data/dict.json)
                              │  ▲
                              └──┘
                          エクスポート
```

## ディレクトリ

| パス | 役割 |
|---|---|
| `CLAUDE.md` | プロジェクト仕様書（実装の指針） |
| `samples/` | 解析対象のお手本pptx |
| `analysis/` | お手本の解析結果（リファレンス） |
| `handwriting_pptx/` | スライド生成 Python ライブラリ |
| `dict_app/` | 辞書登録 Web アプリ（Cloudflare Pages） |
| `data/dict.json` | エクスポートした辞書（生成側の入力） |
| `docs/` | デプロイ・運用手順 |
| `examples/` | 使い方サンプル |
| `tests/` | ユニット・統合テスト |

## クイックスタート

### 1. 辞書登録アプリをローカル起動して数文字登録
```bash
cd dict_app
npm install
npm run db:init
BASIC_AUTH_USERS="dev:dev" BASIC_AUTH_SALT="local" npm run dev
# http://localhost:8788 を開いて手書き登録
```

詳細: [dict_app/README.md](dict_app/README.md)

### 2. 辞書をエクスポート
```bash
curl -u dev:dev http://localhost:8788/api/export > data/dict.json
```

### 3. スライド生成
```bash
python3 examples/quickstart.py
# → out.pptx が PowerPoint で開けて、クリックすると手書きアニメ
```

詳細: [handwriting_pptx/](handwriting_pptx/) と [examples/quickstart.py](examples/quickstart.py)

### 4. 本番デプロイ（複数人で使う場合）
[docs/deploy.md](docs/deploy.md) を参照。

## 技術スタック

| レイヤ | 技術 |
|---|---|
| 辞書アプリ | Cloudflare Pages + Pages Functions (TypeScript) + D1 (SQLite) |
| 辞書アプリ フロント | Vanilla HTML/JS/CSS + Canvas Pointer Events |
| 認証 | HTTP Basic Auth |
| 生成ライブラリ | Python 3.9+ / lxml / Pillow |

## ライセンス / 注意

- 個人プロジェクト、現時点で git init 前
- 外部 GitHub からのデータDLは禁止（自家製で完結）
- 日本語でやり取り
