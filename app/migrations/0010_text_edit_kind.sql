-- Saved text edits get a kind: 'lines' (whole lines, from a hand edit; every existing edit) or
-- 'text' (exact text matched anywhere, from the editor's quick edit). See shared/textEdits.ts.
ALTER TABLE text_edits ADD COLUMN kind TEXT NOT NULL DEFAULT 'lines';
