-- "Mark as working": a rule type for one exact link someone checked by hand (shared/rules.ts).
-- SQLite can't change a CHECK constraint in place, so the rules table is rebuilt with the
-- new type allowed; every existing rule is copied over with its id.
CREATE TABLE rules_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('accepted', 'redirector', 'ignored', 'disabled', 'working')),
  value TEXT NOT NULL,
  value2 TEXT,
  note TEXT,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);
INSERT INTO rules_new (id, workspace_id, type, value, value2, note, added_by, added_at)
  SELECT id, workspace_id, type, value, value2, note, added_by, added_at FROM rules;
DROP TABLE rules;
ALTER TABLE rules_new RENAME TO rules;
CREATE INDEX rules_workspace ON rules (workspace_id);
