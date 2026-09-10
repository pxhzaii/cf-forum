---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '238177b2-c7c6-42a0-8023-9fd2629b7990'
  PropagateID: '238177b2-c7c6-42a0-8023-9fd2629b7990'
  ReservedCode1: '870159cb-c795-450d-9617-f99421623c3f'
  ReservedCode2: '870159cb-c795-450d-9617-f99421623c3f'
---

# 极简论坛（Cloudflare Pages 版）

原 PHP 单文件论坛的完整迁移版：静态前端 + Pages Functions + Cloudflare D1 数据库。功能与原版 1:1（注册/登录、发帖、楼层回复、引用回复、通知、删帖、编辑、双层分页、阅读计数、BBCode、管理员用户列表/改密/清空通知），并修复了原版全部高危漏洞。

## 架构

```
前端：index.html + app.js + api.js（纯静态）
后端：functions/ 目录下的 Pages Functions（REST API）
存储：Cloudflare D1（SQLite）
```

| 原版文件 | 现在的存储 |
|----------|-----------|
| users.json | users 表 |
| posts.jsonl | threads + replies 表 |
| notify.json | notify 表 |
| viewcount.json | threads.views 字段 |

原版高危漏洞修复情况：

| 原版问题 | 现在的方案 |
|----------|-----------|
| users.json 可直接下载 | D1 数据库不存在文件，无文件可下载 |
| [img]/[url] 存储型 XSS | 前端先转义再做白名单 BBCode 替换，[img] 强制 http/https 且限图片后缀，[url] 加 rel="noopener" |
| 无 CSRF + GET 删除 | 全部操作 POST/PUT/DELETE + HttpOnly SameSite=Lax Cookie |
| 无登录限流 | D1 表按 IP 15 分钟 5 次失败锁定 |
| 默认弱口令 admin/admin123456 | 无默认账号，第一个注册的用户自动成为管理员 |
| 会话固定 | 登录签发新 JWT（7 天有效） |
| uid 用 time() 同秒冲突 | D1 自增 id |
| 删回复楼层错位 | 删除后自动重排楼层号 |
| 孤儿回复 | 回复前校验帖子存在 |
| users.json 损坏全灭 | D1 事务性存储 |
| [img] 无协议白名单 | 只允许 http/https + 图片后缀 |

## 部署（5 步）

> 前置：一个 GitHub 账号 + 一个 Cloudflare 账号。全程约 10 分钟。

### 1. Fork / 上传代码到 GitHub

把本项目推送或上传到你的 GitHub 仓库（例如 `yourname/cf-forum`）。

### 2. 创建 D1 数据库

Cloudflare 控制台 → Storage & Databases → D1 SQL Database → Create：

- 名称：`cf-forum-db`（可自定，记下来）
- 创建后进入数据库页面，记下 **Database ID**

### 3. 建表（在 D1 控制台执行 SQL）

进入刚创建的数据库 → Console 标签 → 把下面整段 SQL 粘贴执行：

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nickname TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_id INTEGER NOT NULL,
    author_name TEXT NOT NULL,
    ip TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    floor INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    author_name TEXT NOT NULL,
    content TEXT NOT NULL,
    reply_to_floor INTEGER NOT NULL DEFAULT 0,
    reply_to_nick TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notify (
    id TEXT PRIMARY KEY,
    thread_id INTEGER NOT NULL,
    floor INTEGER NOT NULL,
    from_uid INTEGER NOT NULL,
    from_nick TEXT NOT NULL,
    to_uid INTEGER NOT NULL,
    rpage INTEGER NOT NULL DEFAULT 1,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_log (
    ip TEXT NOT NULL,
    ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replies_thread_floor ON replies(thread_id, floor);
CREATE INDEX IF NOT EXISTS idx_notify_to ON notify(to_uid, is_read);
CREATE INDEX IF NOT EXISTS idx_login_ip ON login_log(ip, ts);
```

### 4. 创建 Pages 项目

Cloudflare 控制台 → Workers & Pages → Create → Pages → Connect to Git：

- 选择你的仓库 → Begin setup
- **Framework preset**: None
- **Build command**: 留空
- **Build output directory**: `/`
- **Environment variables（Production 和 Preview 都加）**：
  - `JWT_SECRET` = 一串长随机字符串（生成命令：PowerShell 执行 `[Convert]::ToBase64String((1..32 | ForEach-Object {Get-Random -Max 256}) -as [byte[]])`，或 Linux `openssl rand -base64 32`）
- Save and Deploy

### 5. 绑定 D1

部署完成后：项目 → Settings → Bindings → Add binding：

- **Type**: D1 database
- **Variable name**: `DB`
- **D1 database**: 选择第 2 步建的 `cf-forum-db`

**注意：** 绑定后需要**重新部署一次**才生效（项目 → Deployments → 最新记录右侧 ··· → Retry deployment）。

### 6. 验证

浏览器打开 `https://你的项目名.pages.dev`：

1. 点击「未登录，请注册/登录」注册第一个账号（自动成为管理员）
2. 登录后发一帖、回复一帖，回列表确认数据显示正常
3. 点自己帖子右上「编辑」「删帖」按钮验证权限
4. 访问 `https://你的项目名.pages.dev/api/threads?page=1` 应返回 JSON

## 日常维护

- **改代码**：推送 GitHub 自动重新部署
- **改 JWT_SECRET**：所有用户登录态失效，需重新登录
- **备份**：D1 控制台 → Export 下载 SQL 备份
- **注册开关**：当前开放注册，如需关闭可自行在 auth.js 注册入口加校验

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 注册 |
| POST | /api/auth/login | 登录 |
| GET | /api/auth/me | 当前用户 |
| POST | /api/auth/logout | 退出 |
| POST | /api/auth/change-password | 修改密码 |
| GET | /api/threads?page=1 | 帖子列表 |
| POST | /api/threads | 发帖 |
| GET | /api/threads/detail?id=1&rpage=1 | 帖子详情+回复 |
| PUT | /api/threads?id=1 | 编辑帖子 |
| DELETE | /api/threads?id=1 | 删除帖子 |
| GET | /api/replies?thread_id=1&rpage=1 | 回复列表 |
| POST | /api/replies | 发表回复 |
| DELETE | /api/replies?thread_id=1&floor=3 | 删除回复 |
| GET | /api/notify | 我的未读通知 |
| POST | /api/notify/read?id=xxx | 标记已读 |
| POST | /api/notify/clear | 清空通知（管理员） |
| GET | /api/users | 用户列表（管理员） |

> AI生成