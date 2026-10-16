// Records the short looping videos shown in the Help tour (web/public/tour/*.mp4, plus a poster
// .jpg each; dark by default, `THEME=light` for the -light versions).
//
//   npm run demo:record            build, reset demo data, start the demo server, record all clips
//   npm run demo:record -- accept  record only the named clip(s)
//
// How it works:
// 1. Builds the UI with neutral branding into demo/dist and runs it under `wrangler dev` with
//    demo/wrangler.demo.jsonc: its own database (demo/.state) seeded from demo/seed.sql, so only
//    made-up data is ever filmed. The dev sign-in bypass (localhost only) signs in demo@example.com.
// 2. Drives a real Chromium with Playwright. A drawn cursor glides to each target (headless
//    browsers don't draw one), and a "camera" zooms the page with a CSS transform, so text stays
//    sharp instead of upscaling video.
// 3. Captures frames with the Chrome DevTools screencast (lossless PNGs with timestamps), then
//    ffmpeg turns them into a constant-frame-rate loop with a fade at each end.
//
// Needs: ffmpeg on PATH, and Chromium for Playwright (`npx playwright install chromium`, or
// point CHROMIUM_PATH at any Chrome/Chromium binary).
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const APP = fileURLToPath(new URL('..', import.meta.url));
const DEMO = join(APP, 'demo');
const OUT = join(APP, 'web/public/tour');
const PORT = 8790;
const ORIGIN = `http://localhost:${PORT}`;
const VIEWPORT = { width: 960, height: 600 }; // the app's tablet layout reads well when shrunk into the tour
const SCALE = 2; // device pixels per CSS pixel while recording
const OUT_WIDTH = 1152; // 2x the tour's video slot
const FPS = 30;
const FADE_S = 0.35;
const THEME = process.env.THEME === 'light' ? 'light' : 'dark';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args, '-c', 'demo/wrangler.demo.jsonc', '--persist-to', 'demo/.state'], { cwd: APP, stdio: 'pipe' });

// ---------- demo server ----------

async function startServer() {
  console.log('Building the UI with neutral branding…');
  execFileSync('npx', ['vite', 'build', '--outDir', '../demo/dist'], {
    cwd: APP,
    stdio: 'pipe',
    env: { ...process.env, VITE_BRAND_NAME: '', VITE_LOGO_URL: '', VITE_REPO_URL: '' },
  });
  console.log('Resetting the demo database…');
  rmSync(join(DEMO, '.state'), { recursive: true, force: true });
  wrangler(['d1', 'migrations', 'apply', 'ytlinks-demo', '--local']);
  wrangler(['d1', 'execute', 'ytlinks-demo', '--local', '--file', 'demo/seed.sql']);
  console.log('Starting the demo server…');
  const server = spawn(
    'npx',
    ['wrangler', 'dev', '-c', 'demo/wrangler.demo.jsonc', '--persist-to', 'demo/.state', '--port', String(PORT),
      '--local-upstream', `localhost:${PORT}`, '--var', 'DEV_AUTH_EMAIL:demo@example.com'],
    { cwd: APP, stdio: 'ignore', detached: true },
  );
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${ORIGIN}/api/me`)).ok) return server;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('The demo server did not start');
}

/** Puts the seeded workspace back to its starting state between clips (clips add rules, fixes and edits). */
async function resetWorkspace() {
  const members = await (await fetch(`${ORIGIN}/api/w/demo-ws/members`)).json();
  for (const m of members.members ?? members)
    if (m.role !== 'owner') await fetch(`${ORIGIN}/api/w/demo-ws/members/${encodeURIComponent(m.email)}`, { method: 'DELETE' });
  const report = await (await fetch(`${ORIGIN}/api/w/demo-ws`)).json();
  for (const rule of report.rules) await fetch(`${ORIGIN}/api/w/demo-ws/rules/${rule.id}`, { method: 'DELETE' });
  for (const fix of report.fixes)
    await fetch(`${ORIGIN}/api/w/demo-ws/fixes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: fix.url, action: 'clear' }),
    });
  for (const edit of report.textEdits ?? []) await fetch(`${ORIGIN}/api/w/demo-ws/text-edits/${edit.id}`, { method: 'DELETE' });
}

// ---------- in-page helpers: cursor and camera ----------

// Runs inside the page. Adds a drawn cursor and window.__demo with a "camera" that zooms and
// pans <body> with an eased CSS transform. The cursor lives inside <body> in page coordinates,
// so it zooms and pans with the content and always stays on its target.
function installHelpers() {
  const style = document.createElement('style');
  style.textContent = `
    html, * { scrollbar-width: none; }
    body { transform-origin: 0 0; }
    #demo-cursor { position: absolute; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
      transition-property: transform; transition-timing-function: cubic-bezier(.45,0,.2,1); }
    #demo-cursor svg { display: block; transition: transform 120ms ease-out; transform-origin: 4px 3px;
      filter: drop-shadow(0 1px 2px rgb(0 0 0 / .35)); }
    #demo-cursor.down svg { transform: scale(.8); }
    .demo-ripple { position: absolute; z-index: 2147483646; pointer-events: none; width: 30px; height: 30px; margin: -15px 0 0 -15px;
      border-radius: 9999px; background: rgb(255 255 255 / .25); border: 1.5px solid rgb(255 255 255 / .8);
      animation: demo-ripple 500ms ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.3); opacity: 0 } }`;
  document.documentElement.append(style);

  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  cursor.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22"><path d="M4 2.5v15.2l4.1-3.9 2.6 6 2.7-1.2-2.6-5.9 5.7-.3z"
    fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  document.body.append(cursor);

  let cam = { s: 1, tx: 0, ty: 0 };
  window.__demo = {
    /** Moves the drawn cursor to a page (document) point. */
    cursorTo(x, y, ms) {
      cursor.style.transitionDuration = `${ms}ms`;
      cursor.style.transform = `translate(${x - 4}px, ${y - 3}px)`;
    },
    press(down) {
      cursor.classList.toggle('down', down);
    },
    ripple(x, y) {
      const r = document.createElement('div');
      r.className = 'demo-ripple';
      r.style.left = `${x}px`;
      r.style.top = `${y}px`;
      document.body.append(r);
      setTimeout(() => r.remove(), 600);
    },
    /** Zooms so a page point ends up centered on screen, kept within the page's edges. */
    zoom(s, x, y, ms) {
      const vw = innerWidth, vh = innerHeight;
      let tx = vw / 2 + scrollX - x * s;
      let ty = vh / 2 + scrollY - y * s;
      // Layout size, which a transform doesn't change (scrollWidth/scrollHeight would include it).
      const w = vw * s, h = Math.max(document.body.offsetHeight, vh) * s;
      tx = Math.min(scrollX, Math.max(tx, scrollX + vw - w));
      ty = Math.min(scrollY, Math.max(ty, scrollY + vh - h));
      if (s === 1) tx = ty = 0;
      document.body.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1)`;
      document.body.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      cam = { s, tx, ty };
    },
    scale() {
      return cam.s;
    },
    /** The page point under a screen point, given the current camera. */
    toPage(x, y) {
      return { x: (x + scrollX - cam.tx) / cam.s, y: (y + scrollY - cam.ty) / cam.s };
    },
    /** Where a page point appears on screen once the camera settles. */
    onScreen(x, y) {
      return { x: x * cam.s + cam.tx - scrollX, y: y * cam.s + cam.ty - scrollY };
    },
    scrollTo(y, ms) {
      if (ms <= 0) return void scrollTo(0, y);
      return new Promise((done) => {
        const from = scrollY, start = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - start) / ms);
          const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          scrollTo(0, from + (y - from) * e);
          t < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      });
    },
  };
}

/** A small "director" API that clips use: move the cursor, click, zoom, scroll, wait. */
function director(page) {
  // Cursor position in page (document) coordinates.
  let cursor = { x: VIEWPORT.width * 0.72, y: VIEWPORT.height * 0.85 };
  /**
   * Center of an element in page coordinates. Measured where it really is on screen, then
   * mapped back through the camera, which also works for menus and dialogs that float above
   * the page. Call it while the camera is still (every zoom awaits its animation).
   */
  const pagePoint = (locator, offset = { x: 0, y: 0 }) =>
    locator.evaluate((el, o) => {
      const r = el.getBoundingClientRect();
      const p = window.__demo.toPage(r.left + r.width / 2, r.top + r.height / 2);
      return { x: p.x + o.x, y: p.y + o.y };
    }, offset);
  /** Points the real mouse at the cursor's on-screen spot, so hover states (tooltips) appear. */
  const syncMouse = async (steps) => {
    const p = await page.evaluate(([x, y]) => window.__demo.onScreen(x, y), [cursor.x, cursor.y]);
    await page.mouse.move(p.x, p.y, { steps });
  };
  return {
    wait: (ms) => sleep(ms),
    /** Glides the cursor to an element. Optionally pans the camera along with it. */
    async move(locator, ms = 700, { offset, zoom: zoomTo, zoomOffset = { x: 0, y: 0 } } = {}) {
      let zoom = zoomTo;
      cursor = await pagePoint(locator, offset);
      if (!zoom) {
        // Safety net: if the target is outside the zoomed-in view, pan to it at the same zoom.
        const scale = await page.evaluate(() => window.__demo.scale());
        const p = await page.evaluate(([x, y]) => window.__demo.onScreen(x, y), [cursor.x, cursor.y]);
        const m = 40;
        if (scale > 1 && (p.x < m || p.y < m || p.x > VIEWPORT.width - m || p.y > VIEWPORT.height - m)) zoom = scale;
      }
      if (zoom)
        await page.evaluate(([s, x, y, ms]) => window.__demo.zoom(s, x, y, ms), [zoom, cursor.x + zoomOffset.x, cursor.y + zoomOffset.y, ms]);
      await page.evaluate(([x, y, ms]) => window.__demo.cursorTo(x, y, ms), [cursor.x, cursor.y, ms]);
      await sleep(ms);
      await syncMouse(4);
    },
    async click() {
      await syncMouse(1); // the camera may have moved since the cursor arrived
      await page.evaluate(() => window.__demo.press(true));
      await sleep(120);
      await page.evaluate(([x, y]) => window.__demo.ripple(x, y), [cursor.x, cursor.y]);
      await page.mouse.down();
      await page.mouse.up();
      await page.evaluate(() => window.__demo.press(false));
    },
    /** Zooms the camera toward an element (or back to the full page with scale 1). */
    async zoom(scale, locator, ms = 900, offset) {
      const c = locator ? await pagePoint(locator, offset) : { x: 0, y: 0 };
      await page.evaluate(([s, x, y, ms]) => window.__demo.zoom(s, x, y, ms), [scale, c.x, c.y, ms]);
      await sleep(ms);
    },
    async scrollTo(locator, ms = 800, margin = 12) {
      const top = locator ? (await pagePoint(locator)).y - margin - 14 : 0;
      await page.evaluate(([y, ms]) => window.__demo.scrollTo(y, ms), [Math.max(0, top), ms]);
      await sleep(ms);
    },
    /** Types into the focused field like a person would. */
    async type(text, perKeyMs = 55) {
      await page.keyboard.type(text, { delay: perKeyMs });
    },
    async placeCursor() {
      await page.evaluate(([x, y]) => window.__demo.cursorTo(x, y, 0), [cursor.x, cursor.y]);
      await syncMouse(1);
    },
  };
}

// ---------- clips ----------

// ---------- stand-ins for YouTube ----------
// The demo server has no YouTube API key, so the few requests that would call YouTube are
// answered here, inside the recording browser only. The app's own code is unchanged.

const svgData = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const SHORTS_AVATAR = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#7c3aed"/><text x="32" y="41" font-family="system-ui,sans-serif" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">NS</text></svg>',
);
const THUMB_COLORS = ['#0f766e', '#9333ea', '#c2410c', '#1d4ed8', '#be123c', '#4d7c0f', '#0369a1', '#a16207'];

/** Video thumbnails: a colored card per made-up video instead of i.ytimg.com. */
async function stubThumbnails(page) {
  await page.route('https://i.ytimg.com/**', (route) => {
    const n = Number(route.request().url().match(/demoVideo(\d+)/)?.[1] ?? 1);
    const color = THUMB_COLORS[(n - 1) % THUMB_COLORS.length];
    route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="${color}"/>
        <circle cx="160" cy="90" r="26" fill="rgb(255 255 255 / .9)"/><path d="M152 76v28l22-14z" fill="${color}"/></svg>`,
    });
  });
}

const DESCRIPTIONS = {
  demoVideo02: `Here's my full desk setup for 2026, built for a small room and a big workflow.

🛠 GEAR IN THIS VIDEO
Full gear list: https://gearlist.example/northwind-desk
Microphone review: https://mapleaudio.example/reviews/m2-mic
Desk lamp: https://shop.megamart.example/item/48213
Editing app I use: https://pixelpal.example/app

📬 Get my weekly newsletter: https://northwind.example/newsletter

Thanks for watching!`,
};

/** A fake scan whose progress advances each time the banner polls. */
function stubScan(page) {
  const started = new Date().toISOString();
  const recent = (items) => JSON.stringify(items.map(([u, s]) => ({ u, o: 'final', s })));
  const states = [
    { status: 'fetching', pages_fetched: 0, videos_fetched: 0, total: 0, done: 0, recent: null },
    { status: 'checking', pages_fetched: 1, videos_fetched: 8, total: 11, done: 4,
      recent: recent([['https://northwind.example/newsletter', 200], ['https://gearlist.example/northwind-desk', 404], ['https://quillnotes.example/download', 200], ['https://northwind.example/planner', 200]]) },
    { status: 'checking', pages_fetched: 1, videos_fetched: 8, total: 11, done: 9,
      recent: recent([['https://shop.megamart.example/item/48213', 403], ['https://mapleaudio.example/reviews/m2-mic', 200], ['https://notebook.example/templates', 200], ['https://sunrisetimer.example/', 200]]) },
  ];
  let step = 0;
  const state = () => {
    const s = states[Math.min(step, states.length - 1)];
    return {
      scan: { id: 99, workspace_id: 'demo-ws', kind: 'full', pending_fetch: 1, error: null, created_by: 'demo@example.com',
        created_at: started, updated_at: new Date().toISOString(), finished_at: null, expected_pages: 1,
        checking_started_at: s.status === 'checking' ? started : null, urls: null, resumes: 0, channels: null, ...s },
      limits: { fullScans: 5, rechecks: 30, maxChannels: 5 },
      usedToday: { full: 1, rechecks: 0 },
    };
  };
  const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  return Promise.all([
    page.route('**/api/w/demo-ws/scans', (route) => json(route, { id: 99, ...state() })),
    page.route('**/api/w/demo-ws/scan', (route) => {
      step++;
      json(route, state());
    }),
  ]);
}

// ---------- clips ----------
// Each clip names the page it starts on, an optional `setup` (runs before filming, e.g. to
// scroll into place or add stand-ins) and a `run` that is filmed.

// The report is an inbox: a list pane of links (or videos) and a content pane for the picked one.
const linkRow = (page, url) => page.locator(`[data-link="${url}"]`);
const videoRow = (page, id) => page.locator(`[data-video="${id}"]`);
const linkPane = (page) => page.locator('section[aria-label="Link"]');

const CLIPS = {
  /** Tour step "Add your channels": paste a handle, add it, and it's ready to scan. */
  channels: {
    route: 'channels',
    async setup(page) {
      let added = false;
      await page.route('**/api/w/demo-ws/channels', (route) => {
        added = true;
        route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'UCdemoShorts0000000000000', title: 'Northwind Shorts' }) });
      });
      await page.route('**/api/w/demo-ws', async (route) => {
        const response = await route.fetch();
        const report = await response.json();
        if (added)
          report.channels.push({ id: 'UCdemoShorts0000000000000', title: 'Northwind Shorts', handle: '@northwindshorts',
            thumbnail: SHORTS_AVATAR, videoCount: 24, fetchedAt: null });
        route.fulfill({ response, json: report });
      });
    },
    async run(page, d) {
      const input = page.getByPlaceholder('@handle or youtube.com channel link');
      const add = page.getByRole('button', { name: 'Add channel' });
      await d.wait(600);
      // Frame the right side of the form, so the field and the Add button are both in view.
      await d.zoom(1.5, add, 900, { x: -250, y: -60 });
      await d.move(input, 700, { offset: { x: -40, y: 0 } });
      await d.click();
      await d.type('@northwindshorts');
      await d.wait(300);
      await d.move(add, 600);
      await d.click();
      await d.wait(900);
      const scan = page.locator('div', { hasText: 'Northwind Shorts' }).getByRole('button', { name: 'Scan', exact: true }).last();
      await d.move(scan, 900, { zoom: 1.6, zoomOffset: { x: -140, y: 0 } });
      await d.wait(1600); // the tooltip: scans just this channel
      await d.zoom(1, null, 800);
      await d.wait(900);
    },
  },

  /** Tour step "Run a scan": Rescan → Full scan, then the progress banner. */
  scan: {
    route: 'report',
    async setup(page) {
      await stubScan(page);
    },
    async run(page, d) {
      const rescan = page.getByRole('button', { name: 'Rescan' });
      await d.wait(600);
      await d.move(rescan, 900, { zoom: 1.5, zoomOffset: { x: -120, y: 60 } });
      await d.click();
      await d.wait(500);
      await d.move(page.getByRole('menuitem', { name: /Full scan/ }), 600);
      await d.wait(500);
      await d.click();
      await d.wait(400);
      // Frame the whole banner: steps, counter, progress bar and the ticker of checked links.
      await d.zoom(1.25, page.getByText('Check links').first(), 900, { x: 210, y: 30 });
      await d.wait(6200); // counters climb as the banner polls; the ticker lists links as they're checked
      await d.zoom(1, null, 800);
      await d.wait(500);
    },
  },

  /** Tour step "Read the report": filter by a status, pick a link, and hover its status for what it means. */
  report: {
    route: 'report',
    async run(page, d) {
      const broken = page.locator('section[aria-labelledby="health-heading"]').getByRole('button', { name: /^Broken/ }).last();
      await d.wait(600);
      await d.move(broken, 900, { zoom: 1.6, zoomOffset: { x: -120, y: 60 } });
      await d.wait(900); // the legend's tooltip names the status
      await d.click(); // show only broken links
      await d.wait(500);
      await d.zoom(1, null, 700);
      await d.move(page.locator('[data-link]').nth(1), 800);
      await d.click(); // the content pane shows the link, where it goes and its videos
      await d.wait(700);
      const badge = linkPane(page).locator('header').getByRole('button').first();
      await d.move(badge, 900, { zoom: 1.7, zoomOffset: { x: 140, y: 30 } });
      await d.wait(1800); // the tooltip explains the status
      await d.zoom(1, null, 800);
      await d.wait(600);
    },
  },

  /** Tour step "Mark what's expected": accept a rebrand, and both links making that move clear. */
  accept: {
    route: 'report',
    async run(page, d) {
      // The first link in the list, already open: quillnotes.example → quill.example.
      const accept = linkPane(page).getByRole('button', { name: 'Accept' });
      await d.wait(700);
      // Centered a little lower, so the link and its "quillnotes.example → quill.example" note stay in view.
      await d.move(accept, 1000, { zoom: 1.6, zoomOffset: { x: -120, y: 60 } });
      await d.wait(1500); // the tooltip explains what Accept does
      await d.click();
      await d.wait(800);
      await d.zoom(1, null, 900);
      await d.wait(1800); // both quillnotes links left the list; the headline counts fewer
    },
  },

  /** Tour step "Plan your fixes": give a broken link its replacement. */
  fix: {
    route: 'report',
    async run(page, d) {
      await d.wait(600);
      await d.move(linkRow(page, 'https://gearlist.example/northwind-desk'), 900);
      await d.click();
      await d.wait(600);
      await d.move(linkPane(page).getByRole('button', { name: /Plan fix/ }), 900, { zoom: 1.5, zoomOffset: { x: -160, y: 90 } });
      await d.click();
      await d.wait(500);
      await d.move(page.getByRole('menuitem', { name: 'Replace with a different link…' }), 600);
      await d.wait(300);
      await d.click();
      await d.zoom(1, null, 600);
      await d.type('https://gearlist.example/desk-2026', 40);
      await d.wait(500);
      await page.keyboard.press('Enter');
      await d.wait(700);
      await d.move(linkPane(page).getByText('desk-2026').first(), 900, { zoom: 1.6, zoomOffset: { x: 60, y: 0 } });
      await d.wait(1600); // the planned replacement now shows under the link
      await d.zoom(1, null, 800);
      await d.wait(500);
    },
  },

  /** Tour step "Fix the descriptions": open a video's description with its fixes highlighted, copy it, and focus. */
  descriptions: {
    route: 'report',
    async setup(page) {
      await page.route('**/api/w/demo-ws/videos/*/description', (route) => {
        const id = decodeURIComponent(route.request().url().split('/videos/')[1].split('/')[0]);
        route.fulfill({ contentType: 'application/json', body: JSON.stringify({ description: DESCRIPTIONS[id] ?? DESCRIPTIONS.demoVideo02 }) });
      });
    },
    async run(page, d) {
      await d.wait(500);
      await d.move(page.getByRole('tab', { name: 'Videos' }), 800);
      await d.click(); // the list switches to videos
      await d.wait(700);
      await d.move(videoRow(page, 'demoVideo02'), 800);
      await d.click(); // its description opens with the planned fixes applied and highlighted
      await d.wait(1200);
      const editor = page.locator('.cm-content');
      await d.move(editor, 900, { zoom: 1.4, offset: { x: -60, y: -40 } });
      await d.wait(1400);
      await d.move(page.getByRole('button', { name: 'Copy', exact: true }), 800, { zoom: 1.4 });
      await d.click();
      await d.wait(1000); // "Description copied"
      await d.zoom(1, null, 700);
      await d.move(page.getByRole('button', { name: 'Hide the list' }), 800);
      await d.click(); // focus mode: just the video, with arrows to the next one
      await d.wait(1600);
    },
  },

  /** Tour step "Share and export": add a teammate, then export the report. */
  share: {
    route: 'members',
    async run(page, d) {
      const input = page.getByPlaceholder('name@example.com');
      const add = page.getByRole('button', { name: 'Add member' });
      await d.wait(600);
      await d.zoom(1.5, add, 900, { x: -250, y: -40 });
      await d.move(input, 700, { offset: { x: -40, y: 0 } });
      await d.click();
      await d.type('alex@example.com');
      await d.move(add, 600);
      await d.click();
      await d.wait(1300); // Alex is now a member
      await d.zoom(1, null, 700);
      await d.move(page.getByRole('link', { name: 'Report' }), 800);
      await d.click();
      await d.wait(700);
      await d.move(page.getByRole('button', { name: 'Export' }), 800, { zoom: 1.5, zoomOffset: { x: -100, y: 80 } });
      await d.click();
      await d.wait(400);
      await d.move(page.getByRole('menuitem', { name: 'Excel workbook' }), 600);
      await d.wait(1300);
      await d.zoom(1, null, 700);
      await d.wait(300);
    },
  },
};

// ---------- recording and encoding ----------

async function record(browser, name) {
  await resetWorkspace();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: THEME });
  await context.addInitScript((theme) => localStorage.setItem('mode-watcher-mode', theme), THEME);
  const page = await context.newPage();
  await stubThumbnails(page);
  await page.goto(`${ORIGIN}/#/${CLIPS[name].route ?? 'report'}`);
  await page.locator('h1').first().waitFor();
  await page.evaluate(installHelpers);
  const d = director(page);
  await CLIPS[name].setup?.(page, d);
  await d.placeCursor();
  await sleep(400);

  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'png',
    maxWidth: VIEWPORT.width * SCALE,
    maxHeight: VIEWPORT.height * SCALE,
    everyNthFrame: 1,
  });
  const start = Date.now() / 1000;
  try {
    await CLIPS[name].run(page, d);
  } catch (e) {
    const shot = join(tmpdir(), `demo-${name}-error.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    throw new Error(`Clip "${name}" failed (screenshot: ${shot}): ${e.message}`);
  }
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await context.close();
  return { frames, start, end };
}

/** Writes the frames with their real durations, then encodes WebM + MP4 + a poster image. */
function encode(name, { frames, start, end }) {
  const dir = join(DEMO, '.frames', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const list = [];
  frames.forEach((f, i) => {
    const file = join(dir, `${String(i).padStart(5, '0')}.png`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    const from = i === 0 ? Math.min(f.t, start) : f.t;
    list.push(`file '${file}'`, `duration ${Math.max(0.001, next - from).toFixed(4)}`);
  });
  list.push(`file '${join(dir, `${String(frames.length - 1).padStart(5, '0')}.png`)}'`); // concat needs the last frame twice
  const listFile = join(dir, 'frames.txt');
  writeFileSync(listFile, list.join('\n'));
  const total = end - Math.min(frames[0].t, start);
  const bg = THEME === 'dark' ? '0x0a0a0a' : 'white';
  const vf = [
    `fps=${FPS}`,
    `scale=${OUT_WIDTH}:-2:flags=lanczos`,
    `fade=t=in:st=0:d=${FADE_S}:color=${bg}`,
    `fade=t=out:st=${(total - FADE_S).toFixed(3)}:d=${FADE_S}:color=${bg}`,
    'format=yuv420p',
  ].join(',');
  const suffix = THEME === 'dark' ? '' : '-light';
  mkdirSync(OUT, { recursive: true });
  const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
  // H.264 MP4 plays everywhere; `-tune animation` suits flat UI and keeps clips small.
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-vf', vf, '-c:v', 'libx264', '-crf', '27', '-preset', 'slow', '-tune', 'animation',
    '-movflags', '+faststart', '-an', join(OUT, `${name}${suffix}.mp4`)]);
  ff(['-i', join(dir, '00000.png'), '-vf', `scale=${OUT_WIDTH}:-2:flags=lanczos`, '-q:v', '4', join(OUT, `${name}${suffix}.jpg`)]);
  console.log(`  ${name}${suffix}: ${frames.length} frames, ${total.toFixed(1)}s`);
}

async function main() {
  const names = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const reuse = process.argv.includes('--reuse'); // use a demo server that's already running
  const todo = names.length ? names : Object.keys(CLIPS);
  for (const n of todo) if (!CLIPS[n]) throw new Error(`Unknown clip "${n}". Clips: ${Object.keys(CLIPS).join(', ')}`);

  // The browser first: if it can't start, there's no server left running.
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const server = reuse ? null : await startServer().catch(async (e) => {
    await browser.close();
    throw e;
  });
  try {
    for (const name of todo) {
      console.log(`Recording ${name} (${THEME})…`);
      encode(name, await record(browser, name));
    }
  } finally {
    await browser.close();
    if (server) process.kill(-server.pid);
    if (existsSync(join(DEMO, '.frames'))) rmSync(join(DEMO, '.frames'), { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
