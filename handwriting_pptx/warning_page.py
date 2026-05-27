"""未登録文字の警告画面生成 (HTMLにQRコード埋め込み)。

audit / generate コマンドで未登録文字が検出されたとき、
ブラウザで開ける警告HTMLを生成し、自動で開く。
"""
from __future__ import annotations

import base64
import io
import tempfile
import webbrowser
from pathlib import Path
from typing import List
from urllib.parse import quote


def _make_qr_data_uri(url: str, box_size: int = 10) -> str:
    """URL から QR コードを PNG → base64 → data URI に変換。"""
    import qrcode
    img = qrcode.make(url, box_size=box_size, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


HTML_TEMPLATE = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>⚠ 未登録の文字があります</title>
<style>
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
    background: #fafafa; color: #222; margin: 0; padding: 2rem;
    display: flex; flex-direction: column; align-items: center;
  }}
  h1 {{ color: #c00; margin-bottom: 0.5rem; }}
  .hint {{ color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }}
  .missing-chars {{
    background: #fff; border: 2px solid #c00; border-radius: 12px;
    padding: 1.5rem; margin: 1rem 0; font-size: 2.5rem;
    line-height: 1.6; max-width: 700px; text-align: center;
    word-break: break-all;
  }}
  .count {{ color: #c00; font-weight: bold; }}
  .qr {{
    background: #fff; padding: 1rem; border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.08); margin: 1rem 0;
  }}
  .qr img {{ display: block; width: 280px; height: 280px; }}
  .url {{
    font-family: ui-monospace, monospace; font-size: 0.85rem;
    color: #555; background: #fff; padding: 0.6rem 1rem;
    border-radius: 6px; word-break: break-all; max-width: 700px;
  }}
  .steps {{
    background: #fff; padding: 1rem 1.5rem; border-radius: 8px;
    max-width: 700px; margin-top: 1.5rem;
  }}
  .steps ol {{ margin: 0; padding-left: 1.5rem; line-height: 1.8; }}
  footer {{ color: #999; font-size: 0.8rem; margin-top: 2rem; }}
</style>
</head>
<body>

<h1>⚠ 未登録の文字があります</h1>
<p class="hint"><span class="count">{count}</span> 文字が辞書に未登録です。下の手順で登録してください。</p>

<div class="missing-chars">
  {missing_html}
</div>

<div class="qr">
  <img src="{qr_data}" alt="QR" />
</div>

<div class="url">{url}</div>

<div class="steps">
  <strong>登録手順</strong>
  <ol>
    <li>iPad / スマホで上の QR コードを読み取る</li>
    <li>ブラウザが連続登録モードを開きます (Basic認証あり)</li>
    <li>表示される文字を順番に手書きで登録</li>
    <li>完了したら、再度ターミナルで <code>generate</code> コマンドを実行</li>
  </ol>
</div>

<footer>handwriting_pptx — MD → 手書きアニメ pptx 半自動生成</footer>

</body>
</html>
"""


def show_warning_page(missing_chars: List[str], bulk_url_prefix: str,
                      target: int = 1, auto_open: bool = True) -> Path:
    """未登録文字の警告HTMLを生成し、デフォルトでブラウザで開く。

    bulk_url_prefix: 例 "https://my-dict.pages.dev" or "http://localhost:8788"
    target: 目標バリエーション数 (デフォルト 1)
    """
    if not missing_chars:
        return None
    custom = "".join(missing_chars)
    url = f"{bulk_url_prefix.rstrip('/')}/bulk?custom={quote(custom)}&target={target}"
    qr_data = _make_qr_data_uri(url)
    # 文字一覧を HTML 表示用に整形 (1文字ずつスペース区切り)
    missing_html = " ".join(missing_chars)
    html = HTML_TEMPLATE.format(
        count=len(missing_chars),
        missing_html=missing_html,
        qr_data=qr_data,
        url=url,
    )
    # 一時ファイルに書き出し
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".html", delete=False, encoding="utf-8"
    )
    tmp.write(html)
    tmp.close()
    path = Path(tmp.name)
    if auto_open:
        webbrowser.open(f"file://{path}")
    return path
