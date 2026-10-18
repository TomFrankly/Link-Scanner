<script lang="ts">
  // The report's content pane for the link picked in the Links list: where it goes now, its
  // planned fix, the actions for it (Accept or Unignore, Plan fix, Recheck, Open), and every video
  // that uses it, each with Fix description (opens the video in the Videos view) and Studio.
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
  import ItemArrows from './ItemArrows.svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import FileText from '@lucide/svelte/icons/file-text';
  import Play from '@lucide/svelte/icons/play';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { slide } from 'svelte/transition';
  import { SvelteSet } from 'svelte/reactivity';
  import DescriptionPanel from './DescriptionPanel.svelte';
  import Hint from './Hint.svelte';
  import { toast } from 'svelte-sonner';
  import PlannedFix from './PlannedFix.svelte';
  import ArchiveThumb from './ArchiveThumb.svelte';
  import Loader from '@lucide/svelte/icons/loader-circle';
  import PlanFixButton from './PlanFixButton.svelte';
  import FixMenuItems from './FixMenuItems.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { studioLink, studioUrl } from '$lib/studio';
  import { addRule, app, archiveLookups, data, removeRule, startScan, ui, waybackParts } from '$lib/store.svelte';
  import { FIXABLE } from '$shared/fixes';
  import { baseDomain, hostOf } from '$shared/core';
  import type { Row } from '$lib/types';

  let {
    row,
    channelTitle,
    canRecheck,
    onback,
    onexpand,
    onprev,
    onnext,
  }: {
    row: Row;
    channelTitle: Record<string, string>;
    /** Whether a recheck can start now (no scan running, rechecks left today). */
    canRecheck: boolean;
    /** Back to the list, when the panes are stacked (narrow windows); null hides it. */
    onback: (() => void) | null;
    /** Shows the collapsed list again; null hides it. */
    onexpand: (() => void) | null;
    /** The previous and next link in the list; null disables that arrow. */
    onprev: (() => void) | null;
    onnext: (() => void) | null;
  } = $props();

  const VIDEOS_SHOWN = 25;
  const VIDEOS_MORE = 50;
  const report = $derived(app.report!);
  const final = $derived(row.result?.finalUrl);
  // A trailing-slash difference isn't a real move, so it isn't shown as one.
  const moved = $derived(final && final.replace(/\/$/, '') !== row.url.replace(/\/$/, ''));
  const startBase = $derived(baseDomain(row.host));
  const finalBase = $derived(final ? baseDomain(hostOf(final)) : '');
  const multiChannel = $derived(report.channels.length > 1);
  const channelCount = $derived(new Set(row.videos.map((v) => v.channelId)).size);
  let limit = $derived.by(() => {
    void row.url; // back to the first page for each link
    return VIDEOS_SHOWN;
  });
  const vids = $derived(row.videos.slice(0, limit));

  // How many problem links each video has, for the "+N other problem links" hint and the
  // "Fix description" button. Same FIXABLE rule as the Description tab, so the counts match.
  const countsAsProblem = (r: Row) => FIXABLE.includes(r.cls.category);
  const problemsByVideo = $derived.by(() => {
    const perVideo = new Map<string, number>();
    for (const r of data.rows) if (countsAsProblem(r)) for (const v of r.videos) perVideo.set(v.id, (perVideo.get(v.id) ?? 0) + 1);
    return perVideo;
  });
  // The ignore rules hiding this link: one for this exact URL, or one for its domain or a parent
  // domain (same matching as classify in shared/core.ts). Unignore removes all of them.
  const ignoreRules = $derived(
    report.rules.filter((x) => x.type === 'ignored' && (x.value === row.url || (!x.value.includes('/') && (row.host === x.value || row.host.endsWith(`.${x.value}`))))),
  );
  // "Mark as working" is for what the checker couldn't confirm: Could not verify, or Broken
  // because the site couldn't be reached (no HTTP answer). A 404 or a parked page is definite.
  const canMarkWorking = $derived(row.cls.category === 'unverifiable' || (row.cls.category === 'broken' && row.result?.outcome === 'error'));
  const workingRule = $derived(report.rules.find((x) => x.type === 'working' && x.value === row.url));
  /** Marks it, then confirms with Undo: the link leaves the "Needs attention" list at once. */
  async function markWorking() {
    const url = row.url;
    if (!(await addRule('working', url))) return;
    const id = app.report?.rules.find((x) => x.type === 'working' && x.value === url)?.id;
    toast.success('Marked as working. It counts as OK in this workspace.', { action: id ? { label: 'Undo', onClick: () => removeRule(id) } : undefined });
  }
  // Which videos have their description drawer open; cleared when another link is shown.
  const expanded = new SvelteSet<string>();
  $effect(() => {
    void row.url;
    expanded.clear();
  });
  const toggle = (id: string) => (expanded.has(id) ? expanded.delete(id) : expanded.add(id));
  const allOpen = $derived(vids.length > 0 && vids.every((v) => expanded.has(v.id)));
  // A planned Wayback Machine replacement gets a small preview of the archived page.
  const archived = $derived(data.fixes.all(row.url).find((f) => f.action === 'replace' && f.replacement && waybackParts(f.replacement))?.replacement ?? null);
  const MARK_HINT = 'You opened it and it works. It counts as OK in this workspace, and is flagged again if the site starts answering with an error, like 404.';
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="flex flex-none items-center gap-2 border-b px-4 py-2.5">
    {#if onback}
      <Hint text="Back to the list" side="bottom">
        {#snippet children(tip)}<Button {...tip} size="icon-sm" variant="ghost" class="-ml-2" aria-label="Back to the list" onclick={onback}><ArrowLeft /></Button>{/snippet}
      </Hint>
    {/if}
    {#if onexpand}
      <Hint text="Show the list" kbd="[" side="bottom">
        {#snippet children(tip)}<Button {...tip} size="icon-sm" variant="ghost" class="-ml-2" aria-label="Show the list" onclick={onexpand}><PanelLeftOpen /></Button>{/snippet}
      </Hint>
    {/if}
    <StatusBadge category={row.cls.category} />
    {#if archiveLookups.has(row.url)}
      <!-- A Wayback Machine lookup is running (planArchivedCopy); it carries on if you move to another link. -->
      <span class="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 text-xs" role="status">
        <Loader class="size-3.5 shrink-0 motion-safe:animate-spin" /><span class="truncate">Looking for an archived copy…</span>
      </span>
    {:else}
    <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs">
      in {row.videos.length} video{row.videos.length === 1 ? '' : 's'}{#if multiChannel}{' '}across {channelCount} channel{channelCount === 1 ? '' : 's'}{/if}
    </span>
    {/if}
    {#if row.cls.category === 'domain-changed' && finalBase}
      <Hint text="Mark {startBase} → {finalBase} as an expected redirect. Every link that makes this move counts as OK in this workspace.">
        {#snippet children(props)}
          <Button {...props} size="sm" variant="outline" onclick={() => addRule('accepted', startBase, finalBase)}>Accept</Button>
        {/snippet}
      </Hint>
    {:else if canMarkWorking}
      <Hint text={MARK_HINT}>
        {#snippet children(props)}
          <Button {...props} size="sm" variant="outline" onclick={markWorking}>Mark as working</Button>
        {/snippet}
      </Hint>
    {:else if row.cls.category === 'ignored'}
      <Hint text="Remove the ignore rule that hides this link, so it shows in the report again.">
        {#snippet children(props)}
          <Button {...props} size="sm" variant="outline" onclick={() => ignoreRules.forEach((x) => removeRule(x.id))}>Unignore</Button>
        {/snippet}
      </Hint>
    {/if}
    <PlanFixButton {row} />
    <DropdownMenu.Root>
      <Hint text="More actions" side="bottom">
        {#snippet children(tip)}
          <DropdownMenu.Trigger {...tip}>
            {#snippet child({ props })}
              <Button {...props} size="icon-sm" variant="ghost" aria-label="More actions"><Ellipsis /></Button>
            {/snippet}
          </DropdownMenu.Trigger>
        {/snippet}
      </Hint>
      <DropdownMenu.Content align="end" class="w-80 max-w-[calc(100vw-2rem)]">
        <FixMenuItems {row} />
        <DropdownMenu.Separator />
        <DropdownMenu.Item disabled={!canRecheck} onSelect={() => startScan('urls', [row.url])}>Recheck now</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => window.open(row.url, '_blank', 'noreferrer')}>Open link</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => (allOpen ? expanded.clear() : vids.forEach((v) => expanded.add(v.id)))}>
          {allOpen ? 'Collapse all descriptions' : 'Expand all descriptions'}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <div class="-mr-2"><ItemArrows {onprev} {onnext} noun="link" /></div>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    <section class="space-y-1 px-4 py-3">
      <a href={row.url} target="_blank" rel="noreferrer" class="font-mono text-sm font-medium break-all hover:underline">{row.url}</a>
      {#if moved}
        <div class="text-muted-foreground font-mono text-xs break-all">
          → {final}{#if (row.result?.chain.length ?? 0) > 2}<span class="font-sans"> · {row.result!.chain.length - 1} hops</span>{/if}
        </div>
      {/if}
      {#if row.cls.detail && !row.cls.working}<div class="text-muted-foreground text-xs">{row.cls.detail}</div>{/if}
      {#if row.cls.accepted}<div class="text-muted-foreground text-xs">Accepted redirect</div>{/if}
      {#if row.cls.working && workingRule}
        <div class="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          <span>Marked as working by {workingRule.addedBy.split('@')[0]}. The checker got: {row.cls.detail ?? 'no answer'}.</span>
          <button class="text-foreground underline underline-offset-2" onclick={() => removeRule(workingRule.id)}>Unmark</button>
        </div>
      {/if}
      <PlannedFix url={row.url} />
      {#if archived}<ArchiveThumb url={archived} />{/if}
    </section>

    <div class="text-muted-foreground px-4 pt-3 pb-1 text-xs font-medium">Used in</div>
    <!-- Each video can open a drawer with its Description tab editor (DescriptionPanel, compact),
         scrolled to this link: the same edits, fixes and copy buttons as the Videos view. The ⋯
         menu opens or closes them all. -->
    <ul class="space-y-px px-1.5 pb-2">
      {#each vids as v (v.id)}
        <!-- Problem links in this video besides this one. -->
        {@const others = (problemsByVideo.get(v.id) ?? 0) - (countsAsProblem(row) ? 1 : 0)}
        {@const isOpen = expanded.has(v.id)}
        <li class="rounded-lg transition-colors duration-150 {isOpen ? 'bg-muted/40' : 'hover:bg-muted/40'}">
          <div class="flex items-center gap-1 py-1.5 pr-1.5 pl-1">
            <button
              type="button"
              class="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-0.5 pl-1 text-left outline-none focus-visible:ring-2"
              aria-expanded={isOpen}
              aria-label="{isOpen ? 'Hide' : 'Show'} where it’s used in {v.title}"
              onclick={() => toggle(v.id)}
            >
              <ChevronRight class="text-muted-foreground size-3.5 shrink-0 transition-transform duration-150 {isOpen ? 'rotate-90' : ''}" />
              <img src="https://i.ytimg.com/vi/{v.id}/mqdefault.jpg" alt="" loading="lazy" class="bg-muted aspect-video w-16 shrink-0 rounded-[4px] object-cover" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm" title={v.title}>{v.title}</span>
                <span class="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                  {#if multiChannel}<span>{channelTitle[v.channelId]}</span>{/if}
                  {#if !data.fixes.for(row.url, v.channelId) && data.editedOut.get(row.url)?.has(v.id)}<span class="flex items-center gap-1"><PencilLine class="size-3" /> Removed by your edits</span>{/if}
                  {#if others > 0}<span class="text-[#8a5a00] dark:text-[#fac34d]">+{others} other problem link{others === 1 ? '' : 's'}</span>{/if}
                </span>
              </span>
            </button>
            <Hint text="Watch on YouTube">
              {#snippet children(tip)}
                <Button {...tip} size="icon-sm" variant="ghost" class="text-muted-foreground" aria-label="Watch on YouTube" href="https://www.youtube.com/watch?v={v.id}" target="_blank" rel="noreferrer"
                  ><Play /></Button
                >
              {/snippet}
            </Hint>
            <Hint text="Fix description">
              {#snippet children(tip)}
                <Button {...tip} size="icon-sm" variant="ghost" class="text-muted-foreground" aria-label="Fix description" onclick={() => (ui.openVideo = { id: v.id, tab: 'description', url: row.url })}
                  ><FileText /></Button
                >
              {/snippet}
            </Hint>
            <Hint text="Open in YouTube Studio">
              {#snippet children(tip)}
                <a
                  {...tip}
                  class="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150"
                  aria-label="Open in YouTube Studio"
                  href={studioUrl(v.id)}
                  use:studioLink
                  target="_blank"
                  rel="noreferrer"><ExternalLink class="size-4" /></a
                >
              {/snippet}
            </Hint>
          </div>
          {#if isOpen}
            <div class="px-2 pb-2" transition:slide={{ duration: 150 }}>
              <div class="bg-background h-96 overflow-hidden rounded-lg border"><DescriptionPanel video={v} focus={{ url: row.url, n: 1 }} compact /></div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if row.videos.length > vids.length}
      <div class="px-4 py-2">
        <button class="text-muted-foreground hover:text-foreground text-xs" onclick={() => (limit += VIDEOS_MORE)}>
          Show {Math.min(VIDEOS_MORE, row.videos.length - vids.length)} more of {row.videos.length}
        </button>
      </div>
    {/if}
  </div>
</div>
