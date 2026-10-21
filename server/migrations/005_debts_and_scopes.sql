-- Loans and the repayment plan. Same shape as positions: the client owns the
-- payload, the server keeps rows and tombstones so sync can merge them.

CREATE TABLE debts (
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

CREATE INDEX debts_user_ledger_idx ON debts(user_id, ledger_id);
CREATE INDEX debts_server_updated_idx ON debts(ledger_id, server_updated_at);

-- Debts are more private than cash flows, so reading them is opt-in at token
-- creation: existing tokens stay 'cashflows:read' and keep seeing only cash
-- flows. Scopes are space-separated, OAuth style, and the CHECK lists every
-- allowed combination — there is still no write scope, and adding one means
-- changing this constraint on purpose.
-- No IF EXISTS: 004 declared the CHECK inline, so Postgres named it
-- api_tokens_scope_check. If that ever differs, fail here rather than leave
-- the old CHECK in place to reject the new scope.
ALTER TABLE api_tokens DROP CONSTRAINT api_tokens_scope_check;
ALTER TABLE api_tokens
  ADD CONSTRAINT api_tokens_scope_check
  CHECK (scope IN ('cashflows:read', 'cashflows:read debts:read'));
