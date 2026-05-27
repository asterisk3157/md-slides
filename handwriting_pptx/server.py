"""ローカル Web サーバー: MD ドラッグ&ドロップ → pptx 生成 / QR 表示。

使い方:
    python3 -m handwriting_pptx serve --url http://192.168.1.110:8788

フロー:
    1. ブラウザで http://localhost:5001/ を開く
    2. MD ファイルをドラッグ&ドロップ
    3. 全文字登録済み → 直接 pptx ダウンロード
       未登録あり → 画面全体に QR + 「登録完了」ボタン
    4. iPad で QR 読み取り → 不足文字を登録
    5. ブラウザに戻って「登録完了」 → 辞書再取得 → pptx ダウンロード
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import threading
import time
import uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import urlparse, parse_qs, quote


# ---------- セッション保管 ----------

class _Session:
    def __init__(self, md_bytes: bytes, filename: str):
        self.md_bytes = md_bytes
        self.filename = filename
        self.pptx_bytes: Optional[bytes] = None
        self.preview_svgs: Optional[list] = None
        self.created_at = time.time()


_SESSIONS: Dict[str, _Session] = {}
_SESSIONS_LOCK = threading.Lock()


def _gc_sessions(ttl_seconds: int = 3600) -> None:
    """期限切れセッションを掃除 (1時間)。"""
    now = time.time()
    with _SESSIONS_LOCK:
        for sid in list(_SESSIONS.keys()):
            if now - _SESSIONS[sid].created_at > ttl_seconds:
                del _SESSIONS[sid]


# ---------- 設定 (起動時にハンドラへ注入) ----------

class _Config:
    dict_path: Path = Path("data/dict.json")
    bulk_url_prefix: Optional[str] = None  # 例: http://192.168.1.110:8788
    target: int = 1


_CONFIG = _Config()


# ---------- ハンドラ ----------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] " + fmt % args + "\n")

    # ---------- GET ----------
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/" or url.path == "/index.html":
            self._send_html(_INDEX_HTML)
            return
        if url.path.startswith("/qr/"):
            sid = url.path[len("/qr/"):]
            self._serve_qr_page(sid)
            return
        if url.path.startswith("/preview/"):
            sid = url.path[len("/preview/"):]
            self._serve_preview_page(sid)
            return
        if url.path.startswith("/api/qr_image"):
            qs = parse_qs(url.query)
            target_url = qs.get("url", [""])[0]
            if not target_url:
                self._send_text(400, "missing url")
                return
            png = _make_qr_png(target_url, box_size=14)
            self._send_bytes(200, "image/png", png)
            return
        if url.path.startswith("/api/download/"):
            sid = url.path[len("/api/download/"):]
            with _SESSIONS_LOCK:
                sess = _SESSIONS.get(sid)
            if not sess or not sess.pptx_bytes:
                self._send_text(404, "not ready")
                return
            stem = Path(sess.filename).stem or "out"
            self._send_bytes(
                200,
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                sess.pptx_bytes,
                filename=f"{stem}.pptx",
            )
            return
        self._send_text(404, "not found")

    # ---------- POST ----------
    def do_POST(self):
        url = urlparse(self.path)
        if url.path == "/api/upload":
            self._handle_upload()
            return
        if url.path.startswith("/api/complete/"):
            sid = url.path[len("/api/complete/"):]
            self._handle_complete(sid)
            return
        self._send_text(404, "not found")

    # ---------- ハンドラ実装 ----------

    def _handle_upload(self):
        """multipart/form-data で MD ファイルを受け取る。
        全文字OK → セッションに pptx を保存して JSON で download URL を返す。
        未登録あり → QR画面 URL を JSON で返す。
        """
        ctype = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", 0))
        if not ctype.startswith("multipart/form-data") or length <= 0:
            self._send_json(400, {"error": "multipart/form-data required"})
            return
        body = self.rfile.read(length)
        try:
            md_bytes, filename = _parse_multipart_first_file(body, ctype)
        except Exception as e:
            self._send_json(400, {"error": f"multipart parse failed: {e}"})
            return

        sid = uuid.uuid4().hex[:12]
        sess = _Session(md_bytes=md_bytes, filename=filename)
        with _SESSIONS_LOCK:
            _SESSIONS[sid] = sess

        result = _audit_and_build(sess)
        if result["status"] == "ok":
            self._send_json(200, {
                "status": "ok",
                "session": sid,
                "preview_url": f"/preview/{sid}",
                "download_url": f"/api/download/{sid}",
            })
        elif result["status"] == "missing":
            self._send_json(200, {
                "status": "missing",
                "session": sid,
                "missing": result["missing"],
                "bulk_url": result["bulk_url"],
                "qr_page_url": f"/qr/{sid}",
            })
        else:
            self._send_json(500, {"status": "error", "error": result.get("error", "unknown")})

    def _handle_complete(self, sid: str):
        """ユーザーが「登録完了」を押した: 辞書再取得 → 再 audit → pptx。"""
        with _SESSIONS_LOCK:
            sess = _SESSIONS.get(sid)
        if not sess:
            self._send_json(404, {"error": "session not found"})
            return
        # 辞書を再取得
        if _CONFIG.bulk_url_prefix:
            from .__main__ import _sync_dict_from_url
            _sync_dict_from_url(_CONFIG.bulk_url_prefix, _CONFIG.dict_path)
        result = _audit_and_build(sess)
        if result["status"] == "ok":
            self._send_json(200, {
                "status": "ok",
                "preview_url": f"/preview/{sid}",
                "download_url": f"/api/download/{sid}",
            })
        elif result["status"] == "missing":
            self._send_json(200, {
                "status": "missing",
                "missing": result["missing"],
                "bulk_url": result["bulk_url"],
            })
        else:
            self._send_json(500, {"status": "error", "error": result.get("error", "unknown")})

    def _serve_preview_page(self, sid: str):
        with _SESSIONS_LOCK:
            sess = _SESSIONS.get(sid)
        if not sess:
            self._send_text(404, "session not found")
            return
        if sess.preview_svgs is None:
            # まだ生成されていない (未登録文字あり等) → 再評価
            result = _audit_and_build(sess)
            if result["status"] != "ok":
                self._send_html(
                    "<!doctype html><meta charset='utf-8'>"
                    "<body style='font-family:sans-serif;padding:2rem'>"
                    "<p>プレビューを生成できません（未登録文字またはエラー）。</p>"
                    f"<p><a href='/qr/{sid}'>登録画面へ</a></p></body>"
                )
                return
        slides_html = "".join(
            f'<div class="slide"><div class="num">スライド {i + 1}</div>{svg}</div>'
            for i, svg in enumerate(sess.preview_svgs or [])
        )
        html = (
            _PREVIEW_HTML
            .replace("{{sid}}", sid)
            .replace("{{slides}}", slides_html)
            .replace("{{count}}", str(len(sess.preview_svgs or [])))
        )
        self._send_html(html)

    def _serve_qr_page(self, sid: str):
        with _SESSIONS_LOCK:
            sess = _SESSIONS.get(sid)
        if not sess:
            self._send_text(404, "session not found")
            return
        # 現状の未登録を再算出
        result = _audit_and_build(sess, build_pptx=False)
        if result["status"] == "ok":
            # 既に揃っている: ダウンロード画面にリダイレクト
            self._send_html(_DONE_HTML.replace("{{sid}}", sid))
            return
        missing = "".join(result["missing"])
        bulk_url = result["bulk_url"]
        qr_data_uri = "data:image/png;base64," + base64.b64encode(
            _make_qr_png(bulk_url, box_size=14)
        ).decode("ascii")
        html = (
            _QR_HTML
            .replace("{{sid}}", sid)
            .replace("{{missing}}", _escape_html(missing))
            .replace("{{bulk_url}}", _escape_html(bulk_url))
            .replace("{{qr_data_uri}}", qr_data_uri)
            .replace("{{count}}", str(len(missing)))
        )
        self._send_html(html)

    # ---------- 低レベル送信 ----------

    def _send_text(self, code: int, text: str):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html: str):
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code: int, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, code: int, ctype: str, body: bytes, filename: Optional[str] = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# ---------- ユーティリティ ----------

def _make_qr_png(url: str, box_size: int = 14) -> bytes:
    import qrcode
    img = qrcode.make(url, box_size=box_size, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _escape_html(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;").replace("'", "&#39;"))


def _parse_multipart_first_file(body: bytes, content_type: str):
    """最小 multipart パーサ: 最初の file パートを抜き出す。"""
    # boundary を取り出す
    parts = content_type.split(";")
    boundary = None
    for p in parts:
        p = p.strip()
        if p.startswith("boundary="):
            boundary = p[len("boundary="):]
            if boundary.startswith('"') and boundary.endswith('"'):
                boundary = boundary[1:-1]
            break
    if not boundary:
        raise ValueError("boundary not found")
    delim = ("--" + boundary).encode()
    end = ("--" + boundary + "--").encode()
    # 分割
    chunks = body.split(delim)
    for ch in chunks:
        if not ch or ch in (b"--\r\n", b"--"):
            continue
        # 各パートは \r\nHEADERS\r\n\r\nBODY\r\n の形
        ch = ch.lstrip(b"\r\n")
        if ch.startswith(b"--"):
            continue
        header_end = ch.find(b"\r\n\r\n")
        if header_end < 0:
            continue
        headers = ch[:header_end].decode("utf-8", errors="replace")
        data = ch[header_end + 4:]
        # 末尾 \r\n を除去
        if data.endswith(b"\r\n"):
            data = data[:-2]
        # filename を取り出す
        filename = "upload.md"
        for line in headers.split("\r\n"):
            if line.lower().startswith("content-disposition"):
                # filename="..."
                idx = line.find("filename=")
                if idx >= 0:
                    val = line[idx + len("filename="):]
                    if val.startswith('"'):
                        endq = val.find('"', 1)
                        if endq > 0:
                            filename = val[1:endq]
                break
        return data, filename
    raise ValueError("no file part found")


def _audit_and_build(sess: _Session, build_pptx: bool = True) -> dict:
    """セッションの MD を audit し、必要なら pptx を組み立てて sess に格納。

    戻り値: {"status": "ok"|"missing"|"error", "missing": [...], "bulk_url": ...}
    """
    from .md_parser import parse_md, extract_chars
    from .dict_loader import Dictionary
    from .api import Presentation

    try:
        text = sess.md_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return {"status": "error", "error": "MD は UTF-8 で保存してください"}

    doc = parse_md(text)
    if not doc.slides:
        return {"status": "error", "error": "スライドがありません (見出し # が必要)"}

    if not _CONFIG.dict_path.exists():
        return {"status": "error", "error": f"辞書がありません: {_CONFIG.dict_path}"}
    d = Dictionary.from_path(_CONFIG.dict_path)
    chars = extract_chars(doc)
    missing = [c for c in chars if not d.has(c)]
    if missing:
        bulk_url = ""
        if _CONFIG.bulk_url_prefix:
            bulk_url = (
                _CONFIG.bulk_url_prefix.rstrip("/")
                + "/bulk?custom=" + quote("".join(missing))
                + f"&target={_CONFIG.target}"
            )
        return {"status": "missing", "missing": missing, "bulk_url": bulk_url}

    if not build_pptx:
        return {"status": "ok"}

    try:
        p = Presentation(dict_path=str(_CONFIG.dict_path))
        from . import theme as _theme
        global_styles = _theme.apply_theme(_CONFIG.dict_path)
        p.set_styles(doc_styles=doc.meta.get("styles"), global_styles=global_styles)
        color = doc.meta.get("color", "#000000")
        brush_width_cm = float(doc.meta.get("brush_width_cm", 0.086))
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
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".pptx", delete=False) as f:
            tmp = f.name
        p.save(tmp)
        sess.pptx_bytes = Path(tmp).read_bytes()
        try:
            os.unlink(tmp)
        except OSError:
            pass
        from .svg_preview import presentation_to_svgs
        sess.preview_svgs = presentation_to_svgs(p)
    except Exception as e:
        return {"status": "error", "error": f"pptx生成失敗: {e}"}

    return {"status": "ok"}


# ---------- HTML ----------

_INDEX_HTML = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>手書き pptx 生成</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
    background: #f5f5f7; color: #222; margin: 0; padding: 2rem;
    min-height: 100vh; display: flex; flex-direction: column; align-items: center;
  }
  h1 { font-weight: 600; margin: 1rem 0 0.5rem; }
  .hint { color: #666; margin-bottom: 2rem; }
  .drop {
    width: min(640px, 90vw); padding: 4rem 2rem; border: 3px dashed #aac;
    border-radius: 16px; background: #fff; text-align: center;
    transition: background .15s, border-color .15s;
  }
  .drop.dragover { background: #eef; border-color: #44a; }
  .drop p { margin: 0.4rem 0; }
  .drop .big { font-size: 1.3rem; font-weight: 600; }
  .drop .sub { color: #888; font-size: 0.9rem; }
  input[type=file] { display: none; }
  .status { margin-top: 2rem; padding: 1rem 1.5rem; border-radius: 8px; min-width: 320px; text-align: center; }
  .status.ok { background: #e8f8e8; color: #060; }
  .status.err { background: #fee; color: #900; }
  .status.busy { background: #eef; color: #333; }
  a.btn {
    display: inline-block; padding: 0.6em 1.4em; background: #06c; color: #fff;
    text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 0.5rem;
  }
</style>
</head>
<body>
  <h1>📝 Markdown → 手書き pptx</h1>
  <div class="hint">MD ファイルをドラッグ&amp;ドロップしてください</div>
  <label class="drop" id="drop">
    <input type="file" id="file" accept=".md,text/markdown,text/plain" />
    <p class="big">ここに MD をドロップ</p>
    <p class="sub">またはクリックでファイル選択</p>
  </label>
  <div id="status" class="status" style="display:none"></div>

<script>
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const status = document.getElementById('status');

drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
drop.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('dragover');
  if (e.dataTransfer.files.length) upload(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => {
  if (e.target.files.length) upload(e.target.files[0]);
});

function setStatus(cls, html) {
  status.style.display = 'block';
  status.className = 'status ' + cls;
  status.innerHTML = html;
}

async function upload(file) {
  setStatus('busy', `⏳ ${file.name} を解析中…`);
  const fd = new FormData();
  fd.append('file', file, file.name);
  let res;
  try {
    res = await fetch('/api/upload', { method: 'POST', body: fd });
  } catch (e) {
    setStatus('err', '❌ アップロード失敗: ' + e);
    return;
  }
  const j = await res.json();
  if (j.status === 'ok') {
    // プレビュー画面へ
    location.href = j.preview_url;
  } else if (j.status === 'missing') {
    // QR画面に遷移
    location.href = j.qr_page_url;
  } else {
    setStatus('err', '❌ ' + (j.error || 'エラー'));
  }
}
</script>
</body>
</html>"""


_QR_HTML = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>📱 未登録文字を登録してください</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; color: #222;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
    min-height: 100vh;
  }
  .wrap {
    min-height: 100vh; padding: 2vh 4vw; box-sizing: border-box;
    display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  }
  h1 { color: #c00; margin: 0.3rem 0 0.2rem; font-size: 1.8rem; }
  .hint { color: #555; margin-bottom: 1rem; }
  .missing {
    background: #fff8e1; border: 1px solid #f5b400; padding: 0.6rem 1rem;
    border-radius: 8px; font-size: 2rem; letter-spacing: 0.2em;
    max-width: 90vw; word-break: break-all; text-align: center; margin-bottom: 1rem;
  }
  .qr-area {
    background: #fff; padding: 1rem; border: 1px solid #ddd; border-radius: 12px;
    max-width: min(70vh, 90vw); width: 100%; box-sizing: border-box; text-align: center;
  }
  .qr-area img { width: 100%; height: auto; image-rendering: pixelated; }
  .url {
    word-break: break-all; font-size: 0.85rem; color: #333; margin: 0.5rem 0;
    background: #f4f4f4; padding: 0.4rem 0.6rem; border-radius: 4px;
  }
  .steps { color: #444; margin: 1rem 0; max-width: 600px; }
  .steps li { margin: 0.3rem 0; }
  button.done {
    display: block; padding: 1rem 2.5rem; font-size: 1.2rem; font-weight: 600;
    background: #06c; color: #fff; border: none; border-radius: 10px; cursor: pointer;
    margin: 1.5rem auto 1rem;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  }
  button.done:hover { background: #04a; }
  button.done:disabled { background: #aac; cursor: not-allowed; }
  #result { text-align: center; margin-top: 1rem; min-height: 2rem; font-size: 1rem; }
  #result.err { color: #c00; }
  #result.ok { color: #060; font-size: 1.1rem; font-weight: 600; }
  a.btn {
    display: inline-block; padding: 0.7em 1.6em; background: #060; color: #fff;
    text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 0.5rem;
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>⚠ 未登録の文字が {{count}} 個あります</h1>
  <p class="hint">iPad / スマホで以下の QR を読み取り、文字を登録してください</p>
  <div class="missing">{{missing}}</div>
  <div class="qr-area">
    <img src="{{qr_data_uri}}" alt="QR" />
    <div class="url">{{bulk_url}}</div>
  </div>
  <ol class="steps">
    <li>iPad / スマホで QR を読み取り、表示されたページで連続登録</li>
    <li>全部書き終わったら↓のボタンを押す</li>
  </ol>
  <button class="done" id="done">登録完了 → pptx を生成</button>
  <div id="result"></div>
</div>

<script>
const sid = "{{sid}}";
const btn = document.getElementById('done');
const result = document.getElementById('result');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  result.className = '';
  result.textContent = '⏳ 辞書を取得して再チェック中…';
  let res;
  try {
    res = await fetch('/api/complete/' + sid, { method: 'POST' });
  } catch (e) {
    result.className = 'err';
    result.textContent = '❌ 通信エラー: ' + e;
    btn.disabled = false;
    return;
  }
  const j = await res.json();
  if (j.status === 'ok') {
    // プレビュー画面へ
    location.href = j.preview_url;
  } else if (j.status === 'missing') {
    result.className = 'err';
    result.innerHTML = 'まだ未登録: <strong>' + j.missing.join('') + '</strong><br/>もう一度 QR から登録してください';
    btn.disabled = false;
  } else {
    result.className = 'err';
    result.textContent = '❌ ' + (j.error || 'エラー');
    btn.disabled = false;
  }
});
</script>
</body>
</html>"""


_PREVIEW_HTML = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>プレビュー</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
    background: #f0f0f3; color: #222; margin: 0; padding: 0; }
  header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ddd;
    padding: 0.8rem 1.5rem; display: flex; align-items: center; gap: 1rem; z-index: 10; }
  header h1 { font-size: 1.1rem; margin: 0; font-weight: 600; }
  header .spacer { flex: 1; }
  a.btn, button.btn { display: inline-block; padding: 0.6em 1.4em; background: #06c; color: #fff;
    text-decoration: none; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 1rem; }
  a.btn.sub { background: #eee; color: #333; }
  main { padding: 1.5rem; display: flex; flex-direction: column; align-items: center; gap: 1.5rem; }
  .slide { background: #fff; padding: 0.5rem; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
  .slide .num { font-size: 0.8rem; color: #888; margin: 0.2rem 0 0.4rem 0.4rem; }
  .slide svg { max-width: 100%; height: auto; display: block; }
</style>
</head>
<body>
  <header>
    <h1>📝 プレビュー（{{count}} スライド）</h1>
    <div class="spacer"></div>
    <a class="btn sub" href="/">← 別のMD</a>
    <a class="btn" href="/api/download/{{sid}}" download>pptx をダウンロード</a>
  </header>
  <main>{{slides}}</main>
</body>
</html>"""


_DONE_HTML = """<!doctype html>
<html lang="ja"><head><meta charset="utf-8"/><title>完了</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:3rem;text-align:center}
a.btn{display:inline-block;padding:0.8em 2em;background:#060;color:#fff;text-decoration:none;border-radius:8px}</style></head>
<body><h1>✅ 全文字登録済み</h1>
<a class="btn" href="/preview/{{sid}}">プレビューを見る</a></body></html>"""


# ---------- 起動 ----------

def serve(host: str, port: int, dict_path: Path, bulk_url_prefix: Optional[str], target: int = 1):
    _CONFIG.dict_path = dict_path
    _CONFIG.bulk_url_prefix = bulk_url_prefix
    _CONFIG.target = target

    server = ThreadingHTTPServer((host, port), Handler)
    print(f"📝 MD → pptx サーバー起動: http://{host or 'localhost'}:{port}/")
    if bulk_url_prefix:
        print(f"   辞書登録Web: {bulk_url_prefix}")
    print(f"   辞書ファイル: {dict_path}")
    print("Ctrl+C で停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました")
        server.server_close()
