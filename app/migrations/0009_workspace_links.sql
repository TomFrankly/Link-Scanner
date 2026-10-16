-- Check results become private to each workspace: `links` gains workspace_id and each
-- workspace keeps its own result per URL. Existing results are copied to every workspace
-- whose videos use that URL, so nobody has to recheck after this migration.
CREATE TABLE links_new (
  workspace_id TEXT NOT NULL,
  url TEXT NOT NULL,
  outcome TEXT NOT NULL,
  status INTEGER,
  final_url TEXT NOT NULL,
  chain TEXT NOT NULL,
  parked INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  prev_final_url TEXT,
  first_seen TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, url)
);

INSERT OR IGNORE INTO links_new
SELECT DISTINCT wc.workspace_id, l.url, l.outcome, l.status, l.final_url, l.chain, l.parked, l.note, l.prev_final_url, l.first_seen, l.checked_at
FROM links l
JOIN video_links vl ON vl.url = l.url
JOIN videos v ON v.id = vl.video_id
JOIN workspace_channels wc ON wc.channel_id = v.channel_id;

DROP TABLE links;
ALTER TABLE links_new RENAME TO links;
