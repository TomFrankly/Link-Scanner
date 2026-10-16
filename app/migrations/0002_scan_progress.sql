-- Live progress details for the scan banner, and inputs for time estimates.
ALTER TABLE scans ADD COLUMN expected_pages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scans ADD COLUMN pages_fetched INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scans ADD COLUMN videos_fetched INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scans ADD COLUMN checking_started_at TEXT;
-- JSON array of the most recently checked links: [{ "u": url, "o": outcome, "s": status }]
ALTER TABLE scans ADD COLUMN recent TEXT;
