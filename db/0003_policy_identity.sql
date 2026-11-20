CREATE TABLE policy_acceptances (
  id INTEGER PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id), version TEXT NOT NULL,
  documents TEXT NOT NULL CHECK(json_valid(documents)), method TEXT NOT NULL, accepted_at INTEGER NOT NULL, recorded_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX policy_acceptances_owner ON policy_acceptances(owner,version);
ALTER TABLE sessions ADD COLUMN policy_version TEXT;
CREATE TABLE oauth_flows (digest TEXT PRIMARY KEY, verifier TEXT NOT NULL, method TEXT NOT NULL, country TEXT NOT NULL, version TEXT NOT NULL, started INTEGER NOT NULL, expires INTEGER NOT NULL);
