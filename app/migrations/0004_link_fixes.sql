-- Per-workspace decisions for a problem link: drop it from descriptions or swap in a new URL.
-- Applied in the browser when generating a fixed description.
CREATE TABLE link_fixes (
  workspace_id TEXT NOT NULL,
  url TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('remove', 'replace')),
  replacement TEXT,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, url)
);

-- Channel avatar URL from YouTube, refreshed on each full scan.
ALTER TABLE channels ADD COLUMN thumbnail TEXT;
