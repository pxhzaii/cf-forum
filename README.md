
# 极简论坛（Cloudflare Pages 版）

原 PHP 单文件论坛的完整迁移版：静态前端 + Pages Functions + Cloudflare D1 数据库 + R2 图片存储。功能与原版 1:1（注册/登录、发帖、楼层回复、引用回复、通知、删帖、编辑、双层分页、阅读计数、BBCode、管理员用户列表/改密/清空通知），并修复了原版全部高危漏洞；另新增**图片上传**（存 R2，发帖/回复可直接插图）。

## 架构

```
前端：index.html + app.js + api.js（纯静态）
后端：functions/ 目录下的 Pages Functions（REST API）
存储：Cloudflare D1（SQLite）+ R2（图片）
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

## 部署（7 步）

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

> 注意：`idx_replies_thread_floor` 必须是**唯一索引**才能防止并发回帖拿到相同楼层号（上面 SQL 已含）。

### 4. 创建 R2 存储桶（图片用）

Cloudflare 控制台 → Storage & Databases → R2 Object Storage → Create bucket：

- 名称：`cf-forum-img`（可自定，记下来）

### 5. 创建 Pages 项目

Cloudflare 控制台 → Workers & Pages → Create → Pages → Connect to Git：

- 选择你的仓库 → Begin setup
- **Framework preset**: None
- **Build command**: 留空
- **Build output directory**: `/`
- **Environment variables（Production 和 Preview 都加）**：
  - `JWT_SECRET` = 一串长随机字符串（生成命令：PowerShell 执行 `[Convert]::ToBase64String((1..32 | ForEach-Object {Get-Random -Max 256}) -as [byte[]])`，或 Linux `openssl rand -base64 32`）
- Save and Deploy

### 6. 绑定 D1 与 R2

部署完成后：项目 → Settings → Bindings → Add binding（两个都要加）：

- **Type**: D1 database
  - **Variable name**: `DB`
  - **D1 database**: 选择第 2 步建的 `cf-forum-db`
- **Type**: R2 bucket
  - **Variable name**: `IMG_BUCKET`
  - **R2 bucket**: 选择第 4 步建的 `cf-forum-img`

**注意：** 绑定后需要**重新部署一次**才生效（项目 → Deployments → 最新记录右侧 ··· → Retry deployment）。

### 7. 验证

浏览器打开 `https://你的项目名.pages.dev`：

1. 点击「未登录，请注册/登录」注册第一个账号（自动成为管理员）
2. 登录后发一帖、回复一帖，回列表确认数据显示正常
3. 发帖/回复时点「📎上传图片」选一张图，发布后确认图片正常显示
4. 点自己帖子右上「编辑」「删帖」按钮验证权限
5. 访问 `https://你的项目名.pages.dev/api/threads?page=1` 应返回 JSON

## 日常维护

- **改代码**：推送 GitHub 自动重新部署
- **改 JWT_SECRET**：所有用户登录态失效，需重新登录
- **备份**：D1 控制台 → Export 下载 SQL 备份
- **注册开关**：当前开放注册，如需关闭可自行在 auth.js 注册入口加校验
- **图片管理**：R2 控制台可查看/删除已上传图片；删帖不会自动删 R2 里的图（可定期清理无引用图片）

## 图片上传说明

- 发帖/回复编辑区有「📎上传图片」按钮，选图后自动插入 `[img]...[/img]` 到光标处
- 支持格式：png / jpg / gif / webp，单张 ≤ 5MB
- 图片存 R2，通过 `/api/img/img/<uid>/<文件名>` 访问，带 ETag 304 缓存与一年期 immutable 缓存头
- 上传需登录；外链图片（https + 图片后缀）仍可手动写 [img] 标签引用

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
| POST | /api/upload/image | 上传图片（multipart，字段 file，需登录） |
| GET | /api/img/img/<uid>/<file> | 读取图片（公开） |

