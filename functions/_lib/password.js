// 密码哈希：PBKDF2-SHA256（Workers 原生支持，无需引入 bcryptjs）
// 存储格式：pbkdf2$<iterations>$<salt_b64url>$<hash_b64url>
const enc = new TextEncoder();
const ITERATIONS = 100000;

function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function hashPassword(password, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key, 256
  );
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10);
    const salt = fromB64url(parts[2]);
    const expect = fromB64url(parts[3]);
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, expect.length * 8
    );
    const got = new Uint8Array(bits);
    if (got.length !== expect.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got[i] ^ expect[i];
    return diff === 0;
  } catch {
    return false;
  }
}