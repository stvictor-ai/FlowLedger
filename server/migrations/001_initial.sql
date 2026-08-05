CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invitation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  expires_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '我的账本' CHECK (char_length(name) BETWEEN 1 AND 80),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE INDEX ledgers_user_id_idx ON ledgers(user_id);

CREATE TABLE entries (
  ledger_id UUID NOT NULL,
  user_id UUID NOT NULL,
  id TEXT NOT NULL CHECK (char_length(id) BETWEEN 1 AND 120),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  client_updated_at BIGINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ledger_id, id),
  FOREIGN KEY (ledger_id, user_id) REFERENCES ledgers(id, user_id) ON DELETE CASCADE
);

CREATE INDEX entries_user_ledger_idx ON entries(user_id, ledger_id);
CREATE INDEX entries_server_updated_idx ON entries(ledger_id, server_updated_at);

CREATE TABLE positions (
  ledger_id UUID NOT NULL,
  user_id UUID NOT NULL,
  id TEXT NOT NULL CHECK (char_length(id) BETWEEN 1 AND 120),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  client_updated_at BIGINT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ledger_id, id),
  FOREIGN KEY (ledger_id, user_id) REFERENCES ledgers(id, user_id) ON DELETE CASCADE
);

CREATE INDEX positions_user_ledger_idx ON positions(user_id, ledger_id);
CREATE INDEX positions_server_updated_idx ON positions(ledger_id, server_updated_at);
