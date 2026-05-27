# 辞書登録 Web アプリ (dict_app)

手書き文字バリエーションを蓄積する Web アプリ。
Cloudflare Pages + D1 で動く。バックエンドは TypeScript の Pages Functions、フロントは Vanilla HTML/JS/CSS。

## 主要画面

| URL | 説明 |
|---|---|
| `/` | 文字一覧（バリエーション数でグラデーション表示）+ 検索 |
| `/char.html?c=<char>` | 手書きパッド + バリエーション一覧 |
| `/api/export` | 辞書 JSON ダウンロード（pptx_auto 生成側の入力） |

## API

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/chars` | 文字 + バリエーション数の一覧 |
| GET | `/api/chars/:c/variants` | 該当文字のバリエーション一覧 |
| POST | `/api/chars/:c/variants` | 新規登録 (`{strokes_json:"..."}`) |
| DELETE | `/api/chars/:c/variants/:id` | バリエーション削除 |
| GET | `/api/export` | 辞書 JSON 全体（`Content-Disposition: attachment`） |

全エンドポイントは Basic 認証で保護されます。

## ローカル起動

```bash
cd /Users/hi/pptx_auto/dict_app
npm install

# ローカル開発用の認証情報（パスワード "dev"、ソルト "local"）を .dev.vars に書く
HASH=$(node -e 'const c=require("crypto");process.stdout.write(c.createHash("sha256").update("local:dev").digest("hex"))')
cat > .dev.vars <<EOF
BASIC_AUTH_SALT=local
BASIC_AUTH_USERS=dev:${HASH}
EOF

# 1回目の DB 初期化
npm run db:init

# 別ターミナルで dev サーバ起動
npm run dev
# → http://localhost:8788 で開く（Basic 認証: dev / dev）

# 初回起動後に pages dev が別 SQLite ファイルを作るので、もう一度初期化
# （初回のみ。以降は不要）
npm run db:init
```

> **注意 (Wrangler 3 のローカルD1):**
> `wrangler d1 execute --local` と `wrangler pages dev` が使う SQLite ファイルは
> 内部的に別ハッシュで保存される。
> `scripts/init-local-db.mjs` は `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`
> 配下にある全 `.sqlite` ファイルにスキーマを当てるので、
> 「dev 起動 → もう一度 `npm run db:init`」を一度やれば以降は OK。

`.dev.vars` は `.gitignore` 済み。wrangler が自動的に読み込みローカル環境変数として `env` に注入します。

### 動作確認 (curl)

```bash
# 認証なし → 401
curl -i http://localhost:8788/api/chars

# 認証あり → []
curl -u dev:dev http://localhost:8788/api/chars

# 1件登録
curl -u dev:dev -X POST http://localhost:8788/api/chars/%E3%81%82/variants \
  -H 'Content-Type: application/json' \
  -d '{"strokes_json":"{\"strokes\":[{\"points\":[[0.1,0.1],[0.9,0.9]],\"pressures\":[0.5,0.5]}],\"bbox\":[0,0,1,1],\"advance\":1.0}"}'

# エクスポート
curl -u dev:dev http://localhost:8788/api/export
```

## Cloudflare へのデプロイ

詳細は `../docs/deploy.md` を参照。要約:

```bash
cd /Users/hi/pptx_auto/dict_app
npx wrangler login

# D1 作成 → 出力された database_id を wrangler.toml に貼る
npx wrangler d1 create pptx_auto_dict
# wrangler.toml の "PLACEHOLDER_REPLACE_ON_FIRST_DEPLOY" を ↑ の id に置換

# 本番 D1 にスキーマ投入
npm run db:init:remote

# Pages プロジェクト作成（初回のみ）
npx wrangler pages project create pptx-auto-dict --production-branch main

# シークレット設定（プロンプトで値を入力）
npx wrangler pages secret put BASIC_AUTH_SALT --project-name pptx-auto-dict
npx wrangler pages secret put BASIC_AUTH_USERS --project-name pptx-auto-dict

# デプロイ
npm run deploy
```

### Basic 認証のハッシュ生成

`BASIC_AUTH_USERS` は `"user1:hash1,user2:hash2"` 形式。
ハッシュは `sha256( BASIC_AUTH_SALT + ":" + password )` の16進。

```bash
SALT="本番ソルト"
PASS="本番パスワード"
node -e "const c=require('crypto');process.stdout.write(c.createHash('sha256').update('${SALT}:${PASS}').digest('hex'))"
```

## ディレクトリ

```
dict_app/
├── functions/
│   ├── _middleware.ts                 # Basic 認証
│   └── api/
│       ├── chars.ts
│       ├── chars/[c]/variants.ts
│       ├── chars/[c]/variants/[id].ts
│       └── export.ts
├── public/                            # 静的ファイル
│   ├── index.html
│   ├── char.html
│   ├── styles.css
│   └── js/{index,char}.js
├── schema.sql
├── wrangler.toml
└── package.json
```

## データフォーマット

`POST /api/chars/:c/variants` のボディに渡す `strokes_json` の中身:

```json
{
  "strokes": [
    {
      "points":   [[x, y], ...],   // 0..1 正規化
      "pressures":[p,    ...]      // 0..1, points と同じ長さ
    }
  ],
  "bbox":   [x_min, y_min, x_max, y_max],
  "advance": 1.0
}
```

`/api/export` の戻り値は `../CLAUDE.md` の「辞書 JSON フォーマット仕様」と同形。
