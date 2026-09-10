-- 极简论坛 Cloudflare D1 初始化
-- 应用方式：wrangler d1 execute cf-forum-db --file=migrations/0001_init.sql --remote

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

-- (thread_id, floor) 唯一约束：防止并发回帖拿到相同楼层号
CREATE UNIQUE INDEX IF NOT EXISTS idx_replies_thread_floor ON replies(thread_id, floor);
CREATE INDEX IF NOT EXISTS idx_notify_to ON notify(to_uid, is_read);
CREATE INDEX IF NOT EXISTS idx_login_ip ON login_log(ip, ts);