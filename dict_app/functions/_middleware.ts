/**
 * 認証ミドルウェア
 *
 * 2モード:
 *  1. Cloudflare Access (推奨・本番): CF_ACCESS_ENABLED="true" のとき、
 *     Access が付与する Cf-Access-Authenticated-User-Email ヘッダを信頼し、
 *     そのメールを username とする。許可メアドの管理は Cloudflare Access の
 *     ポリシー側 (Google ログイン + メアド許可リスト) で行う。
 *     ※ より厳密にするなら Cf-Access-Jwt-Assertion を Cloudflare 公開鍵で
 *       検証する (docs/deploy.md 参照)。
 *  2. Basic 認証 (ローカル開発・フォールバック):
 *     BASIC_AUTH_USERS = "alice:sha256hex,bob:sha256hex"
 *     BASIC_AUTH_SALT  = "適当なソルト"
 *     パスワード照合: sha256( salt + ":" + password ) === sha256hex
 *
 * 認証に成功すると context.data.username にユーザー名 (またはメール) を入れる。
 */

interface Env {
  CF_ACCESS_ENABLED?: string;
  BASIC_AUTH_USERS?: string;
  BASIC_AUTH_SALT?: string;
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function parseUsers(raw: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of raw.split(",")) {
    const s = part.trim();
    if (!s) continue;
    const idx = s.indexOf(":");
    if (idx <= 0) continue;
    const user = s.slice(0, idx).trim();
    const hash = s.slice(idx + 1).trim().toLowerCase();
    if (user && hash) m.set(user, hash);
  }
  return m;
}

function unauthorized(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="dict_app", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next, data } = context;

  // --- モード1: Cloudflare Access ---
  // Access はエッジで未認証リクエストを遮断するため、ここに到達した時点で認証済み。
  // ユーザーログイン → Cf-Access-Authenticated-User-Email、
  // サービストークン (Python の辞書同期等の機械アクセス) → Cf-Access-Client-Id。
  // どちらかを username とする。
  // ※ 重要: Access のポリシーは *.pages.dev と独自ドメインの両方に適用すること
  //   (片方が素通りだと CF_ACCESS_ENABLED=true でも実質ガード無しになる)。
  if ((env.CF_ACCESS_ENABLED ?? "") === "true") {
    const email = request.headers.get("Cf-Access-Authenticated-User-Email");
    const svc = request.headers.get("Cf-Access-Client-Id");
    (data as Record<string, unknown>).username = email || (svc ? `svc:${svc}` : "access-user");
    return next();
  }

  // --- モード2: Basic 認証 (ローカル開発・フォールバック) ---
  const usersRaw = env.BASIC_AUTH_USERS ?? "";
  const salt = env.BASIC_AUTH_SALT ?? "";

  // 設定が無い場合はガード解除せず 500 を返す（誤デプロイ防止）
  if (!usersRaw) {
    return new Response(
      "Server misconfigured: BASIC_AUTH_USERS is not set",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Basic ")) {
    return unauthorized();
  }

  let decoded: string;
  try {
    decoded = atob(auth.slice("Basic ".length).trim());
  } catch {
    return unauthorized();
  }

  const idx = decoded.indexOf(":");
  if (idx < 0) return unauthorized();
  const username = decoded.slice(0, idx);
  const password = decoded.slice(idx + 1);
  if (!username) return unauthorized();

  const users = parseUsers(usersRaw);
  const expected = users.get(username);
  if (!expected) return unauthorized();

  const computed = await sha256Hex(`${salt}:${password}`);

  // タイミング攻撃を多少緩和
  if (computed.length !== expected.length) return unauthorized();
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return unauthorized();

  // 認証成功 → ハンドラに username を渡す
  (data as Record<string, unknown>).username = username;

  return next();
};
