-- The links a scan set out to check (JSON array), so a stalled scan can re-queue what's left.
ALTER TABLE scans ADD COLUMN urls TEXT;
-- How many times the recovery sweep has restarted this scan.
ALTER TABLE scans ADD COLUMN resumes INTEGER NOT NULL DEFAULT 0;
