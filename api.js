// 前端 API 封装：统一 fetch /api，携带 Cookie，JSON 解析
const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok) {
    const msg = (data && data.error) || `请求失败 (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export const api = {
  // 认证
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (payload) => request('/auth/change-password', { method: 'POST', body: payload }),

  // 帖子
  listThreads: (page) => request(`/threads?page=${page}`),
  threadDetail: (id, rpage) => request(`/threads/detail?id=${id}&rpage=${rpage || 1}`),
  createThread: (payload) => request('/threads', { method: 'POST', body: payload }),
  updateThread: (id, payload) => request(`/threads?id=${id}`, { method: 'PUT', body: payload }),
  deleteThread: (id) => request(`/threads?id=${id}`, { method: 'DELETE' }),

  // 回复
  listReplies: (threadId, rpage) => request(`/replies?thread_id=${threadId}&rpage=${rpage || 1}`),
  createReply: (payload) => request('/replies', { method: 'POST', body: payload }),
  deleteReply: (threadId, floor) => request(`/replies?thread_id=${threadId}&floor=${floor}`, { method: 'DELETE' }),

  // 通知 & 用户
  notify: () => request('/notify'),
  markNotifyRead: (id) => request(`/notify/read?id=${id}`, { method: 'POST' }),
  clearNotify: () => request('/notify/clear', { method: 'POST' }),
  users: () => request('/users'),
};