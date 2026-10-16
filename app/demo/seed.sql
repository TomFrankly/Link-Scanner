-- Made-up data for the tour videos (see demo/record.mjs). Every domain uses the reserved
-- .example TLD, so no real site, company or person appears. The results below are stored
-- as if a scan had already checked each link; nothing is fetched while recording.
--
-- Workspace "Northwind" owned by demo@example.com, one channel, eight videos.

INSERT INTO workspaces (id, name, owner_email, created_at)
VALUES ('demo-ws', 'Northwind', 'demo@example.com', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'));
INSERT INTO members (workspace_id, email, role, added_by, added_at)
VALUES ('demo-ws', 'demo@example.com', 'owner', 'demo@example.com', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'));

-- Channel avatar: an inline SVG, so the recording needs no network.
INSERT INTO channels (id, title, handle, uploads_playlist, video_count, fetched_at, thumbnail)
VALUES ('UCdemoNorthwind000000000', 'Northwind Studio', '@northwindstudio', 'UUdemoNorthwind000000000', 8,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'),
        'data:image/svg+xml,' || replace(replace(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0f766e"/><text x="32" y="41" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">NW</text></svg>',
          '#', '%23'), '"', '%22'));
INSERT INTO workspace_channels (workspace_id, channel_id, added_by, added_at)
VALUES ('demo-ws', 'UCdemoNorthwind000000000', 'demo@example.com', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'));

INSERT INTO videos (id, channel_id, title, published_at, last_seen) VALUES
  ('demoVideo01', 'UCdemoNorthwind000000000', 'My Complete Note-Taking System (2026)', '2026-09-28T15:00:00Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('demoVideo02', 'UCdemoNorthwind000000000', 'Desk Setup Tour: Small Room, Big Workflow', '2026-08-14T15:00:00Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('demoVideo03', 'UCdemoNorthwind000000000', 'How I Plan a Week in 20 Minutes', '2026-07-03T15:00:00Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('demoVideo04', 'UCdemoNorthwind000000000', 'The Best Budget Microphone I''ve Tested', '2026-05-22T15:00:00Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('demoVideo05', 'UCdemoNorthwind000000000', 'Study Smarter, Not Longer', '2026-03-09T15:00:00Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('demoVideo06', 'UCdemoNorthwind000000000', 'Five Apps I Use Every Day', '2025-12-01T15:00:00Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('demoVideo07', 'UCdemoNorthwind000000000', 'Building a Second Brain From Scratch', '2025-09-18T15:00:00Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('demoVideo08', 'UCdemoNorthwind000000000', 'Morning Routine for Creative Work', '2025-06-30T15:00:00Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'));

-- Which links appear in which videos.
INSERT INTO video_links (video_id, url) VALUES
  -- A note app that rebranded: two links make the same domain move (Accept clears both).
  ('demoVideo01', 'https://quillnotes.example/download'),
  ('demoVideo03', 'https://quillnotes.example/download'),
  ('demoVideo05', 'https://quillnotes.example/download'),
  ('demoVideo06', 'https://quillnotes.example/download'),
  ('demoVideo07', 'https://quillnotes.example/download'),
  ('demoVideo01', 'https://quillnotes.example/pricing'),
  ('demoVideo06', 'https://quillnotes.example/pricing'),
  ('demoVideo07', 'https://quillnotes.example/pricing'),
  -- A gear list page that's gone.
  ('demoVideo02', 'https://gearlist.example/northwind-desk'),
  ('demoVideo04', 'https://gearlist.example/northwind-desk'),
  ('demoVideo06', 'https://gearlist.example/northwind-desk'),
  ('demoVideo08', 'https://gearlist.example/northwind-desk'),
  -- An app bought by another company.
  ('demoVideo06', 'https://pixelpal.example/app'),
  ('demoVideo02', 'https://pixelpal.example/app'),
  -- A review page that now lands on the homepage.
  ('demoVideo04', 'https://mapleaudio.example/reviews/m2-mic'),
  ('demoVideo02', 'https://mapleaudio.example/reviews/m2-mic'),
  -- A blog whose domain lapsed.
  ('demoVideo05', 'https://oldstudyblog.example/'),
  -- A store that blocks automated checks.
  ('demoVideo02', 'https://shop.megamart.example/item/48213'),
  ('demoVideo04', 'https://shop.megamart.example/item/48213'),
  ('demoVideo08', 'https://shop.megamart.example/item/48213'),
  -- Links that work.
  ('demoVideo01', 'https://northwind.example/newsletter'),
  ('demoVideo02', 'https://northwind.example/newsletter'),
  ('demoVideo03', 'https://northwind.example/newsletter'),
  ('demoVideo04', 'https://northwind.example/newsletter'),
  ('demoVideo05', 'https://northwind.example/newsletter'),
  ('demoVideo06', 'https://northwind.example/newsletter'),
  ('demoVideo07', 'https://northwind.example/newsletter'),
  ('demoVideo08', 'https://northwind.example/newsletter'),
  ('demoVideo03', 'https://northwind.example/planner'),
  ('demoVideo05', 'https://northwind.example/planner'),
  ('demoVideo07', 'https://notebook.example/templates'),
  ('demoVideo08', 'https://sunrisetimer.example/');

-- Stored check results, in the same shape the checker writes them.
INSERT INTO links (url, outcome, status, final_url, chain, parked, note, first_seen, checked_at) VALUES
  ('https://quillnotes.example/download', 'final', 200, 'https://quill.example/download',
   '[{"u":"https://quillnotes.example/download","s":301},{"u":"https://quill.example/download","s":200}]', 0, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('https://quillnotes.example/pricing', 'final', 200, 'https://quill.example/pricing',
   '[{"u":"https://quillnotes.example/pricing","s":301},{"u":"https://quill.example/pricing","s":200}]', 0, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('https://gearlist.example/northwind-desk', 'final', 404, 'https://gearlist.example/northwind-desk',
   '[{"u":"https://gearlist.example/northwind-desk","s":404}]', 0, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('https://pixelpal.example/app', 'final', 200, 'https://pixelforge.example/',
   '[{"u":"https://pixelpal.example/app","s":301},{"u":"https://pixelforge.example/","s":200}]', 0, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('https://mapleaudio.example/reviews/m2-mic', 'final', 200, 'https://mapleaudio.example/',
   '[{"u":"https://mapleaudio.example/reviews/m2-mic","s":301},{"u":"https://mapleaudio.example/","s":200}]', 0, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('https://oldstudyblog.example/', 'final', 200, 'https://oldstudyblog.example/',
   '[{"u":"https://oldstudyblog.example/","s":200}]', 1, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('https://shop.megamart.example/item/48213', 'final', 403, 'https://shop.megamart.example/item/48213',
   '[{"u":"https://shop.megamart.example/item/48213","s":403}]', 0, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('https://northwind.example/newsletter', 'final', 200, 'https://northwind.example/newsletter',
   '[{"u":"https://northwind.example/newsletter","s":200}]', 0, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('https://northwind.example/planner', 'final', 200, 'https://northwind.example/planner',
   '[{"u":"https://northwind.example/planner","s":200}]', 0, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('https://notebook.example/templates', 'final', 200, 'https://notebook.example/templates',
   '[{"u":"https://notebook.example/templates","s":200}]', 0, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')),
  ('https://sunrisetimer.example/', 'final', 200, 'https://sunrisetimer.example/',
   '[{"u":"https://sunrisetimer.example/","s":200}]', 0, NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'));

-- A finished scan, so the report says when it last ran.
INSERT INTO scans (workspace_id, kind, status, total, done, created_by, created_at, updated_at, finished_at)
VALUES ('demo-ws', 'full', 'done', 11, 11, 'demo@example.com',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours', '-6 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'));

-- Saved descriptions (a full scan stores these), used by the Excel export's Descriptions sheet.
UPDATE videos SET description_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), description =
'Here''s my full desk setup for 2026, built for a small room and a big workflow.

🛠 GEAR IN THIS VIDEO
Full gear list: https://gearlist.example/northwind-desk
Microphone review: https://mapleaudio.example/reviews/m2-mic
Desk lamp: https://shop.megamart.example/item/48213
Editing app I use: https://pixelpal.example/app

📬 Get my weekly newsletter: https://northwind.example/newsletter' WHERE id = 'demoVideo02';
UPDATE videos SET description_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), description =
'The note-taking system I use for everything, from video ideas to my reading list.

Get Quill Notes: https://quillnotes.example/download
Pricing: https://quillnotes.example/pricing

📬 Newsletter: https://northwind.example/newsletter' WHERE id = 'demoVideo01';
