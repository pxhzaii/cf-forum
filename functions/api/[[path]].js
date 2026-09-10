import { error } from '../_lib/util.js';
import { register, login, me, logout, changePassword } from '../_lib/handlers/auth.js';
import { list as threadList, detail, create as createThread, update as updateThread, remove as removeThread } from '../_lib/handlers/threads.js';
import { list as replyList, create as createReply, remove as removeReply } from '../_lib/handlers/replies.js';
import { myNotify, markRead, clearAll, userList } from '../_lib/handlers/misc.js';
import { upload, serve as serveImg } from '../_lib/handlers/upload.js';

// /api/* 的 catch-all 路由（[[path]] 为 Pages Functions 可变参数路由）
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  // 路由解析：/api/auth/login -> auth/login
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'auth', 'login']
  const route = parts.slice(1).join('/');

  try {
    // 认证
    if (route === 'auth/register' && method === 'POST') return register(request, env);
    if (route === 'auth/login' && method === 'POST') return login(request, env);
    if (route === 'auth/me' && method === 'GET') return me(request, env);
    if (route === 'auth/logout' && method === 'POST') return logout();
    if (route === 'auth/change-password' && method === 'POST') return changePassword(request, env);

    // 帖子
    if (route === 'threads' && method === 'GET') return threadList(request, env);
    if (route === 'threads' && method === 'POST') return createThread(request, env);
    if (route === 'threads/detail' && method === 'GET') return detail(request, env);
    if (route === 'threads' && method === 'PUT') return updateThread(request, env);
    if (route === 'threads' && method === 'DELETE') return removeThread(request, env);

    // 回复
    if (route === 'replies' && method === 'GET') return replyList(request, env);
    if (route === 'replies' && method === 'POST') return createReply(request, env);
    if (route === 'replies' && method === 'DELETE') return removeReply(request, env);

    // 通知 & 用户
    if (route === 'notify' && method === 'GET') return myNotify(request, env);
    if (route === 'notify/read' && method === 'POST') return markRead(request, env);
    if (route === 'notify/clear' && method === 'POST') return clearAll(request, env);
    if (route === 'users' && method === 'GET') return userList(request, env);

    // 图片：上传（登录）与读取（公开）
    if (route === 'upload/image' && method === 'POST') return upload(request, env);
    if (route.startsWith('img/')) return serveImg(request, env);

    return error('接口不存在', 404);
  } catch (e) {
    console.error(e);
    return error('服务器内部错误', 500);
  }
}