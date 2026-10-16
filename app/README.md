# Link Checker (Cloudflare Worker)

Scans the public video descriptions of YouTube channels and flags links that are broken, parked, or redirect somewhere unexpected. Runs on the Workers Free plan.

## How it works

- **Sign-in:** Cloudflare Access sits in front of the Worker and proves each person's email with a one-time code. The Worker verifies Access's signed token on every API call and fails closed if Access isn't configured.
- **Workspaces:** anyone at an `OWNER_DOMAINS` address, the admin (`ADMIN_EMAIL`), or an email the admin allows on the Admin page, gets a workspace on first sign-in. Only the owner can add members (any email). An owner who's removed from the allow list, or whose email stops working, loses access.
- **Scans:** chains of queue messages, each sized to stay inside Workers Free limits (50 outbound requests, 50 D1 queries, 10 ms CPU per invocation):
  - `fetch` messages page through a channel's uploads (50 videos per message) via the YouTube Data API, using the server's API key (public data only).
  - `check` messages follow each link's redirect chain, 6 links per message, grouped by host and spaced per host.
- **Shared results:** a link's check result is stored once and shared by every workspace. Each workspace's exception lists are applied in the browser, so rule changes reclassify instantly.
- **Quota:** each YouTube call is metered against `GLOBAL_DAILY_UNITS` (default 8,000 of the key's 10,000). Each workspace also has daily scan limits and a channel cap, editable on the Admin page. Both daily counts reset at midnight Pacific time, when YouTube resets its own quota.
- **Link fixes:** any link can be replaced or removed in descriptions, for every channel in the workspace or one channel (`link_fixes.channel_id`). In a video's Description tab (Videos view), clicking a link opens a popover to change it.
- **Saved edits:** a hand edit in the Description tab can be saved as a whole-line find-and-replace rule (`shared/textEdits.ts`), for that video or every video whose saved description has the same lines (optionally in one channel). A hand edit that only changes a link is offered as a link fix instead. Rules run before planned link fixes, in the Description tab and the Excel export.
- **Defaults:** app-wide accepted redirects and redirector domains live in `shared/rules.ts` and change with a deploy. A deployment can add its own accepted redirects with the `EXTRA_ACCEPTED_REDIRECTS` var in `wrangler.jsonc` (comma-separated `from>to` pairs, e.g. `old-brand.com>new-brand.com`). Workspaces can turn individual defaults off.

## Layout

| Path | What |
|---|---|
| `worker/` | API (`api.ts`), Access auth (`auth.ts`), scan queue (`scan.ts`), YouTube client (`youtube.ts`), link fetcher (`fetcher.ts`) |
| `shared/` | Link extraction, checking and classification (`core.ts`), default rules (`rules.ts`), description fixes (`fixes.ts`) and saved edits (`textEdits.ts`), used by both Worker and UI |
| `web/` | Svelte 5 + Tailwind 4 + shadcn-svelte UI, built into `dist/` and served as Worker assets |
| `migrations/` | D1 schema |

## Local development

```bash
npm install
cp wrangler.example.jsonc wrangler.jsonc   # if you haven't already
cp .dev.vars.example .dev.vars             # then add your YouTube key and email
npm run db:migrate:local
npm run dev
```

`DEV_AUTH_EMAIL` in `.dev.vars` stands in for Access on localhost only. To act as another user locally, send an `x-dev-email` header. `npm run dev:web` serves the UI with hot reload and proxies `/api` to `wrangler dev` on port 8787.

### Tour videos

The Help tour's looping clips (`web/public/tour/`) are recorded by a script, so they can be re-made after the UI changes:

```bash
npm run demo:record                  # all clips, dark
THEME=light npm run demo:record      # the -light versions
npm run demo:record -- accept fix    # just some clips
```

It runs a separate local copy of the app (`demo/wrangler.demo.jsonc`, port 8790) with made-up data from `demo/seed.sql`, all on the reserved `.example` domain, so no real channel or link is ever filmed. Playwright drives Chromium with a drawn cursor and zooms, and ffmpeg encodes the result. You'll need `ffmpeg` and a Chromium for Playwright (`npx playwright install chromium`, or set `CHROMIUM_PATH`). Each clip's storyboard is a short function in `demo/record.mjs`.

## Your own config

Each deployment keeps its own settings in gitignored files, so pulling updates never overwrites them:

| File | What | Start from |
|---|---|---|
| `wrangler.jsonc` | Worker name, custom domain, admin, owner domains, Access IDs | `wrangler.example.jsonc` |
| `.env` | Optional brand name and logo (build time) | `.env.example` |
| `web/public/brand/` | Your logo file, if you use one | |
| `.dev.vars` | Local dev only: YouTube key and stand-in email | `.dev.vars.example` |

They exist only on the machine you deploy from, so back them up. When a change to `wrangler.example.jsonc` adds a binding or setting, copy it into your `wrangler.jsonc`.

## Deploy your own copy

The repository is just this `app/` folder plus a top-level README and LICENSE; run every command below from `app/`. Everything fits in the Cloudflare **Workers Free** plan and the **Access Free** plan (50 users).

### 1. Prerequisites

- A Cloudflare account. Log Wrangler into it with `npx wrangler login`.
- Node.js 20 or newer.
- A YouTube Data API v3 key: in the [Google Cloud console](https://console.cloud.google.com/), create a project, enable **YouTube Data API v3**, then **Credentials → Create credentials → API key**. Restricting the key to that one API is a good idea. The default quota is 10,000 units a day.

### 2. Configure

```bash
git clone https://github.com/TomFrankly/Link-Scanner.git
cd Link-Scanner/app
npm install
cp wrangler.example.jsonc wrangler.jsonc
```

In `wrangler.jsonc`, set:

- `name`: your Worker's name. It's also your URL: `<name>.<your-subdomain>.workers.dev`.
- `ADMIN_EMAIL`: your email.
- `OWNER_DOMAINS`: comma-separated email domains whose people get their own workspace on first sign-in, or empty to let only you (and the emails you allow) create one.
- `APP_URL`: your workers.dev URL or custom domain (used in notification emails). You can fill it in after the first deploy.

Leave `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` empty for now (step 5).

### 3. Create the database and queue

```bash
npx wrangler d1 create ytlinks
npx wrangler queues create ytlinks-jobs
npm run db:migrate:remote
```

If `d1 create` offers to add the database to your config, say no: `wrangler.jsonc` already refers to it by name. Keep the names `ytlinks` and `ytlinks-jobs`, or change them in `wrangler.jsonc` and in the `db:migrate:*` scripts in `package.json` too.

### 4. Deploy and add the YouTube key

```bash
npm run deploy
npx wrangler secret put YOUTUBE_API_KEY
```

Paste the key when asked. If you keep it in the macOS Keychain, you can pipe it in instead: `security find-generic-password -s <service> -w | npx wrangler secret put YOUTUBE_API_KEY`.

The app now loads at the workers.dev URL that `deploy` printed, but every API call fails with "Cloudflare Access is not configured" until the next step. That's on purpose: the Worker fails closed.

### 5. Turn on Cloudflare Access

Follow [Cloudflare Access setup](#cloudflare-access-setup) below, put the team domain and AUD tag into `wrangler.jsonc`, and `npm run deploy` again. Then sign in with your `ADMIN_EMAIL`, add a channel, and run a scan.

### 6. Optional: custom domain

The domain must be a zone in the same Cloudflare account.

1. In `wrangler.jsonc`, uncomment `routes` and set your hostname, and set `APP_URL` to `https://<that hostname>`.
2. Add the hostname to your Access application: Zero Trust → Access → Applications → the app → Edit → add a public hostname. This keeps the AUD tag unchanged.
3. `npm run deploy`.

### 7. Optional: branding

`cp .env.example .env`, then set `VITE_BRAND_NAME` (shown in the tab title and as the logo's alt text) and, for your own logo, put the file in `web/public/brand/` and set `VITE_LOGO_URL=/brand/<file>`. Without these the app is called "Link Checker" with a plain link logo. `npm run deploy` rebuilds with them.

### Updating

```bash
git pull
npm install
npm run db:migrate:remote
npm run deploy
```

Run migrations before deploying, so the new code never meets an old schema.

### Cloudflare Access setup

1. In the Cloudflare dashboard, open **Workers & Pages → your Worker → Settings → Domains & Routes**, and enable **Cloudflare Access** on the `workers.dev` route. If Zero Trust isn't set up yet, you'll be asked to pick a team name and the Free plan.
2. That creates an Access application. In **Zero Trust → Access → Applications → this app**:
   - Set the policy to **Allow**, include **Everyone**. The app itself decides who gets in.
   - Under login methods, make sure **One-time PIN** is enabled.
3. Copy the application's **AUD tag** and your **team domain** (`<team>.cloudflareaccess.com`) into `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc`, then `npm run deploy`.

A custom domain (`routes` in `wrangler.jsonc`) works alongside the `workers.dev` URL. Every hostname the Worker answers on must be a public hostname of that same Access application (Zero Trust → Access → Applications → the app → Edit). Adding one there keeps the AUD tag unchanged. A hostname Access doesn't cover returns "Not signed in" rather than opening up.

The Access Free plan covers 50 users. Anyone who signs in uses a seat, even if the app then tells them they haven't been invited. Seats can be freed in Zero Trust → Users.

### Admin email notifications (optional)

The admin gets an email when a full scan finishes or any scan fails (`worker/notify.ts`). It's off until both are set:

1. In the Cloudflare dashboard, turn on **Email Routing** for the domain that will send (Compute → Email Service → Email Routing). This adds Cloudflare MX records to that domain. **If the domain already receives email elsewhere, use a domain or subdomain that doesn't**, or its inbox will break.
2. Under **Destination addresses**, add the admin address and click the verification link Cloudflare emails. On Workers Free, sending only works to verified destination addresses.
3. In `wrangler.jsonc`, set `NOTIFY_FROM` to an address on that domain and add:

   ```jsonc
   // destination_address: your ADMIN_EMAIL
   "send_email": [{ "name": "EMAIL", "destination_address": "you@example.com" }]
   ```

4. `npm run deploy`.

### Stalled scans

A cron runs every 10 minutes (`sweepStalledScans`). It re-queues links that a stalled scan hasn't checked (queue messages are dropped after repeated failures), and gives up after three restarts.

### Known limits

- **About 25,000 links per scan.** A scan stores the list of links it checks as one value in D1 (`scans.urls`, used to resume stalled scans), and D1 caps a value at 2 MB. A scan with more distinct links than that fails when checking starts. On Workers Free, the daily queue allowance runs out well before this, so it isn't handled.
