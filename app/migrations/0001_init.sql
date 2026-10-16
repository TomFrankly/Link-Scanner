-- Emails the admin allows to own a workspace, beyond the owner domains in wrangler.jsonc.
CREATE TABLE allowed_owners (
  email TEXT PRIMARY KEY,
  note TEXT,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);

-- One workspace per owner email, created on the owner's first sign-in.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_email TEXT NOT NULL UNIQUE,
  daily_full_scans INTEGER NOT NULL DEFAULT 5,
  daily_rechecks INTEGER NOT NULL DEFAULT 30,
  max_channels INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL
);

CREATE TABLE members (
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  added_by TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, email)
);
CREATE INDEX members_email ON members (email);

-- Channels and their videos are public data, shared by every workspace that adds them.
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  handle TEXT,
  uploads_playlist TEXT NOT NULL,
  video_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT
);

CREATE TABLE workspace_channels (
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, channel_id)
);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT,
  -- Set on every fetch; a finished channel fetch drops videos not seen since that scan began.
  last_seen TEXT NOT NULL
);
CREATE INDEX videos_channel ON videos (channel_id);

CREATE TABLE video_links (
  video_id TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (video_id, url)
);
CREATE INDEX video_links_url ON video_links (url);

-- Raw check result per URL, shared across workspaces. Rules are applied when reading.
CREATE TABLE links (
  url TEXT PRIMARY KEY,
  outcome TEXT NOT NULL,
  status INTEGER,
  final_url TEXT NOT NULL,
  chain TEXT NOT NULL,
  parked INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  prev_final_url TEXT,
  first_seen TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('accepted', 'redirector', 'ignored', 'disabled')),
  value TEXT NOT NULL,
  value2 TEXT,
  note TEXT,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);
CREATE INDEX rules_workspace ON rules (workspace_id);

CREATE TABLE scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('full', 'all', 'urls')),
  status TEXT NOT NULL CHECK (status IN ('fetching', 'checking', 'done', 'failed')),
  pending_fetch INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX scans_workspace ON scans (workspace_id, created_at);

-- YouTube Data API units used per UTC day, across all workspaces.
CREATE TABLE quota (
  day TEXT PRIMARY KEY,
  units INTEGER NOT NULL DEFAULT 0
);
