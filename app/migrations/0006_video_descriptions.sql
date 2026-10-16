-- Each video's description as of its last fetch, for exports. A full scan already downloads
-- descriptions to find links, so saving them costs no extra YouTube quota. Opening a video in
-- the Fix description drawer refreshes its copy too.
ALTER TABLE videos ADD COLUMN description TEXT;
ALTER TABLE videos ADD COLUMN description_at TEXT;
