-- Channels a full scan is limited to (JSON array); NULL means every channel in the workspace.
ALTER TABLE scans ADD COLUMN channels TEXT;
