-- Read-only tokens for machines: a home trading desk, an agent, a script.
-- Sessions are for browsers and expire; these do not, so they carry a scope,
-- are pinned to one ledger, and are revocable by hand.

CREATE TABLE api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ledger_id UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- Shown in the UI so a token can be told apart without storing the secret.
  prefix TEXT NOT NULL CHECK (char_length(prefix) BETWEEN 4 AND 16),
  token_hash TEXT NOT NULL UNIQUE,
  -- Only one scope exists today. The CHECK is what stops a future write scope
  -- from being granted by accident rather than on purpose.
  scope TEXT NOT NULL DEFAULT 'cashflows:read' CHECK (scope IN ('cashflows:read')),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX api_tokens_user_id_idx ON api_tokens(user_id);
CREATE INDEX api_tokens_ledger_id_idx ON api_tokens(ledger_id);
CREATE INDEX api_tokens_active_idx ON api_tokens(token_hash) WHERE revoked_at IS NULL;
