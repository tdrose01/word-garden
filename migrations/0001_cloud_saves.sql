CREATE TABLE IF NOT EXISTS cloud_saves (
  account_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  save_json TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  request_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_save_requests (
  account_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  accepted_revision INTEGER NOT NULL CHECK (accepted_revision > 0),
  response_json TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (account_id, request_id)
);

CREATE TABLE IF NOT EXISTS cloud_save_versions (
  account_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  save_json TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (account_id, revision)
);

CREATE INDEX IF NOT EXISTS cloud_save_versions_account_saved
  ON cloud_save_versions (account_id, saved_at DESC);

-- Ephemeral abuse counters; old minute buckets are removed on each request.
-- IP addresses are hashed by the Function and never stored in plaintext.
CREATE TABLE IF NOT EXISTS cloud_save_rate_limits (
  limiter_key TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  requests INTEGER NOT NULL CHECK (requests > 0),
  PRIMARY KEY (limiter_key, bucket)
);
CREATE INDEX IF NOT EXISTS cloud_save_rate_limits_bucket ON cloud_save_rate_limits(bucket);
