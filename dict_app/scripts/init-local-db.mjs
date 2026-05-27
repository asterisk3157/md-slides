#!/usr/bin/env node
/**
 * ローカル開発用 D1 初期化スクリプト
 *
 * Wrangler 3 の `wrangler d1 execute --local` と
 * `wrangler pages dev --d1=DB=...` は内部的に
 * 別ハッシュの SQLite ファイルを使ってしまうことがある。
 *
 * そこで:
 *   1. まず `wrangler d1 execute pptx_auto_dict --local --file=./schema.sql` を実行
 *   2. その後 `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` 全てに
 *      対して直接 schema.sql を流し込む
 *      （sqlite3 CLI が手元に無くても sqlite WASM/Node を使えるが、
 *        今回は手っ取り早く `sqlite3` コマンドにフォールバック）
 *
 * これで pages dev / d1 execute どちらが先でも 起動後にテーブルがある状態になる。
 */

import { execSync } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCHEMA_PATH = join(ROOT, "schema.sql");
const D1_DIR = join(ROOT, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");

function log(msg) {
  process.stdout.write(`[init-local-db] ${msg}\n`);
}

// 1. wrangler d1 execute --local （SQLite ファイルを生成させる）
log("running wrangler d1 execute --local ...");
try {
  execSync(
    "npx wrangler d1 execute pptx_auto_dict --local --persist-to=.wrangler/state --file=./schema.sql",
    { cwd: ROOT, stdio: "inherit" }
  );
} catch (e) {
  log(`wrangler d1 execute failed (continuing): ${e.message}`);
}

// 2. miniflare-D1DatabaseObject 配下の全 .sqlite に schema を流し込む
let files = [];
try {
  files = readdirSync(D1_DIR).filter((f) => f.endsWith(".sqlite"));
} catch {
  log(`D1 dir not yet created (${D1_DIR}); nothing to patch.`);
  process.exit(0);
}

if (files.length === 0) {
  log("no SQLite files found yet — that's fine, run `npm run dev` once to create them.");
  process.exit(0);
}

const schema = readFileSync(SCHEMA_PATH, "utf8");

for (const f of files) {
  const full = join(D1_DIR, f);
  const size = statSync(full).size;
  log(`applying schema to ${f} (${size} bytes) ...`);
  try {
    // sqlite3 CLI 経由で流し込む（macOS / Linux ともに標準で入っている）
    execSync(`sqlite3 "${full}"`, { input: schema, stdio: ["pipe", "inherit", "inherit"] });
  } catch (e) {
    log(`  ! failed: ${e.message}`);
  }
}

log("done.");
