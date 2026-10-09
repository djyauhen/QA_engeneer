export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    login TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ТЛ', 'QA'))
  )`,
  `CREATE TABLE IF NOT EXISTS catalog_cache (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    rows JSONB NOT NULL,
    refreshed_at TIMESTAMPTZ NOT NULL
  )`,
  `ALTER TABLE catalog_cache ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `CREATE TABLE IF NOT EXISTS catalog_query (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    query JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY,
    human_id TEXT NOT NULL,
    owner_login TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reports_human_created ON reports (human_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS admin_rules (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    rules JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cost_entries (
    id UUID PRIMARY KEY,
    provider_usage JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL
  )`,
];
