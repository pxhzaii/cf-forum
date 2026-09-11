// 共享工具库：响应、JWT、限流
const enc = new TextEncoder();

function b64url(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function error(msg, status = 400) {
  return json({ error: msg }, status);
}

// 签名
async function jwtSign(secret, msg) {
  const keyBuf = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', keyBuf, enc.encode(msg));
  return b64url(sig);
}

export async function signJwt(secret, payload, ttlSec) {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })));
  const sig = await jwtSign(secret, `${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

export async function verifyJwt(secret, token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [h, b, s] = parts;
    const expect = await jwtSign(secret, `${h}.${b}`);
    if (expect !== s) return null;
    const bodyB64 = b.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(bodyB64);
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// 从 Cookie 或 Authorization 头解析 token
export function getToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return '';
}

// 取登录用户（带缓存避免重复查库）
export async function getLoginUser(request, env, cache = new Map()) {
  const token = getToken(request);
  if (!token) return null;
  if (cache.has(token)) return cache.get(token);
  const payload = await verifyJwt(env.JWT_SECRET, token);
  if (!payload || !payload.uid) return null;
  const user = await env.DB.prepare(
    'SELECT id, username, nickname, is_admin FROM users WHERE id = ?'
  ).bind(payload.uid).first();
  cache.set(token, user || null);
  return user || null;
}

export function getIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';
}

// 按昵称查用户 uid（昵称不唯一时取最先注册的）
export async function getUidByNick(env, nick) {
  const row = await env.DB.prepare(
    'SELECT id FROM users WHERE nickname = ? ORDER BY id ASC LIMIT 1'
  ).bind(nick).first();
  return row ? row.id : 0;
}

// 登录限流：15 分钟内同 IP 最多 5 次失败
const WINDOW_SEC = 15 * 60;
const MAX_ATTEMPTS = 5;

export async function rateCheck(env, ip) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - WINDOW_SEC;
  await env.DB.prepare('DELETE FROM login_log WHERE ts < ?').bind(cutoff).run();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM login_log WHERE ip = ? AND ts > ?'
  ).bind(ip, cutoff).first();
  const c = row ? row.c : 0;
  return c >= MAX_ATTEMPTS;
}

export async function rateFail(env, ip) {
  await env.DB.prepare('INSERT INTO login_log (ip, ts) VALUES (?, ?)').bind(ip, Math.floor(Date.now() / 1000)).run();
}

export async function rateClear(env, ip) {
  await env.DB.prepare('DELETE FROM login_log WHERE ip = ?').bind(ip).run();
}