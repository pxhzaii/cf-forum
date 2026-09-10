import { json, error, getLoginUser } from '../util.js';

// 我的未读通知
export async function myNotify(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  const { results } = await env.DB.prepare(
    'SELECT id, thread_id, floor, from_nick, rpage, is_read, created_at FROM notify WHERE to_uid = ? AND is_read = 0 ORDER BY created_at DESC LIMIT 20'
  ).bind(user.id).all();
  return json({ notify: results, unread: results.length });
}

// 标记已读
export async function markRead(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return error('参数错误');
  await env.DB.prepare('UPDATE notify SET is_read = 1 WHERE id = ? AND to_uid = ?')
    .bind(id, user.id).run();
  return json({ ok: true });
}

// 清空通知（管理员）
export async function clearAll(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  if (user.is_admin !== 1) return error('仅管理员可操作', 403);
  await env.DB.prepare('DELETE FROM notify').run();
  return json({ ok: true });
}

// 用户列表（管理员）
export async function userList(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  if (user.is_admin !== 1) return error('仅管理员可查看', 403);
  const { results } = await env.DB.prepare(
    'SELECT id, username, nickname, is_admin, created_at FROM users ORDER BY id ASC'
  ).all();
  return json({ users: results });
}