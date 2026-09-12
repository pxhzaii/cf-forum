import { api } from './api.js';

// ---------- 状态 ----------
let state = {
  user: null,          // 当前登录用户
  page: 1,             // 列表页码
  totalPage: 1,
  threads: [],
  currentThread: null, // 当前查看的帖子
  replies: [],
  replyPage: 1,
  replyTotalPage: 1,
  replyThreadId: 0,
  unread: 0,
  notifyList: [],
};

// ---------- 工具 ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// BBCode 转安全 HTML：先转义全部文本，再白名单替换 [img]/[url]/[file]
function bbcode(text) {
  const t = esc(text);
  let out = t.replace(/\[url\](https?:\/\/[^\s\[\]]+)\[\/url\]/gi,
    (m, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  // 站内上传图片（/api/img/...）或 https 外链图片
  out = out.replace(/\[img\]((?:\/api\/img\/|https?:\/\/)[^\s\[\]]+\.(?:png|jpe?g|gif|webp))\[\/img\]/gi,
    (m, u) => `<img src="${u}" alt="图片" loading="lazy" onerror="this.style.display='none'">`);
  // 站内上传文件（/api/img/file/...）：带原文件名的下载链接，?name= 用于响应头 Content-Disposition
  out = out.replace(/\[file\](\/api\/img\/file\/[^\s\[\]]+?)(?:\|([^\n\[\]]{1,120}))?\[\/file\]/gi,
    (m, u, name) => {
      const safeName = String(name || u.split('/').pop()).replace(/["<>\\]/g, '_');
      const disp = encodeURIComponent(safeName).replace(/'/g, '%27');
      return `<a href="${u}?name=${disp}" target="_blank" rel="noopener noreferrer" class="file-link">📎 ${esc(safeName)}</a>`;
    });
  return out.replace(/\n/g, '<br>');
}

// D1 的 datetime('now') 是 UTC 字符串，按 UTC 解析后转本地显示
function fmtTime(iso) {
  if (!iso) return '';
  let d;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)) {
    d = new Date(iso.replace(' ', 'T') + 'Z');
  } else {
    d = new Date(iso);
  }
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------- 渲染 ----------
function renderNav() {
  const nav = $('#nav');
  let html = `<a href="#" onclick="app.goHome();return false;">🏠首页</a>`;
  if (state.user) {
    html += `<a href="#" onclick="app.newThread();return false;" class="btn-new">✍️发帖</a>`;
    html += `<span>👤 ${esc(state.user.nickname)}</span>`;
    if (state.unread > 0) html += `<span class="badge">🔔${state.unread}</span>`;
    if (state.user.is_admin) {
      html += `<a href="#" onclick="app.userList();return false;" class="btn-small">用户列表</a>`;
      html += `<a href="#" onclick="app.clearNotify();return false;" class="btn-small">清空通知</a>`;
    }
    html += `<a href="#" onclick="app.openPwd();return false;" class="btn-small">修改密码</a>`;
    html += `<a href="#" onclick="app.logout();return false;" class="btn-small btn-danger">退出</a>`;
  } else {
    html += `<button class="btn-new" onclick="app.openLogin()">🔒未登录，请注册/登录</button>`;
  }
  nav.innerHTML = html;
}

function renderNotify() {
  const box = $('#notifyBox');
  if (!state.user || !state.notifyList || state.notifyList.length === 0) { box.innerHTML = ''; return; }
  let html = `<div class="notify-bar"><b>未读提醒</b>`;
  state.notifyList.forEach(n => {
    html += `<div class="notify-item"><span>${esc(n.from_nick)} 回复了你</span> ` +
      `<a href="#" onclick="app.openThreadByNotify(${n.thread_id},${n.rpage},'${esc(n.id)}');return false;">查看</a></div>`;
  });
  html += `</div>`;
  box.innerHTML = html;
}

function renderList() {
  const main = $('#app');
  if (state.threads.length === 0) {
    main.innerHTML = `<div class="empty">还没有帖子</div>`;
    return;
  }
  let html = `<div class="thread-wrap">`;
  state.threads.forEach(t => {
    html += `<a href="/?t=${t.id}" onclick="app.openThread(${t.id},1);return false;" class="thread-item" style="display:block;text-decoration:none;color:inherit;">
      <div class="thread-list-title">${esc(t.title)}</div>
      <div class="meta-text">${esc(t.author_name)} · ${fmtTime(t.created_at)} · 回复：${t.reply_count} · 阅读：${t.views}</div>
    </a>`;
  });
  html += `</div>`;
  html += paginationHtml(state.page, state.totalPage, 'app.goPage');
  main.innerHTML = html;
}

function paginationHtml(current, total, fn) {
  if (total <= 1) return '';
  let html = `<div class="pagination">`;
  if (current > 1) html += `<a href="#" onclick="${fn}(${current-1});return false;">上一页</a>`;
  const maxShow = 9;
  let start = 1, end = total;
  if (total > maxShow) {
    const half = Math.floor(maxShow / 2);
    start = Math.max(1, current - half);
    end = Math.min(total, start + maxShow - 1);
    start = Math.max(1, end - maxShow + 1);
  }
  for (let i = start; i <= end; i++) {
    const active = i === current ? 'active' : '';
    html += `<a href="#" class="${active}" onclick="${fn}(${i});return false;">${i}</a>`;
  }
  if (current < total) html += `<a href="#" onclick="${fn}(${current+1});return false;">下一页</a>`;
  // 跳页输入：回车后读取输入值再跳转（值不能在渲染时插值）
  html += `<span style="margin:0 6px;">跳至</span>
    <input type="number" min="1" max="${total}" value="${current}" style="width:50px;padding:4px;font-size:14px;"
      onkeydown="if(event.keyCode===13){let v=parseInt(this.value);if(isNaN(v))return;if(v<1)v=1;if(v>${total})v=${total};${fn}(v);}">
    <span style="margin:0 4px;">页</span></div>`;
  return html;
}

function renderDetail() {
  const t = state.currentThread;
  const isOwner = state.user && state.user.id === t.author_id;
  let html = `<div class="detail-box">`;
  html += `<div class="thread-header"><h1>${esc(t.title)}</h1>
    <div class="nick">${esc(t.author_name)}</div>
    <div class="timeip">${fmtTime(t.created_at)} · 阅读：${t.views}次`;
  if (isOwner) {
    html += ` <a href="#" onclick="app.editThread(${t.id});return false;" class="btn-small">编辑</a>`;
    html += ` <a href="#" onclick="app.delThread(${t.id});return false;" class="btn-small btn-danger">删帖</a>`;
  } else if (state.user && state.user.is_admin) {
    html += ` <a href="#" onclick="app.delThread(${t.id});return false;" class="btn-small btn-danger">管理员删帖</a>`;
  }
  html += `</div></div>`;
  html += `<div class="thread-content">${bbcode(t.content)}</div>`;

  // 回复列表
  if (state.replies.length === 0) {
    html += `<div class="empty">暂无回复，抢沙发！</div>`;
  } else {
    state.replies.forEach(r => {
      const quote = (r.reply_to_floor > 0 && r.reply_to_nick)
        ? `<div class="reply-quote">回复 @${esc(r.reply_to_nick)} #${r.reply_to_floor}</div>` : '';
      const delBtn = state.user && state.user.is_admin
        ? `<a href="#" onclick="app.delReply(${t.id},${r.floor});return false;" class="btn-small btn-danger">删回复</a>` : '';
      const replyBtn = state.user
        ? `<span class="reply-btn" onclick="app.quoteReply(${r.floor})">回复</span>`
        : `<span class="reply-btn" onclick="app.openLogin()">登录后回复</span>`;
      html += `<div id="reply_${r.floor}" class="post-block">
        <div class="post-meta"><span class="floor-tag">#${r.floor}</span>
        <strong>${esc(r.author_name)}</strong><span>${fmtTime(r.created_at)}</span>
        ${replyBtn}${delBtn}</div>${quote}
        <div>${bbcode(r.content)}</div></div>`;
    });
    html += paginationHtml(state.replyPage, state.replyTotalPage, 'app.viewReplyPage');
  }

  // 回复表单
  html += state.user
    ? `<form id="replyForm" class="form-box" onsubmit="return app.submitReply(event)">
        <input type="hidden" id="reply_to_floor" value="0">
        <input type="hidden" id="reply_to_nick" value="">
        <input class="inp" type="text" value="${esc(state.user.nickname)}" readonly>
        <textarea class="textarea-reply" id="replyTextarea" placeholder="回复，点楼层回复@坛友" required></textarea>
        <div class="upload-bar">
          <input type="file" id="replyFile" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none" onchange="app.uploadImage(this,'replyTextarea')">
          <button type="button" class="btn-upload" onclick="document.getElementById('replyFile').click()">📎上传图片（≤5MB）</button>
          <span id="replyUploadMsg" class="upload-msg"></span>
        </div>
        <button type="submit">提交回复</button></form>`
    : `<div class="empty">🔒<span class="reply-btn" onclick="app.openLogin()">登录后才可以回复</span></div>`;

  html += `<div style="text-align:center;margin:16px 0;"><a href="#" onclick="app.goHome();return false;" class="btn-new">← 返回帖子列表</a></div>`;
  html += `</div>`;
  $('#app').innerHTML = html;
  // 滚到顶部
  window.scrollTo(0, 0);
}

// ---------- 弹窗 ----------
function showModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
// 模块作用域函数需挂到 window 才能被内联 onclick 调用
window.showModal = showModal;
window.closeModal = closeModal;

// ---------- 应用方法（暴露给 onclick） ----------
const app = {
  goHome() {
    state.currentThread = null;
    history.pushState({ view: 'home' }, '', '/');
    this.loadList(1);
  },
  goPage(p) {
    state.page = p;
    history.pushState({ view: 'home', page: p }, '', p > 1 ? `/?page=${p}` : '/');
    this.loadList(p);
  },
  async loadList(page) {
    state.page = page;
    try {
      const d = await api.listThreads(page);
      state.threads = d.threads;
      state.totalPage = d.totalPage;
      renderList();
    } catch (e) { alert(e.message); }
  },
  async openThread(id, rpage) {
    rpage = rpage || 1;
    try {
      const d = await api.threadDetail(id, rpage);
      state.currentThread = d.thread;
      state.replies = d.replies;
      state.replyPage = d.rpage;
      state.replyTotalPage = d.replyTotalPage;
      state.replyThreadId = id;
      history.pushState({ view: 'thread', id, rpage }, '', `/?t=${id}${rpage > 1 ? '&rpage=' + rpage : ''}`);
      renderDetail();
    } catch (e) { alert(e.message); }
  },
  openThreadByNotify(threadId, rpage, nid) {
    api.markNotifyRead(nid)
      .catch(() => {})
      .then(() => this.loadNotify())
      .then(() => this.openThread(threadId, rpage));
  },
  newThread() {
    if (!state.user) { this.openLogin(); return; }
    showModal('threadModal');
    $('#threadModalTitle').textContent = '发布新帖子';
    $('#threadModalAction').value = 'new';
    $('#threadModalId').value = '';
    $('#threadTitle').value = '';
    $('#threadContent').value = '';
  },
  editThread(id) {
    if (!state.currentThread) return;
    showModal('threadModal');
    $('#threadModalTitle').textContent = '编辑帖子';
    $('#threadModalAction').value = 'edit';
    $('#threadModalId').value = id;
    $('#threadTitle').value = state.currentThread.title;
    $('#threadContent').value = state.currentThread.content;
  },
  async submitThread(e) {
    e.preventDefault();
    const title = $('#threadTitle').value.trim();
    const content = $('#threadContent').value;
    const mode = $('#threadModalAction').value;
    const id = $('#threadModalId').value;
    if (!title || !content) { alert('标题和内容不能为空'); return; }
    try {
      if (mode === 'edit') {
        await api.updateThread(id, { title, content });
        closeModal('threadModal');
        await this.openThread(id, state.replyPage); // 编辑后回到帖子
      } else {
        const d = await api.createThread({ title, content });
        closeModal('threadModal');
        await this.openThread(d.id, 1); // 发帖后直接看新帖
      }
    } catch (err) { alert(err.message); }
  },
  async submitReply(e) {
    e.preventDefault();
    const content = $('#replyTextarea').value;
    if (!content.trim()) { alert('内容不能为空'); return; }
    const floor = parseInt($('#reply_to_floor').value || '0', 10);
    const nick = $('#reply_to_nick').value;
    try {
      const d = await api.createReply({ thread_id: state.replyThreadId, content, reply_to_floor: floor, reply_to_nick: nick });
      await this.openThread(state.replyThreadId, d.rpage); // 跳到新回复所在页
    } catch (err) { alert(err.message); }
  },
  quoteReply(floor) {
    // 按楼层从缓存里取昵称，避免昵称特殊字符破坏内联 JS
    const r = state.replies.find(x => x.floor === floor);
    if (!r) return;
    $('#reply_to_floor').value = floor;
    $('#reply_to_nick').value = r.author_name;
    const ta = $('#replyTextarea');
    ta.value = `@${r.author_name}#${floor} ` + ta.value;
    ta.focus();
    ta.scrollIntoView({ behavior: 'smooth' });
  },
  async delThread(id) {
    if (!confirm('确定删除帖子？所有回复一起删除！')) return;
    try { await api.deleteThread(id); this.goHome(); }
    catch (e) { alert(e.message); }
  },
  async delReply(threadId, floor) {
    if (!confirm('删除这条回复？')) return;
    try {
      await api.deleteReply(threadId, floor);
      await this.openThread(threadId, state.replyPage);
    } catch (e) { alert(e.message); }
  },
  async viewReplyPage(p) {
    await this.openThread(state.replyThreadId, p);
  },
  // 浏览器前进/后退
  onPopState(e) {
    const st = e.state;
    if (st && st.view === 'thread' && st.id) {
      this._loadThread(st.id, st.rpage || 1);
    } else {
      // 后退到首页：只渲染，不再 pushState
      state.currentThread = null;
      this.loadList(st && st.page ? st.page : 1);
    }
  },
  // 内部加载帖子（不 pushState，仅渲染）
  async _loadThread(id, rpage) {
    try {
      const d = await api.threadDetail(id, rpage);
      state.currentThread = d.thread;
      state.replies = d.replies;
      state.replyPage = d.rpage;
      state.replyTotalPage = d.replyTotalPage;
      state.replyThreadId = id;
      renderDetail();
    } catch (e) { alert(e.message); }
  },
  // 上传（图片或文件）：图片插 [img]，文件插 [file|原名]
  async uploadImage(input, textareaId) {
    const file = input.files && input.files[0];
    const msgEl = document.getElementById(textareaId === 'threadContent' ? 'threadUploadMsg' : 'replyUploadMsg');
    const btn = input.nextElementSibling; // 上传按钮紧跟在 file input 后面
    if (!file) return;
    if (!state.user) { this.openLogin(); return; }
    // 重置 input，确保同一文件可重复选择
    input.value = '';
    // 前端预校验：图片或白名单文件类型
    const isImage = /^image\/(png|jpe?g|gif|webp)$/.test(file.type);
    const isFile = /\.(pdf|txt|docx?|xlsx?|pptx?|zip|7z|rar|mp3|wav|mp4)$/i.test(file.name);
    if (!isImage && !isFile) { alert('仅支持 png/jpg/gif/webp 图片，或 pdf/txt/office 文档、zip/7z/rar 压缩包、mp3/wav/mp4 音视频'); return; }
    if (file.size > 50 * 1024 * 1024) { alert('文件不能超过 50MB'); return; }

    const ta = document.getElementById(textareaId);
    const pos = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    btn.disabled = true;
    msgEl.textContent = '上传中…';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const d = await api.uploadImage(fd);
      // 图片插 [img]；文件插 [file|原文件名]（下载时显示原名）
      const tag = d.type === 'image'
        ? `[img]${d.url}[/img]`
        : `[file]${d.url}|${file.name}[/file]`;
      ta.value = ta.value.slice(0, pos) + tag + ta.value.slice(ta.selectionEnd == null ? ta.value.length : ta.selectionEnd);
      ta.focus();
      const newPos = pos + tag.length;
      ta.setSelectionRange(newPos, newPos);
      msgEl.textContent = '已插入';
      setTimeout(() => { msgEl.textContent = ''; }, 2500);
    } catch (e) {
      msgEl.textContent = '';
      alert(e.message);
    } finally {
      btn.disabled = false;
    }
  },
  // 登录注册
  openLogin() { showModal('loginModal'); },
  openPwd() {
    showModal('pwdModal');
    const target = $('#pwdTarget');
    if (state.user.is_admin) {
      // 管理员：手动填目标 UID
      target.value = '';
      target.readOnly = false;
    } else {
      // 普通用户：自动填自己的 UID 且只读
      target.value = state.user.id;
      target.readOnly = true;
    }
    $('#pwdOld').value = '';
    $('#pwdNew').value = '';
  },
  async doLogin(e) {
    e.preventDefault();
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;
    try {
      await api.login({ username, password });
      closeModal('loginModal');
      await this.loadAuth();
    } catch (err) { alert(err.message); }
  },
  async doRegister(e) {
    e.preventDefault();
    const username = $('#regUsername').value.trim();
    const nickname = $('#regNick').value.trim();
    const password = $('#regPassword').value;
    if (!username || !nickname || !password) { alert('所有项不能为空'); return; }
    try {
      await api.register({ username, nickname, password });
      await api.login({ username, password }); // 注册后自动登录
      closeModal('loginModal');
      await this.loadAuth();
    } catch (err) { alert(err.message); }
  },
  async logout() {
    try { await api.logout(); } catch { /* 忽略 */ }
    state.user = null;
    await this.loadAuth();
    this.goHome();
  },
  async doChangePwd(e) {
    e.preventDefault();
    const target_uid = parseInt($('#pwdTarget').value || '0', 10);
    const old_pwd = $('#pwdOld').value;
    const new_pwd = $('#pwdNew').value;
    if (!target_uid || new_pwd.length < 4) { alert('参数不正确'); return; }
    try {
      await api.changePassword({ target_uid, old_pwd, new_pwd });
      closeModal('pwdModal');
      alert('密码修改成功');
    } catch (err) { alert(err.message); }
  },
  async userList() {
    try {
      const d = await api.users();
      let html = `<div class="form-box"><h2>用户列表（管理员）</h2>`;
      html += `<div style="font-size:13px;color:#666;margin-bottom:10px;">复制UID，粘贴到修改密码弹窗中修改密码</div>`;
      d.users.forEach(u => {
        html += `<div style="padding:4px 0;border-bottom:1px dashed #eee;">
          UID: <b>${u.id}</b> | 用户名：${esc(u.username)} | 昵称：${esc(u.nickname)} | ${u.is_admin ? '🔴管理员' : '普通用户'}</div>`;
      });
      html += `<div style="margin-top:12px;text-align:center;"><a href="#" onclick="app.goHome();return false;">返回首页</a></div></div>`;
      $('#app').innerHTML = html;
    } catch (e) { alert(e.message); }
  },
  async clearNotify() {
    if (!confirm('清空所有通知？')) return;
    try { await api.clearNotify(); await this.loadNotify(); this.goHome(); }
    catch (e) { alert(e.message); }
  },
  async loadAuth() {
    try {
      const d = await api.me();
      state.user = d.user;
    } catch { state.user = null; }
    await this.loadNotify();
    renderNav();
  },
  async loadNotify() {
    if (!state.user) { state.unread = 0; state.notifyList = []; renderNotify(); return; }
    try {
      const d = await api.notify();
      state.unread = d.unread;
      state.notifyList = d.notify;
      renderNotify();
    } catch { state.unread = 0; state.notifyList = []; }
    renderNav();
  },
};

// ---------- 启动 ----------
window.app = app;
window.addEventListener('popstate', (e) => app.onPopState(e));
(async function init() {
  await app.loadAuth();
  // 从 URL 恢复状态（刷新后保持当前页）
  const params = new URLSearchParams(location.search);
  const tid = parseInt(params.get('t') || '0', 10);
  const rpage = parseInt(params.get('rpage') || '1', 10);
  if (tid) {
    // replaceState 使当前 URL 可被后退
    history.replaceState({ view: 'thread', id: tid, rpage }, '', location.href);
    await app._loadThread(tid, rpage);
  } else {
    history.replaceState({ view: 'home' }, '', location.pathname);
    await app.goHome();
  }
})();