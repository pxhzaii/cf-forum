import { json, error, signJwt, getLoginUser, getIp, rateCheck, rateFail, rateClear } from '../util.js';
import { hashPassword, verifyPassword } from '../password.js';

// 注册（第一个注册的用户自动成为管理员，替代原版默认 admin 弱口令）
export async function register(request, env) {
  let body;
  try { body = await request.json(); } catch { return error('请求格式错误'); }
  const username = String(body.username || '').trim();
  const nickname = String(body.nickname || '').trim();
  const password = String(body.password || '');
  if (!username || !nickname || !password) return error('所有项不能为空');
  if (password.length < 4) return error('密码至少4位');
  if (username.length < 2 || username.length > 32) return error('用户名长度需为2-32位');
  if (nickname.length > 20) return error('昵称过长');

  const exist = await env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(username).first();
  if (exist) return error('用户名已存在');

  const isFirst = (await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first()).c === 0;
  const hash = await hashPassword(password);
  const result = await env.DB.prepare(
    'INSERT INTO users (username, nickname, password_hash, is_admin) VALUES (?, ?, ?, ?)'
  ).bind(username, nickname, hash, isFirst ? 1 : 0).run();
  const uid = result.meta.last_row_id;
  return json({ id: uid, username, nickname, is_admin: isFirst ? 1 : 0 });
}

// 登录：15 分钟同 IP 最多 5 次失败
export async function login(request, env) {
  let body;
  try { body = await request.json(); } catch { return error('请求格式错误'); }
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return error('用户名或密码错误');
  const ip = getIp(request);

  if (await rateCheck(env, ip)) {
    return error('失败次数过多，请15分钟后再试', 429);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').bind(username).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await rateFail(env, ip);
    return error('用户名或密码错误', 401);
  }
  await rateClear(env, ip);

  // 每次登录签发新 JWT，防止会话固定
  const token = await signJwt(env.JWT_SECRET, { uid: user.id }, 7 * 24 * 3600);
  return new Response(JSON.stringify({ token, user: { id: user.id, username: user.username, nickname: user.nickname, is_admin: user.is_admin } }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`,
    },
  });
}

// 当前用户
export async function me(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  return json({ user });
}

// 退出：清 Cookie
export function logout() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    },
  });
}

// 修改密码：管理员可改任何人（免旧密码），普通用户只能改自己（需旧密码）
export async function changePassword(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  let body;
  try { body = await request.json(); } catch { return error('请求格式错误'); }
  const targetUid = parseInt(body.target_uid, 10) || 0;
  const oldPwd = String(body.old_pwd || '');
  const newPwd = String(body.new_pwd || '');

  if (!targetUid) return error('目标用户无效');
  if (newPwd.length < 4) return error('新密码至少4位');
  if (user.is_admin !== 1 && targetUid !== user.id) return error('没有权限修改该用户密码', 403);

  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(targetUid).first();
  if (!target) return error('用户不存在');

  // 非管理员改自己需校验旧密码；管理员改他人免旧密码，但改自己仍需旧密码
  if (user.is_admin !== 1 || targetUid === user.id) {
    const ok = await verifyPassword(oldPwd, target.password_hash);
    if (!ok) return error('原密码错误');
  }

  const hash = await hashPassword(newPwd);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, targetUid).run();
  return json({ ok: true });
}