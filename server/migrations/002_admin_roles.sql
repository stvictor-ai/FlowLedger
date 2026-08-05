ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

ALTER TABLE invitation_codes
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

CREATE INDEX users_role_status_idx ON users(role, status);
CREATE INDEX invitation_codes_role_created_idx ON invitation_codes(role, created_at DESC);

