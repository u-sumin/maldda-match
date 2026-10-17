CREATE TABLE IF NOT EXISTS backups (
  code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_expires_at ON backups(expires_at);
