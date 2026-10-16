<script lang="ts">
  // The Report page's "Videos" view: the same filtered links, grouped by the video that uses
  // them, most problems first. Each video expands into two tabs: Links (its links, each with a
  // "Plan fix" button) and Description (DescriptionPanel: the description with fixes applied,
  // to copy into YouTube Studio). Other pages open a video here through `ui.openVideo`. Rows
  // come in as props from Report.svelte; planned fixes are read from `data.fixes`.
  import { tick } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import LocateFixed from '@lucide/svelte/icons/locate-fixed';
  import DescriptionPanel from '$lib/components/DescriptionPanel.svelte';
  import { studioLink, studioUrl } from '$lib/studio';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { Button } from '$lib/components/ui/button';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import PlannedFix from '$lib/components/PlannedFix.svelte';
  import FileText from '@lucide/svelte/icons/file-text';
  import PlanFixButton from '$lib/components/PlanFixButton.svelte';
  import { data, ui } from '$lib/store.svelte';
  import { CATEGORY } from '$lib/categories';
  import { FIXABLE, type Problem } from '$shared/fixes';
  import type { Category } from '$shared/core';
  import type { Row, VideoRef } from '$lib/types';

  // `rows` (filtered) decides which videos show; `allRows` supplies every link in each video,
  // so a video's fixes cover all of its problem links, not just the ones in the current filter.
  let {
    rows,
    allRows = rows,
    channelTitle,
    multiChannel,
  }: { rows: Row[]; allRows?: Row[]; channelTitle: Record<string, string>; multiChannel: boolean } = $props();

  const PAGE = 50;
  // Order inside a video, and the chip groups that summarize it.
  const ORDER: Category[] = ['broken', 'parked', 'domain-changed', 'destination-changed', 'homepage', 'unverifiable', 'pending', 'ignored', 'ok'];
  const GROUPS: { label: string; tint: Category; match: Category[] }[] = [
    { label: 'broken', tint: 'broken', match: ['broken', 'parked'] },
    { label: 'redirected', tint: 'domain-changed', match: ['domain-changed', 'destination-changed', 'homepage'] },
    { label: 'unverified', tint: 'unverifiable', match: ['unverifiable'] },
    { label: 'not checked', tint: 'pending', match: ['pending'] },
    { label: 'ignored', tint: 'ignored', match: ['ignored'] },
    { label: 'OK', tint: 'ok', match: ['ok'] },
  ];

  interface Group {
    video: VideoRef;
    links: Row[];
    problems: Problem[];
    chips: { label: string; n: number; cls: string }[];
  }

  // Videos with at least one link in `rows`, each holding every one of its links from `allRows`,
  // sorted inside by severity, plus the summary chips. Most problem links first, then by title.
  const videos = $derived.by((): Group[] => {
    const shown = new Set(rows.flatMap((r) => r.videos.map((v) => v.id)));
    const byId = new Map<string, { video: VideoRef; links: Row[] }>();
    for (const r of allRows) {
      for (const v of r.videos) {
        if (!shown.has(v.id)) continue;
        let entry = byId.get(v.id);
        if (!entry) byId.set(v.id, (entry = { video: v, links: [] }));
        entry.links.push(r);
      }
    }
    return [...byId.values()]
      .map(({ video, links }) => {
        links.sort((a, b) => ORDER.indexOf(a.cls.category) - ORDER.indexOf(b.cls.category) || a.url.localeCompare(b.url));
        const problems = links
          .filter((r) => FIXABLE.includes(r.cls.category))
          .map((r) => ({ url: r.url, category: r.cls.category, finalUrl: r.result?.finalUrl ?? null, detail: r.cls.detail ?? null }));
        const chips = GROUPS.map((g) => ({
          label: g.label,
          n: links.filter((r) => g.match.includes(r.cls.category)).length,
          cls: CATEGORY[g.tint].cls,
        })).filter((c) => c.n);
        return { video, links, problems, chips };
      })
      .sort((a, b) => b.problems.length - a.problems.length || a.video.title.localeCompare(b.video.title));
  });

  // Back to the first page whenever the filtered rows change. A writable $derived: "Show more"
  // raises it, and a new `rows` resets it to PAGE.
  let limit = $derived.by(() => {
    void rows;
    return PAGE;
  });
  const shown = $derived(videos.slice(0, limit));
  const open = new SvelteSet<string>();
  const toggle = (id: string) => (open.has(id) ? open.delete(id) : open.add(id));
  // Which tab each expanded video shows, and a link for its Description tab to scroll to.
  const tabs = new SvelteMap<string, 'links' | 'description'>();
  const focus = new SvelteMap<string, { url: string; n: number }>();
  let focusCount = 0;

  /** Expands a video on a tab (and, with `url`, scrolls its description to that link), and brings it into view. */
  async function show(id: string, tab: 'links' | 'description', url?: string) {
    const at = videos.findIndex((g) => g.video.id === id);
    if (at === -1) return;
    if (at >= limit) limit = Math.ceil((at + 1) / PAGE) * PAGE;
    open.add(id);
    tabs.set(id, tab);
    if (url) focus.set(id, { url, n: ++focusCount });
    await tick();
    if (!url) document.getElementById(`video-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  // Requests from elsewhere, e.g. the Links view's "Fix description" button.
  $effect(() => {
    const req = ui.openVideo;
    if (!req) return;
    ui.openVideo = null;
    show(req.id, req.tab, req.url);
  });

  /** The next video with problem links after this one, in the list's order. */
  const nextToFix = (id: string) => {
    const at = videos.findIndex((g) => g.video.id === id);
    return videos.slice(at + 1).find((g) => g.problems.length)?.video.id ?? null;
  };
  function goNext(id: string) {
    const next = nextToFix(id);
    if (!next) return;
    open.delete(id);
    show(next, 'description');
  }

  const date = (s: string | null) => (s ? new Date(s).toLocaleDateString([], { dateStyle: 'medium' }) : null);
  // Where a link ends up, if that's really somewhere else (a trailing slash alone doesn't count).
  const moved = (r: Row) => {
    const final = r.result?.finalUrl;
    return final && final.replace(/\/$/, '') !== r.url.replace(/\/$/, '') ? final : null;
  };
</script>

<div>
  {#each shown as g (g.video.id)}
    {@const v = g.video}
    {@const expanded = open.has(v.id)}
    {@const published = date(v.publishedAt)}
    {@const tab = tabs.get(v.id) ?? 'links'}
    <div id="video-{v.id}" class="scroll-mt-16 border-b last:border-b-0">
      <div class="hover:bg-muted/30 flex items-center gap-3 px-3 py-2 transition-colors">
        <button
          class="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2"
          aria-expanded={expanded}
          onclick={() => toggle(v.id)}
        >
          <ChevronRight class="text-muted-foreground size-4 shrink-0 transition-transform {expanded ? 'rotate-90' : ''}" />
          <img
            src="https://i.ytimg.com/vi/{v.id}/mqdefault.jpg"
            alt=""
            loading="lazy"
            width="96"
            height="54"
            class="bg-muted h-9 w-16 shrink-0 rounded-md border object-cover sm:h-[54px] sm:w-24"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium" title={v.title}>{v.title}</div>
            <div class="text-muted-foreground mt-0.5 truncate text-xs">
              {#if multiChannel}{channelTitle[v.channelId] ?? 'Unknown channel'}{#if published}{' · '}{/if}{/if}{published ?? ''}
            </div>
            <div class="mt-1 flex flex-wrap gap-1 sm:hidden">
              {#each g.chips as c (c.label)}
                <span class="inline-flex h-5 items-center rounded-full border px-1.5 text-xs font-medium tabular-nums {c.cls}">{c.n} {c.label}</span>
              {/each}
            </div>
          </div>
          <div class="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex">
            {#each g.chips as c (c.label)}
              <span class="inline-flex h-5 items-center rounded-full border px-1.5 text-xs font-medium tabular-nums {c.cls}">{c.n} {c.label}</span>
            {/each}
          </div>
        </button>
        <div class="hidden shrink-0 items-center gap-0.5 md:flex">
          <Button size="xs" variant="ghost" href="https://www.youtube.com/watch?v={v.id}" target="_blank" rel="noreferrer">Watch</Button>
          <a
            class="hover:bg-muted hover:text-foreground inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors duration-150 [&_svg]:size-3"
            href={studioUrl(v.id)}
            target="_blank"
            rel="noreferrer"
            use:studioLink
          >
            Edit in Studio <ExternalLink />
          </a>
        </div>
      </div>

      {#if expanded}
        <div class="bg-muted/40 mx-3 mb-3 rounded-md border p-3">
          <div class="text-muted-foreground mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <!-- Links | Description, styled like the report's own view switcher. -->
            <div class="border-input bg-background inline-flex h-7 items-center rounded-md border p-0.5" role="tablist" aria-label="Show">
              {#each [['links', 'Links'], ['description', 'Description']] as const as [k, label] (k)}
                <button
                  role="tab"
                  aria-selected={tab === k}
                  class="flex h-full items-center rounded-[4px] px-2 text-xs font-medium transition-colors duration-150 {tab === k
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => tabs.set(v.id, k)}>{label}</button
                >
              {/each}
            </div>
            <span><span class="text-foreground tabular-nums">{g.links.length}</span> {g.links.length === 1 ? 'link' : 'links'}</span>
            <span><span class="text-foreground tabular-nums">{g.problems.length}</span> to fix</span>
            <span class="flex gap-3 md:hidden">
              <a class="hover:text-foreground underline-offset-2 hover:underline" href="https://www.youtube.com/watch?v={v.id}" target="_blank" rel="noreferrer">Watch</a>
              <a class="hover:text-foreground underline-offset-2 hover:underline" href={studioUrl(v.id)} target="_blank" rel="noreferrer" use:studioLink>Edit in Studio</a>
            </span>
          </div>
          {#if tab === 'description'}
            <DescriptionPanel video={v} allLinks={g.links} focus={focus.get(v.id) ?? null} onnext={nextToFix(v.id) ? () => goNext(v.id) : null} />
          {:else}
          <ul class="divide-y rounded-md border bg-background">
            {#each g.links as r (r.url)}
              {@const final = moved(r)}
              <li class="grid gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <div><StatusBadge category={r.cls.category} /></div>
                <div class="flex min-w-0 items-start gap-2 text-xs">
                  <div class="min-w-0 flex-1">
                    <a href={r.url} target="_blank" rel="noreferrer" class="block truncate font-mono font-medium hover:underline" title={r.url}>{r.url}</a>
                    {#if final}<div class="text-muted-foreground truncate font-mono" title={final}>→ {final}</div>{/if}
                    {#if r.cls.detail}<div class="text-muted-foreground">{r.cls.detail}</div>{/if}
                    <PlannedFix url={r.url} />
                  </div>
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded p-1 transition-colors duration-150"
                    aria-label="Show in description"
                    title="Show in description"
                    onclick={() => show(v.id, 'description', r.url)}><LocateFixed class="size-3.5" /></button
                  >
                  <PlanFixButton row={r} />
                </div>
              </li>
            {/each}
          </ul>
          {#if g.problems.length}
            <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span class="text-muted-foreground text-xs">
                {g.problems.filter((p) => data.fixes.for(p.url, g.video.channelId)).length} of {g.problems.length} problem links have a planned fix
              </span>
              <Button size="sm" onclick={() => tabs.set(v.id, 'description')}><FileText /> Fix description</Button>
            </div>
          {/if}
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="text-muted-foreground py-16 text-center text-sm">Nothing here.</div>
  {/each}
  {#if videos.length > shown.length}
    <div class="border-t p-3 text-center">
      <Button variant="outline" size="sm" onclick={() => (limit += PAGE)}>
        Show {Math.min(PAGE, videos.length - shown.length)} more ({(videos.length - shown.length).toLocaleString()} left)
      </Button>
    </div>
  {/if}
</div>
