import { json, error, getLoginUser, getIp, getUidByNick } from '../util.js';

// 发表回复（可引用楼层，生成通知）
export async function create(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  let body;
  try { body = await request.json(); } catch { return error('请求格式错误'); }
  const threadId = parseInt(body.thread_id || '0', 10);
  const content = String(body.content || '');
  const replyToFloor = parseInt(body.reply_to_floor || '0', 10) || 0;
  const replyToNick = String(body.reply_to_nick || '').trim();

  if (!threadId) return error('帖子不存在');
  if (!content) return error('内容不能为空');
  if (content.length > 50000) return error('内容过长');

  const thread = await env.DB.prepare('SELECT id FROM threads WHERE id = ?').bind(threadId).first();
  if (!thread) return error('帖子不存在', 404);

  // 计算楼层 = 当前最大楼层 + 1
  const maxRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(floor), 0) AS m FROM replies WHERE thread_id = ?'
  ).bind(threadId).first();
  const floor = (maxRow.m || 0) + 1;

  const result = await env.DB.prepare(
    'INSERT INTO replies (thread_id, floor, author_id, author_name, content, reply_to_floor, reply_to_nick) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(threadId, floor, user.id, user.nickname, content, replyToFloor, replyToNick).run();
  const replyId = result.meta.last_row_id;

  // 通知被 @ 的用户（自己回复自己不通知）
  const targetUid = await getUidByNick(env, replyToNick);
  if (replyToFloor > 0 && replyToNick && targetUid && targetUid !== user.id) {
    const rpage = Math.ceil(floor / 10); // 新回复所在页（原版逻辑：ceil(floor/10)）
    await env.DB.prepare(
      'INSERT INTO notify (id, thread_id, floor, from_uid, from_nick, to_uid, rpage, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
    ).bind(crypto.randomUUID(), threadId, replyToFloor, user.id, user.nickname, targetUid, rpage).run();
  }

  return json({ id: replyId, floor, rpage: Math.ceil(floor / 10) });
}

// 删除回复：仅管理员，删除后楼层重排
export async function remove(request, env) {
  const user = await getLoginUser(request, env);
  if (!user) return error('未登录', 401);
  if (user.is_admin !== 1) return error('仅管理员可删除回复', 403);
  const url = new URL(request.url);
  const threadId = parseInt(url.searchParams.get('thread_id') || '0', 10);
  const floor = parseInt(url.searchParams.get('floor') || '0', 10);
  if (!threadId || !floor) return error('参数错误');

  // 删回复 + 楼层重新编号合并为一次 batch（单事务，失败自动回滚）
  const stmts = [
    env.DB.prepare('DELETE FROM replies WHERE thread_id = ? AND floor = ?').bind(threadId, floor)
  ];
  const { results } = await env.DB.prepare(
    'SELECT id, floor FROM replies WHERE thread_id = ? AND floor > ? ORDER BY floor ASC'
  ).bind(threadId, floor).all();
  for (let i = 0; i < results.length; i++) {
    stmts.push(
      env.DB.prepare('UPDATE replies SET floor = ? WHERE id = ?').bind(floor + i, results[i].id)
    );
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}