-- Lets a planned link fix or a saved text edit apply to one channel's videos instead of the
-- whole workspace. For link fixes, '' means every channel; a fix for a specific channel wins
-- over it for that channel's videos. SQLite can't change a primary key, so link_fixes is rebuilt.
CREATE TABLE link_fixes_new (
  workspace_id TEXT NOT NULL,
  url TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK (action IN ('remove', 'replace')),
  replacement TEXT,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, url, channel_id)
);
INSERT INTO link_fixes_new (workspace_id, url, channel_id, action, replacement, added_by, added_at)
  SELECT workspace_id, url, '', action, replacement, added_by, added_at FROM link_fixes;
DROP TABLE link_fixes;
ALTER TABLE link_fixes_new RENAME TO link_fixes;

-- NULL: every channel.
ALTER TABLE text_edits ADD COLUMN channel_id TEXT;
