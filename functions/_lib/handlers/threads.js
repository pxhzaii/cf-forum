import { json, error, getLoginUser, getIp } from '../util.js';

// 帖子列表（分页 + 回复数）
export async function list(request, env) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = 10;
  const offset = (page - 1) * pageSize;

  const totalRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM threads').first();
  const total = totalRow.c;
  const totalPage = Math.max(1, Math.ceil(total / pageSize));

  const { results } = await env.DB.prepare(`
    SELECT t.id, t.title, t.author_name, t.views, t.created_at,
           (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) AS reply_count
    FROM threads t
    ORDER BY t.id DESC
    LIMIT ? OFFSET ?
  `).bind(pageSize, offset).all();

  return json({ page, totalPage, total, threads: results });
}

// 帖子详情 + 回复列表
export async function detail(request, env) {
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return error('帖子不存在', 404);

  // 阅读数 +1
  await env.DB.prepare('UPDATE threads SET views = views + 1 WHERE id = ?').bind(id).run();

  const thread = await env.DB.prepare(
    'SELECT id, title, content, author_id, author_name, views, created_at FROM threads WHERE id = ?'
  ).bind(id).first();
  if (!thread) return error('帖子不存在', 404);

  const rpage = Math.max(1, parseInt(url.searchParams.get('rpage') || '1', 10));
  const replyPerPage = 10;
  const replyTotalRow = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM replies WHERE thread_id = ?'
  ).bind(id).first();
  const replyTotal = replyTotalRow.c;
  const replyTotalPage = Math.max(1, Math.ceil(replyTotal / replyPerPage));
  const replyOffset = (rpage - 1) * replyPerPage;

  const { results: replies } = await env.DB.prepare(`
    SELECT id, floor, author_name, content, reply_to_floor, reply_to_nick, created_at
    FROM replies WHERE thread_id = ? ORDER BY floor ASC LIMIT ? OFFSET ?
  `).bind(id, replyPerPage, replyOffset).all();

  return json({ thread, replies, replyTotalPage, replyTotal, rpage });
}

// 发帖
export async function create(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  let body;
  try { body = await request.json(); } catch { return error('请求格式错误'); }
  const title = String(body.title || '').trim();
  const content = String(body.content || '');
  if (!title) return error('帖子标题不能为空');
  if (!content) return error('内容不能为空');
  if (title.length > 100) return error('标题过长');
  if (content.length > 50000) return error('内容过长');

  const result = await env.DB.prepare(
    'INSERT INTO threads (title, content, author_id, author_name, ip) VALUES (?, ?, ?, ?, ?)'
  ).bind(title, content, user.id, user.nickname, getIp(request)).run();
  return json({ id: result.meta.last_row_id });
}

// 编辑：仅作者本人
export async function update(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  const thread = await env.DB.prepare('SELECT author_id FROM threads WHERE id = ?').bind(id).first();
  if (!thread) return error('帖子不存在', 404);
  if (thread.author_id !== user.id) return error('只能编辑自己的帖子', 403);

  let body;
  try { body = await request.json(); } catch { return error('请求格式错误'); }
  const title = String(body.title || '').trim();
  const content = String(body.content || '');
  if (!title) return error('帖子标题不能为空');
  if (!content) return error('内容不能为空');
  if (title.length > 100) return error('标题过长');
  if (content.length > 50000) return error('内容过长');

  await env.DB.prepare('UPDATE threads SET title = ?, content = ? WHERE id = ?')
    .bind(title, content, id).run();
  return json({ ok: true });
}

// 删除：作者本人或管理员
export async function remove(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  const thread = await env.DB.prepare('SELECT author_id FROM threads WHERE id = ?').bind(id).first();
  if (!thread) return error('帖子不存在', 404);
  if (thread.author_id !== user.id && user.is_admin !== 1) return error('没有权限删除', 403);

  // 删帖 + 删回复 + 删关联通知合并为一次 batch（单事务，失败自动回滚）
  await env.DB.batch([
    env.DB.prepare('DELETE FROM threads WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM replies WHERE thread_id = ?').bind(id),
    env.DB.prepare('DELETE FROM notify WHERE thread_id = ?').bind(id),
  ]);
  return json({ ok: true });
}