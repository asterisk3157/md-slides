"""CLI エントリポイント.

使い方:
    python3 -m handwriting_pptx audit slide.md
    python3 -m handwriting_pptx generate slide.md -o out.pptx [-d dict.json] [--url <bulk-prefix>]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List
from urllib.parse import quote

from .api import Presentation
from .dict_loader import Dictionary
from .md_parser import parse_md, extract_chars
from .warning_page import show_warning_page


def _sync_dict_from_url(url: str, dict_path: Path) -> bool:
    """Webアプリ /api/export から最新辞書を取得して dict_path に保存。

    認証 (どちらか):
      - Basic: 環境変数 HANDWRITING_DICT_AUTH="user:pass" (デフォルト dev:dev)
      - Cloudflare Access サービストークン: 環境変数
          CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
        (両方セットされていれば Access ヘッダを付与。Access 有効時の機械同期用)
    成功で True、失敗で False。
    """
    import base64
    import os
    import urllib.request
    import urllib.error

    api_url = f"{url.rstrip('/')}/api/export"
    req = urllib.request.Request(api_url)
    # Cloudflare はデフォルトの Python-urllib UA を 403 で弾くため独自UAを付与
    req.add_header("User-Agent", "handwriting_pptx/0.1")
    # Cloudflare Access サービストークン (優先)
    cf_id = os.environ.get("CF_ACCESS_CLIENT_ID")
    cf_secret = os.environ.get("CF_ACCESS_CLIENT_SECRET")
    if cf_id and cf_secret:
        req.add_header("CF-Access-Client-Id", cf_id)
        req.add_header("CF-Access-Client-Secret", cf_secret)
    # Basic 認証 (Access 無効時 / ローカル開発)
    auth = os.environ.get("HANDWRITING_DICT_AUTH", "dev:dev")
    req.add_header("Authorization", "Basic " + base64.b64encode(auth.encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = r.read()
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print(f"⚠ 辞書同期失敗 ({api_url}): {e}", file=sys.stderr)
        return False
    dict_path.parent.mkdir(parents=True, exist_ok=True)
    dict_path.write_bytes(body)
    print(f"📥 辞書同期: {dict_path} ({len(body)} bytes)")
    return True


def _cmd_audit(args) -> int:
    md_path = Path(args.md)
    if not md_path.exists():
        print(f"❌ MDファイルが見つかりません: {md_path}", file=sys.stderr)
        return 2
    doc = parse_md(md_path.read_text(encoding="utf-8"))
    for e in doc.errors:
        print(f"ERROR: {e}", file=sys.stderr)
    for w in doc.warnings:
        print(f"WARN:  {w}", file=sys.stderr)

    if not doc.slides:
        print("❌ スライドがありません", file=sys.stderr)
        return 1

    chars = extract_chars(doc)
    dict_path = Path(args.dict) if args.dict else Path("data/dict.json")
    # --url 指定時は自動的に最新辞書を取得 (--no-sync で抑止)
    if args.url and not args.no_sync:
        _sync_dict_from_url(args.url, dict_path)
    if not dict_path.exists():
        print(f"❌ 辞書が見つかりません: {dict_path}", file=sys.stderr)
        return 2
    d = Dictionary.from_path(dict_path)
    missing = [c for c in chars if not d.has(c)]
    print(f"スライド数: {len(doc.slides)}")
    print(f"使用文字数 (ユニーク): {len(chars)}")
    print(f"未登録文字: {len(missing)}")
    if missing:
        print("  未登録: " + "".join(missing))
        if args.url:
            custom = "".join(missing)
            url = f"{args.url.rstrip('/')}/bulk?custom={quote(custom)}&target={args.target}"
            print(f"  登録URL: {url}")
            if not args.no_qr:
                # QR + 警告画面をブラウザで開く
                path = show_warning_page(missing, args.url, target=args.target)
                if path:
                    print(f"  📱 QR画面: {path}")
        return 1
    print("✅ 全文字登録済み — generate可能")
    return 0


def _cmd_generate(args) -> int:
    md_path = Path(args.md)
    out_path = Path(args.out)
    if not md_path.exists():
        print(f"❌ MDファイルが見つかりません: {md_path}", file=sys.stderr)
        return 2

    doc = parse_md(md_path.read_text(encoding="utf-8"))
    for e in doc.errors:
        print(f"ERROR: {e}", file=sys.stderr)
    for w in doc.warnings:
        print(f"WARN:  {w}", file=sys.stderr)

    if doc.errors and not args.force:
        print("❌ エラーがあります (--force で続行可)", file=sys.stderr)
        return 1
    if not doc.slides:
        print("❌ スライドがありません", file=sys.stderr)
        return 1

    dict_path = Path(args.dict) if args.dict else Path("data/dict.json")
    # --url 指定時は自動的に最新辞書を取得 (--no-sync で抑止)
    if args.url and not args.no_sync:
        _sync_dict_from_url(args.url, dict_path)
    # 未登録文字チェック (URL指定があればQR警告画面、なくてもログ警告)
    if dict_path.exists():
        d = Dictionary.from_path(dict_path)
        chars = extract_chars(doc)
        missing = [c for c in chars if not d.has(c)]
        if missing:
            print(f"⚠ 未登録文字 {len(missing)} 個: {''.join(missing)}", file=sys.stderr)
            if args.url:
                url = f"{args.url.rstrip('/')}/bulk?custom={quote(''.join(missing))}&target={args.target}"
                print(f"  登録URL: {url}", file=sys.stderr)
                if not args.no_qr:
                    show_warning_page(missing, args.url, target=args.target)
            if not args.force:
                print("❌ 未登録文字あり (--force で続行可、または登録後再実行)", file=sys.stderr)
                return 1

    p = Presentation(dict_path=str(dict_path) if dict_path.exists() else None)
    # テーマ (D1→export→dict.json 相乗り): 配置metricsを適用しグローバルstylesを取得
    from . import theme as _theme
    global_styles = _theme.apply_theme(dict_path) if dict_path.exists() else {}
    # 装飾 styles 3層マージ (組込み→グローバルテーマ→文書frontmatter)
    p.set_styles(doc_styles=doc.meta.get("styles"), global_styles=global_styles)
    # 未定義クラス参照を検証
    from .md_parser import validate_styles
    style_errs = validate_styles(doc, p.styles)
    for e in style_errs:
        print(f"ERROR: {e}", file=sys.stderr)
    if style_errs and not args.force:
        print("❌ 装飾クラスエラー (--force で続行可)", file=sys.stderr)
        return 1

    # メタデータからスライドオプションを取り出し
    color = doc.meta.get("color", "#000000")
    brush_width_cm = float(doc.meta.get("brush_width_cm", 0.06))
    from .layout import resolve_tier_sizes
    heading_size_cm, bullet_size_cm, subheading_size_cm, note_size_cm = resolve_tier_sizes(doc.meta)

    for slide in doc.slides:
        p.add_slide_from_md(
            slide,
            color=color,
            brush_width_cm=brush_width_cm,
            heading_size_cm=heading_size_cm,
            bullet_size_cm=bullet_size_cm,
            subheading_size_cm=subheading_size_cm,
            note_size_cm=note_size_cm,
        )
    p.save(out_path)
    print(f"✅ wrote: {out_path}  ({out_path.stat().st_size} bytes, {len(doc.slides)} slides)")
    return 0


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="handwriting_pptx",
                                     description="Markdown → 手書きアニメ pptx 生成")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_audit = sub.add_parser("audit", help="MDの使用文字を辞書と照合、未登録を列挙")
    p_audit.add_argument("md", help="MDファイルパス")
    p_audit.add_argument("-d", "--dict", help="辞書 JSON パス (デフォルト: data/dict.json)")
    p_audit.add_argument("--url", help="登録Webアプリの URL prefix (例: http://localhost:8788)")
    p_audit.add_argument("--target", type=int, default=1, help="登録する目標バリエーション数 (デフォルト 1)")
    p_audit.add_argument("--no-qr", action="store_true", help="QR警告画面をブラウザで開かない")
    p_audit.add_argument("--no-sync", action="store_true", help="--url 指定時の自動辞書取得を無効化")
    p_audit.set_defaults(func=_cmd_audit)

    p_gen = sub.add_parser("generate", help="MDから pptx を生成")
    p_gen.add_argument("md", help="MDファイルパス")
    p_gen.add_argument("-o", "--out", required=True, help="出力 pptx パス")
    p_gen.add_argument("-d", "--dict", help="辞書 JSON パス (デフォルト: data/dict.json)")
    p_gen.add_argument("--url", help="登録Webアプリの URL prefix (未登録文字あったとき表示)")
    p_gen.add_argument("--target", type=int, default=1, help="登録する目標バリエーション数 (デフォルト 1)")
    p_gen.add_argument("--no-qr", action="store_true", help="QR警告画面をブラウザで開かない")
    p_gen.add_argument("--no-sync", action="store_true", help="--url 指定時の自動辞書取得を無効化")
    p_gen.add_argument("--force", action="store_true", help="未登録文字があっても生成続行 (□プレースホルダになる)")
    p_gen.set_defaults(func=_cmd_generate)

    p_srv = sub.add_parser("serve", help="MD ドラッグ&ドロップ Web サーバーを起動")
    p_srv.add_argument("--host", default="0.0.0.0", help="バインドホスト (デフォルト 0.0.0.0)")
    p_srv.add_argument("--port", type=int, default=5001, help="ポート (デフォルト 5001)")
    p_srv.add_argument("-d", "--dict", help="辞書 JSON パス (デフォルト: data/dict.json)")
    p_srv.add_argument("--url", help="登録Webアプリ URL prefix (例: http://192.168.1.110:8788)")
    p_srv.add_argument("--target", type=int, default=1, help="登録目標バリエーション数 (デフォルト 1)")
    p_srv.set_defaults(func=_cmd_serve)

    args = parser.parse_args(argv)
    return args.func(args)


def _cmd_serve(args) -> int:
    from .server import serve
    dict_path = Path(args.dict) if args.dict else Path("data/dict.json")
    serve(host=args.host, port=args.port, dict_path=dict_path,
          bulk_url_prefix=args.url, target=args.target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
