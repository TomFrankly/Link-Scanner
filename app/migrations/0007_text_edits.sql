-- Saved hand edits to descriptions: "these whole lines become those lines" (shared/textEdits.ts).
-- Applied in the browser before planned link fixes, in the drawer and in exports.
CREATE TABLE text_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  find TEXT NOT NULL,
  replace TEXT NOT NULL,
  -- JSON array of video ids it applies to, or NULL for every video where `find` appears.
  videos TEXT,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);
CREATE INDEX text_edits_workspace ON text_edits (workspace_id);
