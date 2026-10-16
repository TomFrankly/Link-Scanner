<script lang="ts">
  // The "How it works" screen in the Help dialog: a plain-language tour of what a scan does,
  // where the app runs, and what it can and can't access. Keep the numbers here in sync with
  // the code they describe (noted beside each one).
  import Server from '@lucide/svelte/icons/server';
  import Layers from '@lucide/svelte/icons/layers';
  import Database from '@lucide/svelte/icons/database';
  import Eye from '@lucide/svelte/icons/eye';
  import Lock from '@lucide/svelte/icons/lock';
  import Users from '@lucide/svelte/icons/users';
  import Gauge from '@lucide/svelte/icons/gauge';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import { brand } from '$lib/brand';
  import GitHubMark from './GitHubMark.svelte';

  // What a scan does, in order.
  const STEPS = [
    {
      title: 'Ask YouTube for the list of videos',
      // worker/youtube.ts: playlistItems + videos, 50 per page
      text: 'Link Checker uses YouTube’s official API with a read-only key. It sees exactly what any visitor to the channel can see, 50 videos at a time.',
    },
    {
      title: 'Find the links',
      // shared/core.ts: extractUrls
      text: 'It reads each video’s description and picks out every web address. Links to YouTube itself are skipped.',
    },
    {
      title: 'Visit each link',
      // shared/core.ts: checkUrl (10 hops); worker/fetcher.ts: 16 KB read, ~1 s per site
      text: 'It opens each link the way a browser would and follows any redirects, up to 10 hops, to see where the link really ends up. It reads only the start of each page, which is enough to spot a “domain for sale” page. It also waits about a second between visits to the same website, so no one’s site gets flooded.',
    },
    {
      title: 'Sort the results',
      // shared/core.ts: classify, run in the browser
      text: 'It compares where each link started with where it ended, and gives it a status. Your exception rules are applied right in your browser, so changing them updates the report instantly, without another scan.',
    },
  ];

  const RUNS = [
    {
      Icon: Server,
      title: 'Cloudflare Workers',
      text: 'The app runs on Cloudflare’s global network as small programs that start only when needed. There’s no server to maintain, and it fits in Cloudflare’s free plan.',
    },
    {
      Icon: Layers,
      title: 'Lots of small jobs',
      // worker/scan.ts: ITEMS_PER_MESSAGE, sweepStalledScans
      text: 'The free plan caps each job at about 50 web requests, so a scan is split into many small jobs waiting in a queue. Each one handles a page of videos or about six links. Every 10 minutes, a check restarts any scan that has stalled.',
    },
    {
      Icon: Database,
      title: 'A small database',
      text: 'Cloudflare’s D1 database stores the video list, each video’s description (for exports), the links found in it, and the latest result for each link.',
    },
  ];

  const SAFETY = [
    {
      Icon: Eye,
      title: 'Read-only on YouTube',
      text: 'There’s no YouTube sign-in. The app can’t edit videos, can’t see private or unlisted ones, and can’t see analytics. To fix a description, you copy the text and paste it into YouTube Studio yourself.',
    },
    {
      Icon: Lock,
      title: 'Signing in',
      // worker/auth.ts
      text: 'Cloudflare Access emails you a one-time code, so the app never stores passwords. Every request must carry Cloudflare’s signed proof of who you are; without it, nothing loads.',
    },
    {
      Icon: Users,
      title: 'What’s shared and what’s private',
      text: 'A link’s check result is shared between workspaces, since it’s a public link on a public video and checking it once saves everyone time. Your channels, teammates, exception rules, planned fixes and saved edits stay private to your workspace.',
    },
    {
      Icon: Gauge,
      title: 'Fair use of YouTube’s allowance',
      // GLOBAL_DAILY_UNITS in wrangler.jsonc; 2 units per page of 50 videos
      text: 'YouTube gives each app a daily allowance that everyone using this copy shares. A full scan of a 300-video channel uses about 12 of the daily units, and each workspace has daily scan limits so no one can use it all up.',
    },
    {
      Icon: ShieldCheck,
      title: 'Careful with addresses',
      // worker/fetcher.ts: forbidden hosts
      text: 'It refuses to visit private or internal network addresses, so a link in a description can’t be used to probe the systems the app runs on.',
    },
  ];
</script>

{#snippet section(title: string)}
  <h3 class="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">{title}</h3>
{/snippet}

<div class="space-y-7 p-4 leading-relaxed">
  <p>Link Checker is a small web app that does one job: it finds links in your video descriptions that no longer go where they should. Here’s what happens, in plain terms.</p>

  <section>
    {@render section('What a scan does')}
    <!-- A vertical stepper: numbered dots joined by a line. -->
    <ol class="space-y-0">
      {#each STEPS as s, i (s.title)}
        <li class="relative flex gap-3 pb-5 last:pb-0">
          {#if i < STEPS.length - 1}<span class="bg-border absolute top-7 bottom-1 left-[13px] w-px" aria-hidden="true"></span>{/if}
          <span class="bg-foreground text-background flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{i + 1}</span>
          <div class="pt-0.5">
            <div class="font-medium">{s.title}</div>
            <p class="text-muted-foreground mt-0.5">{s.text}</p>
          </div>
        </li>
      {/each}
    </ol>
  </section>

  <section>
    {@render section('Where it runs')}
    <div class="space-y-3">
      {#each RUNS as r (r.title)}
        <div class="flex gap-3">
          <span class="bg-muted flex size-7 shrink-0 items-center justify-center rounded-md"><r.Icon class="size-3.5" /></span>
          <div>
            <div class="font-medium">{r.title}</div>
            <p class="text-muted-foreground mt-0.5">{r.text}</p>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section>
    {@render section('Privacy and safety')}
    <div class="space-y-3">
      {#each SAFETY as r (r.title)}
        <div class="flex gap-3">
          <span class="bg-muted flex size-7 shrink-0 items-center justify-center rounded-md"><r.Icon class="size-3.5" /></span>
          <div>
            <div class="font-medium">{r.title}</div>
            <p class="text-muted-foreground mt-0.5">{r.text}</p>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section>
    {@render section('Why some links say “Could not verify”')}
    <p class="text-muted-foreground">
      Some websites block automated visitors, ask for a login, or limit how often they can be visited. When that happens, Link Checker can’t tell if the link works,
      so it says so instead of guessing. These links are usually fine; open one to check.
    </p>
  </section>

  <section class="bg-muted/40 rounded-lg border p-4">
    <div class="flex items-start gap-3">
      <span class="bg-foreground text-background flex size-8 shrink-0 items-center justify-center rounded-md"><GitHubMark class="size-4" /></span>
      <div>
        <div class="font-medium">Check the code yourself</div>
        <p class="text-muted-foreground mt-0.5">
          Everything above is in the open-source code. Scans run in <code class="text-foreground text-xs">worker/scan.ts</code>, links are checked in
          <code class="text-foreground text-xs">shared/core.ts</code>, and sign-in is verified in <code class="text-foreground text-xs">worker/auth.ts</code>.
        </p>
        <a href={brand.repo} target="_blank" rel="noreferrer" class="mt-2 inline-block font-medium underline underline-offset-4">View the code on GitHub</a>
      </div>
    </div>
  </section>
</div>
