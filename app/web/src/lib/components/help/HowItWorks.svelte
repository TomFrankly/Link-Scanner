<script lang="ts">
  // The four "How it works" pages in Help: what a scan does, where the app runs, privacy and
  // safety, and why some links can't be verified. Each topic has a short plain-language summary
  // and a "Learn more" disclosure for people who want the details (what Cloudflare Workers, D1
  // and Access are, how YouTube's allowance works). Keep the numbers here in sync with the code
  // they describe (noted beside each one); every page ends with links to that code.
  import Server from '@lucide/svelte/icons/server';
  import Layers from '@lucide/svelte/icons/layers';
  import Database from '@lucide/svelte/icons/database';
  import Eye from '@lucide/svelte/icons/eye';
  import Lock from '@lucide/svelte/icons/lock';
  import Users from '@lucide/svelte/icons/users';
  import Gauge from '@lucide/svelte/icons/gauge';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Bot from '@lucide/svelte/icons/bot';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Timer from '@lucide/svelte/icons/timer';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
  import type { Component, Snippet } from 'svelte';
  import type { HelpPage } from '$lib/store.svelte';
  import { brand } from '$lib/brand';
  import { CATEGORY } from '$lib/categories';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import GitHubMark from './GitHubMark.svelte';
  import More from './More.svelte';

  let { page }: { page: Exclude<HelpPage, 'tour' | 'studio'> } = $props();

  const repo = brand.repo.replace(/\/$/, '');
  // The code behind each page, linked at its end.
  const SOURCES: Record<typeof page, [string, string][]> = {
    scan: [
      ['worker/youtube.ts', 'Reads videos from YouTube'],
      ['shared/core.ts', 'Finds, follows and sorts links'],
      ['worker/fetcher.ts', 'Visits links, politely'],
    ],
    runs: [
      ['worker/index.ts', 'The Worker’s entry point'],
      ['worker/scan.ts', 'Scan jobs and the stall check'],
      ['migrations', 'The database tables'],
    ],
    privacy: [
      ['worker/auth.ts', 'Checks who you are'],
      ['worker/api.ts', 'Workspaces and daily limits'],
      ['worker/fetcher.ts', 'Refuses internal addresses'],
    ],
    verify: [
      ['shared/core.ts', 'Which answers count as “Could not verify”'],
      ['worker/fetcher.ts', 'Per-site waits'],
    ],
  };
</script>

<!-- A topic: icon, title, summary, then optional "Learn more" details. -->
{#snippet topic(Icon: Component, title: string, text: string, more?: Snippet, moreLabel = 'Learn more')}
  <div class="flex gap-3">
    <span class="bg-muted mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md"><Icon class="size-3.5" /></span>
    <div class="min-w-0 flex-1">
      <div class="font-medium">{title}</div>
      <p class="text-muted-foreground mt-0.5">{text}</p>
      {#if more}<More label={moreLabel}>{@render more()}</More>{/if}
    </div>
  </div>
{/snippet}

{#snippet code(path: string)}<code class="text-foreground bg-muted rounded px-1 py-0.5 text-xs">{path}</code>{/snippet}

<div class="space-y-8">
  {#if page === 'scan'}
    <p class="text-muted-foreground">
      Link Checker is a small web app that does one job: it finds links in your video descriptions that no longer go where they should. Here’s what happens
      during a scan, in plain terms.
    </p>

    <!-- A vertical stepper: numbered dots joined by a line. -->
    <ol>
      <!-- worker/youtube.ts: playlistItems + videos, 50 per page, 1 unit each; MAX_PAGES_PER_CHANNEL in scan.ts -->
      {#snippet s1()}
        <p>
          Every channel has a hidden “uploads” playlist. Link Checker asks for it 50 videos at a time, then asks for those 50 videos’ titles and
          descriptions. Each request costs 1 unit of YouTube’s daily allowance, so every 50 videos cost 2 units.
        </p>
        <p>It reads up to 5,000 videos per channel. Full scans save each description, so exports and edits across many videos don’t have to ask YouTube again.</p>
      {/snippet}
      <!-- shared/core.ts: extractUrls, MAX_URL_LENGTH -->
      {#snippet s2()}
        <p>
          A link is anything starting with <span class="text-foreground">http://</span> or <span class="text-foreground">https://</span>. Punctuation
          stuck to the end, like a full stop or a closing bracket, is trimmed, unless the bracket is part of the link (as in some Wikipedia links).
        </p>
        <p>
          Links to YouTube are skipped, since they point at videos, not websites that can disappear. So are links over 2,000 characters, which are almost
          never real. A link used in many videos is checked once.
        </p>
      {/snippet}
      <!-- shared/core.ts: checkUrl; worker/fetcher.ts: BODY_LIMIT, TIMEOUT_MS, HOST_DELAY_MS -->
      {#snippet s3()}
        <p>
          It asks for each page like a regular browser would, but it handles redirects itself, one hop at a time, so it can record the whole chain: a short
          link, then the tracking link, then the final page. It also follows the “refresh” redirects some pages use instead of real ones.
        </p>
        <p>
          It reads the first 16 KB of each page and gives up on a site after 15 seconds. Sites known to limit visitors, like Amazon, LinkedIn, Instagram and
          Facebook, get a longer wait between visits, three to five seconds.
        </p>
      {/snippet}
      <!-- shared/core.ts: classify, run in the browser -->
      {#snippet s4()}
        <p>Each link gets the first status that fits:</p>
        <dl class="divide-y rounded-lg border">
          {#each ['broken', 'parked', 'unverifiable', 'destination-changed', 'domain-changed', 'homepage', 'ok'] as const as c (c)}
            <div class="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
              <dt class="shrink-0 sm:w-40"><StatusBadge category={c} tooltip={false} /></dt>
              <dd class="text-xs leading-relaxed">{CATEGORY[c].help}</dd>
            </div>
          {/each}
        </dl>
        <p>
          A move to another page on the same website, like <span class="text-foreground">example.com/old</span> to
          <span class="text-foreground">example.com/new</span>, counts as OK. The check result itself never changes when you add an exception: it’s only
          sorted differently.
        </p>
      {/snippet}
      {#each [
        { title: 'Ask YouTube for the list of videos', text: 'Link Checker uses YouTube’s official API with a read-only key. It sees exactly what any visitor to the channel can see, 50 videos at a time.', more: s1, label: 'How it reads a channel' },
        { title: 'Find the links', text: 'It reads each video’s description and picks out every web address. Links to YouTube itself are skipped.', more: s2, label: 'What counts as a link' },
        { title: 'Visit each link', text: 'It opens each link the way a browser would and follows any redirects, up to 10 hops, to see where the link really ends up. It reads only the start of each page, which is enough to spot a “domain for sale” page. It also waits about a second between visits to the same website, so no one’s site gets flooded.', more: s3, label: 'How a visit works' },
        { title: 'Sort the results', text: 'It compares where each link started with where it ended, and gives it a status. Your exception rules are applied right in your browser, so changing them updates the report instantly, without another scan.', more: s4, label: 'What each status means' },
      ] as s, i (s.title)}
        <li class="relative flex gap-3 pb-6 last:pb-0">
          {#if i < 3}<span class="bg-border absolute top-8 bottom-1 left-[13px] w-px" aria-hidden="true"></span>{/if}
          <span class="bg-foreground text-background flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{i + 1}</span>
          <div class="min-w-0 flex-1 pt-0.5">
            <div class="font-medium">{s.title}</div>
            <p class="text-muted-foreground mt-0.5">{s.text}</p>
            <More label={s.label}>{@render s.more()}</More>
          </div>
        </li>
      {/each}
    </ol>
  {:else if page === 'runs'}
    <p class="text-muted-foreground">
      Link Checker runs entirely on Cloudflare: no computer of its own, nothing to keep updated, and it fits in Cloudflare’s free plan.
    </p>

    {#snippet workers()}
      <p>
        A Worker is a small program that Cloudflare runs in its data centers around the world. Instead of a server that’s always on, it starts in a few
        milliseconds when a request comes in and stops when it’s done, so there’s nothing to patch, restart or pay for while it’s idle.
      </p>
      <p>
        This whole app is one Worker. It sends your browser the app’s pages, answers the app’s requests (your report, your rules), and runs the scan jobs.
        The free plan allows 100,000 requests a day, far more than a few people checking their channels need.
      </p>
    {/snippet}
    {#snippet jobs()}
      <!-- worker/fetcher.ts: SUBREQUEST_BUDGET; worker/scan.ts: ITEMS_PER_MESSAGE, MAX_TRIES, sweepStalledScans, MAX_RESUMES -->
      <p>
        On the free plan, each run of a Worker can make only 50 outside requests, and every redirect counts as one. So a scan is cut into small jobs and put
        in <span class="text-foreground">Cloudflare Queues</span>, a waiting line that hands the Worker one job at a time.
      </p>
      <p>
        A job is either one page of 50 videos or about six links. Each job keeps 40 requests for visiting links, leaving room for the database. A link that
        didn’t fit, say because it had many redirects, goes back in line, up to three times.
      </p>
      <p>
        A scheduled check (a <span class="text-foreground">cron trigger</span>) runs every 10 minutes. If a scan hasn’t moved in a while, it picks the scan
        back up where it stopped, up to three times, then marks it as failed so it doesn’t run forever. That’s why a scan keeps going after you close the tab.
      </p>
    {/snippet}
    {#snippet d1()}
      <p>
        D1 is Cloudflare’s database. It’s built on SQLite, the same database found in most phones and browsers, and only this app’s Worker can reach it: there’s
        no way in from the internet except through the app, which checks who you are first.
      </p>
      <p>It holds:</p>
      <ul class="list-disc space-y-1 pl-5">
        <li>workspaces, their members, and their channels;</li>
        <li>each video’s title and description, and the links found in it;</li>
        <li>each workspace’s latest check result for each link;</li>
        <li>exception rules, planned fixes and saved edits;</li>
        <li>scan progress, and how much of YouTube’s allowance has been used today.</li>
      </ul>
      <p>No passwords, no YouTube sign-ins, and nothing from your browser beyond what you type into the app.</p>
    {/snippet}
    <div class="space-y-6">
      {@render topic(Server, 'Cloudflare Workers', 'The app runs on Cloudflare’s global network as small programs that start only when needed. There’s no server to maintain, and it fits in Cloudflare’s free plan.', workers, 'What’s a Worker?')}
      {@render topic(Layers, 'Lots of small jobs', 'The free plan caps each job at about 50 web requests, so a scan is split into many small jobs waiting in a queue. Each one handles a page of videos or about six links. Every 10 minutes, a check restarts any scan that has stalled.', jobs, 'How the jobs work')}
      {@render topic(Database, 'A small database', 'Cloudflare’s D1 database stores the video list, each video’s description (for exports), the links found in it, and the latest result for each link.', d1, 'What’s D1, and what’s in it?')}
    </div>
  {:else if page === 'privacy'}
    <p class="text-muted-foreground">What Link Checker can and can’t see, who can get in, and how it avoids causing trouble for anyone else.</p>

    {#snippet readonly()}
      <p>
        The app talks to YouTube with an <span class="text-foreground">API key</span>, which identifies the app, not a person. With a key, YouTube only
        answers questions about public information, the same things anyone can see on a channel page.
      </p>
      <p>
        Changing a video needs the channel owner to sign in with Google and grant permission (called OAuth). Link Checker never asks for that, so it has
        no way to change anything on YouTube, even by mistake.
      </p>
    {/snippet}
    {#snippet access()}
      <!-- worker/auth.ts -->
      <p>
        <span class="text-foreground">Cloudflare Access</span> is a sign-in gate that Cloudflare puts in front of the app. Before any page loads, it asks for
        your email address and sends a one-time code there. Once you enter it, your browser holds a pass, signed by Cloudflare, that lasts for a while.
      </p>
      <p>
        Whoever runs this copy of the app decides which email addresses Access lets in. Inside, the app decides which workspaces you can see: your own, and
        any you’ve been added to.
      </p>
      <p>
        The app doesn’t just trust that the gate is there. On every request it checks the pass’s signature against Cloudflare’s public keys, so a request
        that somehow got around the gate has no identity and is refused.
      </p>
    {/snippet}
    {#snippet privacy()}
      <p>Everything about your channels belongs to your workspace:</p>
      <ul class="list-disc space-y-1 pl-5">
        <li>your channels and their videos;</li>
        <li>link check results, even for a link that another workspace also uses (it’s checked separately for each);</li>
        <li>teammates, exception rules, planned fixes and saved edits.</li>
      </ul>
      <p>The one thing every workspace shares is YouTube’s daily allowance, below.</p>
    {/snippet}
    {#snippet quota()}
      <!-- worker/youtube.ts: DEFAULT_DAILY_UNITS; worker/api.ts: MAX_DAILY_FULL_SCANS, MAX_DAILY_RECHECKS, MAX_CHANNELS -->
      <p>
        YouTube gives each app 10,000 <span class="text-foreground">units</span> a day, reset at midnight Pacific time. Reading 50 videos costs 2 units, so
        a 300-video channel costs about 12. By default, this app stops at 8,000 units to leave some room to spare.
      </p>
      <p>
        Rechecking flagged links costs nothing, since it only visits the links and never asks YouTube. The Rescan menu shows what each kind of scan will
        cost before you start it.
      </p>
      <p>Each workspace can run up to 100 full scans and 500 rechecks a day, and add up to 50 channels.</p>
    {/snippet}
    {#snippet addresses()}
      <!-- worker/fetcher.ts: forbidden -->
      <p>
        Links come from video descriptions, which anyone can write. A sneaky link could point at an address that only works inside a company’s network,
        hoping the app would reveal what’s there. So before every visit, including every redirect, the app checks the address and refuses:
      </p>
      <ul class="list-disc space-y-1 pl-5">
        <li>anything that isn’t a normal web link (http or https);</li>
        <li>names like <span class="text-foreground">localhost</span>, or ones ending in .local or .internal;</li>
        <li>any address written as a bare number (an IP address like 192.168.1.1) instead of a name.</li>
      </ul>
      <p>On top of that, Cloudflare doesn’t let Workers reach private networks at all.</p>
    {/snippet}
    <div class="space-y-6">
      {@render topic(Eye, 'Read-only on YouTube', 'There’s no YouTube sign-in. The app can’t edit videos, can’t see private or unlisted ones, and can’t see analytics. To fix a description, you copy the text and paste it into YouTube Studio yourself.', readonly, 'Why it can’t change anything')}
      {@render topic(Lock, 'Signing in', 'Cloudflare Access emails you a one-time code, so the app never stores passwords. Every request must carry Cloudflare’s signed proof of who you are; without it, nothing loads.', access, 'What’s Cloudflare Access?')}
      {@render topic(Users, 'Private to your workspace', 'Your channels, link check results, teammates, exception rules, planned fixes and saved edits are seen only by people in your workspace.', privacy, 'What exactly is private')}
      {@render topic(Gauge, 'Fair use of YouTube’s allowance', 'YouTube gives each app a daily allowance that everyone using this copy shares. A full scan of a 300-video channel uses about 12 of the daily units, and each workspace has daily scan limits so no one can use it all up.', quota, 'How the allowance works')}
      {@render topic(ShieldCheck, 'Careful with addresses', 'It refuses to visit private or internal network addresses, so a link in a description can’t be used to probe the systems the app runs on.', addresses, 'What it refuses to visit')}
    </div>
  {:else}
    <p class="text-muted-foreground">
      Some websites block automated visitors, ask for a login, or limit how often they can be visited. When that happens, Link Checker can’t tell if the
      link works, so it says so instead of guessing. These links are usually fine.
    </p>

    {#snippet bots()}
      <!-- shared/core.ts: BOT_WALL_STATUSES -->
      <p>
        When a site turns a visitor away, it answers with a code instead of the page. Codes like 401 and 403 (“not allowed”), 429 (“too many visits”) and
        LinkedIn’s 999 usually mean “no robots”, not “this page is gone”, so they’re marked Could not verify instead of Broken.
      </p>
      <p>Codes that really mean the page is missing, like 404 (“not found”) and 410 (“gone”), are marked Broken.</p>
    {/snippet}
    {#snippet waits()}
      <p>
        Link Checker visits each website about once a second at most, and waits three to five seconds between visits to sites that are strict about it, like
        Amazon and LinkedIn. If a site still says “too many visits”, the link is marked Could not verify rather than retried over and over.
      </p>
    {/snippet}
    {#snippet todo()}
      <p>
        Open the link in your browser. If it works, you can leave it: it doesn’t count toward the links that need attention. If you’d rather it not show up at
        all, add the site to <span class="text-foreground">Ignored links</span> on the Exceptions page.
      </p>
      <p>A later Recheck flagged links may get through, since some sites only block for a while.</p>
    {/snippet}
    <div class="space-y-6">
      {@render topic(Bot, 'Bot protection', 'Many big sites check whether a visitor is a person, and turn away anything that looks automated.', bots, 'Which answers mean “blocked”')}
      {@render topic(KeyRound, 'Login walls', 'Some links need you to be signed in, like a members-only page. The app never signs in anywhere, so it can only see the login page.')}
      {@render topic(Timer, 'Visit limits', 'Some sites allow only a few visits per minute from one place.', waits, 'How the app spaces out visits')}
      {@render topic(MousePointerClick, 'What to do about them', 'Open one to check. Usually it works fine.', todo, 'Your options')}
    </div>
  {/if}

  <section class="border-t pt-5">
    <div class="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
      <GitHubMark class="size-3.5" /><span class="text-muted-foreground">Read the code</span>
    </div>
    <ul class="grid gap-2 sm:grid-cols-2">
      {#each SOURCES[page] as [path, what] (path)}
        <li>
          <a
            href="{repo}/{path.includes('.') ? 'blob' : 'tree'}/main/app/{path}"
            target="_blank"
            rel="noreferrer"
            class="hover:bg-muted/60 block rounded-md border px-3 py-2 transition-colors duration-150"
          >
            {@render code(path)}
            <span class="text-muted-foreground mt-1 block text-xs">{what}</span>
          </a>
        </li>
      {/each}
    </ul>
  </section>
</div>
