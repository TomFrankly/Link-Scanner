<script lang="ts">
  // The guided tour in the Help dialog: one step at a time, with Back / Next.
  // Steps that point at a page offer a button that closes the dialog and goes there.
  import type { Category } from '$shared/core';
  import { Button } from '$lib/components/ui/button';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { CATEGORY } from '$lib/categories';
  import { go, type Route } from '$lib/store.svelte';
  import { mode } from 'mode-watcher';

  let { onDone, onNavigate }: { onDone: () => void; onNavigate: () => void } = $props();

  interface Step {
    title: string;
    paragraphs: string[];
    /** Status badges to show with their explanations (the "read the report" step). */
    badges?: Category[];
    /** A page this step is about, offered as a "take me there" button. */
    page?: { route: Route; label: string };
    /** A looping clip in web/public/tour/ (recorded by demo/record.mjs), by file name without extension. */
    video?: string;
  }

  const STEPS: Step[] = [
    {
      title: 'Add your channels',
      video: 'channels',
      paragraphs: [
        'Start on the Channels page. Paste a channel’s @handle or its YouTube link, and it’s added to your workspace.',
        'Everyone in a workspace sees the same channels and results, so a team can share the work.',
      ],
      page: { route: 'channels', label: 'Open Channels' },
    },
    {
      title: 'Run a scan',
      video: 'scan',
      paragraphs: [
        'Click Scan next to a new channel, or use Rescan → Full scan to check every channel. Link Checker reads each video’s description, pulls out every link, and visits it.',
        'A banner shows progress, and the scan keeps going if you close the tab. Links are checked slowly on purpose, so websites don’t mistake the scan for an attack. A big channel can take a while.',
        'Later, Recheck flagged links retests only the problem links. It’s quick and doesn’t use any YouTube quota.',
      ],
    },
    {
      title: 'Read the report',
      video: 'report',
      paragraphs: [
        'The headline counts the links that need your attention. Each link gets one status. Hover a status anywhere in the app to see what it means.',
      ],
      badges: ['broken', 'parked', 'domain-changed', 'homepage', 'unverifiable', 'ok'],
    },
    {
      title: 'Mark what’s expected',
      video: 'accept',
      paragraphs: [
        'Some redirects are fine: a company renamed itself, or the link is one of your own short links. Click Accept on a “Domain changed” link and every link making that same move counts as OK.',
        'The Exceptions page holds these rules: accepted redirects, redirector domains (short-link services you control), and links to ignore entirely.',
      ],
      page: { route: 'exceptions', label: 'Open Exceptions' },
    },
    {
      title: 'Plan your fixes',
      video: 'fix',
      paragraphs: [
        'Open the ⋯ menu on a link to plan a fix: remove the link, or give it a replacement.',
        'A plan belongs to the link, not one video, so it applies everywhere that link appears.',
      ],
    },
    {
      title: 'Fix the descriptions',
      video: 'descriptions',
      paragraphs: [
        'Switch the report to Videos and open a video’s Description tab (or click Fix description on a link). It shows the description with your planned fixes applied and every change highlighted.',
        'Tweak it if you like, click Copy & open Studio, and paste it into the description there. Next video to fix moves you along. Link Checker never changes anything on YouTube itself.',
        'Click any link in the text to change or remove it. You choose whether that applies to every video with the link, just this channel’s videos, or only this one.',
        'Changed a line that’s in other videos too, like a sponsor or footer? Click the save icon above the editor, and Link Checker finds every other video with the same line and offers to change it there as well.',
      ],
    },
    {
      title: 'Share and export',
      video: 'share',
      paragraphs: [
        'Workspace owners can add teammates on the Members page, using any email address. They sign in with a one-time code sent to that address.',
        'Export sends whatever the report is showing to Excel, a CSV file, or Google Sheets, including each link’s planned fix. The Excel file also has every video’s description, with your saved edits and planned fixes applied, ready to paste.',
      ],
      page: { route: 'members', label: 'Open Members' },
    },
  ];

  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let index = $state(0);
  const step = $derived(STEPS[index]);
  const last = $derived(index === STEPS.length - 1);

  function visit(route: Route) {
    go(route);
    onNavigate();
  }
</script>

<div class="flex min-h-full flex-col">
  <div class="flex-1 p-4">
    {#if step.video}
      {@const clip = `/tour/${step.video}${mode.current === 'light' ? '-light' : ''}`}
      <!-- Muted, looping clip like a GIF, matching the light or dark theme. With reduced motion it waits for a click to play. -->
      {#key clip}
        <video
          class="bg-muted mb-4 aspect-[8/5] w-full rounded-lg border object-cover"
          poster="{clip}.jpg"
          autoplay={!reducedMotion}
          controls={reducedMotion}
          loop
          muted
          playsinline
          aria-label="Demo: {step.title}"
        >
          <source src="{clip}.mp4" type="video/mp4" />
        </video>
      {/key}
    {/if}
    <div class="text-muted-foreground mb-1 text-xs tabular-nums">Step {index + 1} of {STEPS.length}</div>
    <h3 class="mb-3 text-lg font-semibold tracking-tight">{step.title}</h3>
    <div class="space-y-3 leading-relaxed">
      {#each step.paragraphs as p (p)}<p>{p}</p>{/each}
    </div>

    {#if step.badges}
      <dl class="mt-4 divide-y rounded-lg border">
        {#each step.badges as c (c)}
          <div class="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
            <dt class="shrink-0 sm:w-36"><StatusBadge category={c} tooltip={false} /></dt>
            <dd class="text-muted-foreground text-xs leading-relaxed">{CATEGORY[c].help}</dd>
          </div>
        {/each}
      </dl>
    {/if}

    {#if step.page}
      <Button class="mt-4" size="sm" variant="outline" onclick={() => visit(step.page!.route)}>{step.page.label}</Button>
    {/if}
  </div>

  <!-- Progress dots double as shortcuts to any step. -->
  <div class="bg-popover sticky bottom-0 flex items-center gap-3 border-t px-4 py-3">
    <div class="flex flex-1 gap-1.5" role="tablist" aria-label="Tour steps">
      {#each STEPS as s, i (s.title)}
        <button
          type="button"
          role="tab"
          aria-selected={i === index}
          aria-label="Step {i + 1}: {s.title}"
          class="h-1.5 rounded-full transition-all duration-200 {i === index ? 'bg-foreground w-5' : 'bg-border hover:bg-muted-foreground/50 w-1.5'}"
          onclick={() => (index = i)}
        ></button>
      {/each}
    </div>
    <Button size="sm" variant="ghost" disabled={index === 0} onclick={() => index--}>Back</Button>
    <Button size="sm" onclick={() => (last ? onDone() : index++)}>{last ? 'Finish' : 'Next'}</Button>
  </div>
</div>
