# デプロイ・運用手順

このプロジェクトは2つのコンポーネントを連携させます：

1. **辞書登録 Web アプリ** — Cloudflare Pages にデプロイし、複数人で手書きデータを登録
2. **スライド生成ライブラリ** — ローカルの Python から、エクスポート辞書を使って .pptx 生成

## 全体ワークフロー

```
[1] dict_app をローカルで動かす → 数文字登録 → 触感確認
        ↓
[2] dict_app を Cloudflare Pages にデプロイ → 仲間と一緒に文字登録
        ↓
[3] 必要文字が貯まったら /api/export で辞書 JSON を取得
        ↓
[4] handwriting_pptx でスライド生成 → PowerPoint で開く → 完成
```

## 1. ローカル開発（最初の動作確認）

```bash
cd /Users/hi/pptx_auto/dict_app
npm install                                          # wrangler を devDep として導入

# ローカル認証情報（パスワード "dev"、ソルト "local"）を .dev.vars に書く
HASH=$(node -e 'const c=require("crypto");process.stdout.write(c.createHash("sha256").update("local:dev").digest("hex"))')
cat > .dev.vars <<EOF
BASIC_AUTH_SALT=local
BASIC_AUTH_USERS=dev:${HASH}
EOF

npm run db:init                                      # ローカル SQLite にスキーマ投入

# 別ターミナルで dev サーバ起動
npm run dev                                          # http://localhost:8788 起動

# Pages Dev が別の SQLite ファイルを作るので、起動後に再度 db:init を1回叩く
npm run db:init                                      # ← 初回のみ
```

`.dev.vars` は `.gitignore` 済み。wrangler が自動的に env として読み込みます。
`scripts/init-local-db.mjs` は `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`
全てに `CREATE TABLE IF NOT EXISTS` を当てるので、何度実行しても安全です。

ブラウザで http://localhost:8788 を開き、Basic 認証ダイアログに `dev / dev` を入れる。
画面操作で数文字（例: あ、・、1）を手書き登録する。

辞書をエクスポート：
```bash
curl -u dev:dev http://localhost:8788/api/export > /Users/hi/pptx_auto/data/dict.json
```

## 2. Cloudflare Pages へのデプロイ

### 事前準備
- Cloudflare アカウント
- Node.js / npm（推奨: Node 18+）

### 手順
```bash
cd /Users/hi/pptx_auto/dict_app

# (1) wrangler 認証 — ブラウザが開く
npx wrangler login

# (2) D1 データベース作成 — 出力された database_id をコピー
npx wrangler d1 create pptx_auto_dict
# ▶ 例:
#   [[d1_databases]]
#   binding = "DB"
#   database_name = "pptx_auto_dict"
#   database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# (3) wrangler.toml の database_id を上の値で書き換える
#     PLACEHOLDER_REPLACE_ON_FIRST_DEPLOY を実 ID に置換

# (4) リモート D1 にスキーマ投入
npm run db:init:remote
# 内部: wrangler d1 execute pptx_auto_dict --remote --file=./schema.sql

# (5) Pages プロジェクト作成
npx wrangler pages project create pptx-auto-dict \
  --production-branch=main

# (6) シークレット設定（パスワード／ソルト）
npx wrangler pages secret put BASIC_AUTH_SALT \
  --project-name pptx-auto-dict
# プロンプトで例: "my-very-secret-salt-2026"

npx wrangler pages secret put BASIC_AUTH_USERS \
  --project-name pptx-auto-dict
# プロンプトで例: "alice:9f2c...,bob:3a71..."
# ハッシュ生成方法は「Basic 認証ハッシュ生成」セクション参照

# (7) デプロイ
npm run deploy
# → https://pptx-auto-dict.pages.dev のような URL が払い出される
```

### Basic 認証ハッシュ生成

`BASIC_AUTH_USERS` は `"user1:hash1,user2:hash2"` 形式。
ハッシュは `sha256( BASIC_AUTH_SALT + ":" + password )` の16進。

```bash
SALT="my-very-secret-salt-2026"
PASS="alicePassword"
node -e "const c=require('crypto');console.log(c.createHash('sha256').update('${SALT}:${PASS}').digest('hex'))"
# 例: 9f2c... → "alice:9f2c..." として登録
```

### 独自ドメイン接続（任意）
Cloudflare ダッシュボード → Pages → このプロジェクト → Custom domains で追加。
ネームサーバが Cloudflare に向いていれば、TLS 証明書発行と DNS 設定は自動。

### Google ログイン認証（Cloudflare Access・推奨）

Basic 認証の代わりに **Cloudflare Access (Zero Trust)** で「Google ログイン + 許可メアド」に
できる。アプリ側のコードはほぼ不要（ミドルウェアが Access のヘッダを読むだけ）。

> ⚠️ Google Cloud / Cloudflare の設定とログインは**ご本人**が行ってください。

設定手順（Cloudflare ダッシュボード）:
1. **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**
2. アプリのドメイン（例 `pptx-auto-dict.pages.dev` または独自ドメイン）を登録
3. **Policy** を追加: Action=**Allow**、Include=**Emails** に許可するメアドを列挙
   （または Emails ending in でドメイン制限）
4. ログイン方法 (Identity provider) に **Google** を追加（初回のみ Google OAuth クライアント設定が必要）
5. デプロイ側で環境変数を設定:
   ```bash
   npx wrangler pages secret put CF_ACCESS_ENABLED --project-name pptx-auto-dict
   # 値: true
   ```
   → これでミドルウェアが Access モードになり、`Cf-Access-Authenticated-User-Email`
     を `registered_by` に使う。Basic 認証は不要（ローカル開発用に残す）。

補足（厳密化）: より堅牢にするなら `Cf-Access-Jwt-Assertion` を Cloudflare の公開鍵
(`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`) で検証する。1〜2人運用なら
ヘッダ信頼 + `CF_ACCESS_ENABLED` ゲートで十分。

> ⚠️ Access のポリシーは **`*.pages.dev` と独自ドメインの両方**に適用すること。
> 片方が素通りだと `CF_ACCESS_ENABLED=true` でも実質ガード無しになる。

#### Access 有効時の辞書同期（サービストークン）

Access を有効にすると `/api/export` も Google ログインが要るため、Python の辞書同期
(`--url`) がそのままでは通らない。**サービストークン**（機械アクセス用）を使う:

1. Zero Trust → **Access** → **Service Auth** → **Service Tokens** → トークン作成
   → Client ID と Client Secret が払い出される
2. そのトークンを許可する Access ポリシーを追加（Include=**Service Token**）
3. Python 実行時に環境変数で渡す:
   ```bash
   export CF_ACCESS_CLIENT_ID="xxxxx.access"
   export CF_ACCESS_CLIENT_SECRET="yyyyy"
   python3 -m handwriting_pptx serve --url https://pptx-auto-dict.pages.dev
   ```
   → `_sync_dict_from_url` が `CF-Access-Client-Id/Secret` ヘッダを付けて同期する。

---

## ✅ Cloudflare 設定チェックリスト（コードは準備済み・以下だけ実施）

```bash
cd /Users/hi/pptx_auto/dict_app
npm install                                   # 初回のみ
npx wrangler login                            # (1) ブラウザ認証
npx wrangler d1 create pptx_auto_dict         # (2) D1作成 → database_id をコピー
#   (3) wrangler.toml の database_id を実IDに置換 (PLACEHOLDER_... を書換)
npm run db:init:remote                        # (4) リモートD1にスキーマ投入 (variants/settings)
npx wrangler pages project create pptx-auto-dict --production-branch=main  # (5)
#   (6) 認証シークレット — どちらか:
#     Basic:  secret put BASIC_AUTH_SALT / BASIC_AUTH_USERS
#     Access: secret put CF_ACCESS_ENABLED (=true) ＋ ダッシュボードで Access 設定
npm run deploy                                # (7) デプロイ → URL払い出し
```
任意: 独自ドメイン接続 / Cloudflare Access(Google) / サービストークン(機械同期)。

> コード側（Functions・スキーマ・UI・テーマAPI・認証2モード）は実装済み。
> 上記の `wrangler` コマンドと Cloudflare ダッシュボード設定のみ実施すれば公開できる。

### テーマ（装飾 styles・配置 metrics）の管理

全ユーザー共通のテーマは D1 の `settings` テーブル (`key='theme'`) に保存し、
`/api/export` に相乗りして配布する（ローカル `dict.json` にキャッシュ）。

```bash
# 現在のテーマを確認
curl -u alice:alicePassword https://pptx-auto-dict.pages.dev/api/theme

# テーマを設定 (装飾クラス + 配置上書き)
curl -u alice:alicePassword -X PUT https://pptx-auto-dict.pages.dev/api/theme \
  -H "Content-Type: application/json" \
  -d '{"styles":{"teigi":{"color":"#0a7","bold":true}},"metrics":{"char_metrics":{"・":{"rel_size":0.3,"valign":"top"}}}}'
```
- `styles`: 装飾クラス（意味ロール）。組込み(key/note/weak)に追記・上書き。
- `metrics`: 配置ルール上書き（`char_metrics`/`formula_metrics`/`anchor_nudge`/`tight_adv`）。
- 3層マージ: 組込みデフォルト → このテーマ → MD の frontmatter `styles`。

### 認証ユーザー追加
ユーザーを追加したいときは `BASIC_AUTH_USERS` シークレットを再設定するだけ：
```bash
npx wrangler pages secret put BASIC_AUTH_USERS --project-name pptx-auto-dict
# 入力: alice:hash1,bob:hash2,carol:hash3
```

シークレット変更は次回リクエストから反映（再デプロイ不要）。

## 3. 辞書を取得してスライド生成

### 本番から取得
```bash
curl -u alice:alicePassword https://pptx-auto-dict.pages.dev/api/export \
  > /Users/hi/pptx_auto/data/dict.json
```

### スライド生成
```bash
cd /Users/hi/pptx_auto
python3 examples/quickstart.py
# → out.pptx
```

`examples/quickstart.py` を編集して、自分の見出し・箇条書きに差し替える。

## 4. 運用上の注意

| 項目 | 注意点 |
|---|---|
| D1 無料枠 | 5GB / 500万読/日 / 10万書/日。文字データは KB 単位なので十分 |
| Pages 無料枠 | 100k リクエスト/日。手書き登録は数百回/日想定で十分 |
| バックアップ | `npx wrangler d1 export pptx_auto_dict --remote --output=backup.sql` で定期取得 |
| 認証ローテーション | パスワード変更は `BASIC_AUTH_USERS` シークレットの再設定で即反映 |
| Cloudflare Access への移行 | より高度な認証が必要になったら Cloudflare Zero Trust に切り替え可 |

## 5. 動作確認 (本番)

```bash
# 401 が返る
curl -i https://pptx-auto-dict.pages.dev/api/chars

# 200 と [] が返る（空辞書）
curl -u alice:alicePassword https://pptx-auto-dict.pages.dev/api/chars

# 辞書エクスポート
curl -u alice:alicePassword https://pptx-auto-dict.pages.dev/api/export -o dict.json
```

## 6. 以降の更新

```bash
cd /Users/hi/pptx_auto/dict_app
npm run deploy
```

スキーマ変更があれば（差分は `migrations/` に置く想定）:

```bash
npx wrangler d1 execute pptx_auto_dict --remote --file=./migrations/xxx.sql
```

## トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| `500 Server misconfigured: BASIC_AUTH_USERS is not set` | シークレット未設定。手順 2-(6) を実施 |
| `D1_ERROR: no such table: variants` | リモート D1 にスキーマ未投入。手順 2-(4) を実施 |
| 認証情報を渡しても 401 | `SALT` と `PASS` の組合せでハッシュを再生成。`BASIC_AUTH_USERS` の値と一致するか確認 |
| `wrangler.toml` の `database_id` がプレースホルダ | 手順 2-(2) で取得した ID に置換 |
| `wrangler login` がブラウザで完了しない | ブラウザで Cloudflare に手動ログインしてから再実行 |
| 手書きパッドで筆圧が取れない | Pointer Events 対応ブラウザ (Chrome / Safari 最新)、ポインタが「pen」タイプ |
| デプロイ後 Functions が動かない | `wrangler.toml` の `pages_build_output_dir = "public"` が必須。Functions は `functions/` 配下を自動検出 |

## サブコンポーネント別 README

- [dict_app/README.md](../dict_app/README.md) — 辞書アプリの開発詳細
- [handwriting_pptx/](../handwriting_pptx/) — 生成ライブラリのコード
- [CLAUDE.md](../CLAUDE.md) — プロジェクト全体仕様
