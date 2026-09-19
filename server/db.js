import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { DATA_DIR } from './config.js'

export const db = new DatabaseSync(path.join(DATA_DIR, 'obi.db'))

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('online','github')),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icon TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  github_repo TEXT,
  github_branch TEXT,
  github_token TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sync_at INTEGER,
  sync_error TEXT
);

CREATE TABLE IF NOT EXISTS members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);

CREATE TABLE IF NOT EXISTS note_shares (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
  shared_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, path, user_id)
);
CREATE INDEX IF NOT EXISTS note_shares_user ON note_shares(user_id);

CREATE TABLE IF NOT EXISTS published (
  slug TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  theme TEXT,
  UNIQUE (workspace_id, path)
);

CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS versions_path ON versions(workspace_id, path, created_at);

CREATE TABLE IF NOT EXISTS trash (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  original_path TEXT NOT NULL,
  trash_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  deleted_by TEXT,
  deleted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trash_ws ON trash(workspace_id, deleted_at);

CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`)

// Additive migrations for databases created before a column existed.
function addColumn(table, column, decl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
}
addColumn('published', 'theme', 'TEXT')
addColumn('users', 'email', 'TEXT')
addColumn('users', 'email_verified_at', 'INTEGER')
// A workspace's files live in WORKSPACES_DIR/<id> unless `dir` says where:
// in the desktop app, each workspace is a folder (vault) the user chose.
addColumn('workspaces', 'dir', 'TEXT')

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;

-- A registration waiting for its emailed code. Kept apart from users so an
-- unconfirmed sign-up never becomes an account.
CREATE TABLE IF NOT EXISTS pending_signups (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  username TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- One-time codes sent by email. Only a hash is stored; a code dies after a few
-- wrong guesses or when it expires.
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  subject TEXT,
  email TEXT,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Long-lived sign-ins for apps (the desktop app syncing a vault). Sent as
-- "Authorization: Bearer <token>"; only a hash is stored.
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens(user_id);

-- Desktop app only: the cloud accounts this device is signed in to
CREATE TABLE IF NOT EXISTS cloud_accounts (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  user TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Desktop app only: for each synced file, the version both sides last agreed
-- on. It is the base of three-way merges when both sides changed.
CREATE TABLE IF NOT EXISTS sync_base (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  content BLOB,
  PRIMARY KEY (workspace_id, path)
);
`)

export const now = () => Date.now()

export function one(sql, ...params) {
  return db.prepare(sql).get(...params) ?? null
}
export function all(sql, ...params) {
  return db.prepare(sql).all(...params)
}
export function run(sql, ...params) {
  return db.prepare(sql).run(...params)
}

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function parseJSON(s, fallback = {}) {
  try {
    return s ? JSON.parse(s) : fallback
  } catch {
    return fallback
  }
}
