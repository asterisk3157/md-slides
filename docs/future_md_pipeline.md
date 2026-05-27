# Markdown → スライド自動生成パイプライン — ✅ 実装済み (2026-05)

> `audit` / `generate` / `serve` CLI として実装済み（`handwriting_pptx/__main__.py`）。
> 不足文字の QR 警告画面 (`warning_page.py`)、ローカル Web サーバー (`server.py`) も実装済み。
> 確定フォーマットは `docs/md_spec.md`、設計判断は `docs/design_decisions.md`。

## ゴール

ユーザーが Markdown ファイルを用意 → このツールに渡す → **不足文字を自動検出 → 登録誘導 → スライド自動生成** を一気通貫にする。

## ワークフロー

```
1. ユーザー: slide.md を作成
       ↓
2. CLI: handwriting_pptx audit slide.md
       ↓
   Markdown を解析、含まれる全文字を抽出
       ↓
3. 辞書 (data/dict.json) と照合
       ↓
   未登録文字を列挙
       ↓
4. 未登録があれば:
   「以下の N 字が未登録です: 接 線 本 数 ...
    登録URL: https://your-dict-app.pages.dev/bulk?custom=接線本数&target=3
    登録完了後、再度このコマンドを実行してください」
       ↓
5. (ユーザーが Web で登録、エクスポート → data/dict.json 上書き)
       ↓
6. 再度: handwriting_pptx audit slide.md
       → 全文字揃った
       ↓
7. handwriting_pptx generate slide.md -o out.pptx
       → スライド生成
```

## Markdown 仕様 (案)

```markdown
# 接線の本数 (タイトルスライド)

- 定義: 直線が曲線に接する
- 条件1: f'(a) = 傾き
- 条件2: 接点で y = f(a) を通る

---

# 別スライド

- ...
```

- `# 見出し` → スライドの見出し
- `- ...` → 箇条書き行 (最大4個 = 5ブロックMVPに合わせる)
- `---` → スライド区切り
- 数式は将来 L1〜L4 エンジン経由でレイアウト

## オプション: GPT/LLM 統合 (Phase 後半)

ユーザーが「2次関数について解説スライド作って」とプロンプトを書く
→ LLM が Markdown 構造を生成
→ 上記パイプラインに流す

これは optional。最初は手書きMarkdown想定。

## 実装スケッチ

### CLI
```bash
handwriting_pptx audit slide.md
# → 不足文字レポート

handwriting_pptx generate slide.md \
  --dict data/dict.json \
  --output out.pptx \
  [--bulk-url-prefix https://your-app.pages.dev]
# → 不足あれば audit 結果を先に表示、ユーザー判断
```

### Pythonライブラリ拡張
- `handwriting_pptx.md_parser`: Markdown → スライド構造
- `handwriting_pptx.audit`: スライド構造 + Dictionary → 未登録文字リスト
- `handwriting_pptx.cli`: CLI エントリ

### Web 側拡張 (任意)
- `/audit?text=...` エンドポイント: 文字列を渡すと不足文字を返す
- これにより外部スクリプトから「不足文字を取得 → 連続登録URLを構築」のフローが軽快に

## 実装優先度

Phase 1 (現状): MVP + アンカー
Phase 2 (今後): L1 横一列数式生成エンジン
Phase 3: L2-L4 (上付き/分数/積分等)
Phase 4 (本機能): MDパイプライン (audit + generate CLI)
Phase 5: LLM統合（プロンプト → MD自動生成）
