ALTER TABLE users
  ADD COLUMN orbit_user_id TEXT;

ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX users_orbit_user_id_idx
  ON users(orbit_user_id)
  WHERE orbit_user_id IS NOT NULL;
