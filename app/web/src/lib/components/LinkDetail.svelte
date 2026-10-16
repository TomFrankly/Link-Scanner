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
  import Hint from './Hint.svelte';
  import PlannedFix from './PlannedFix.svelte';
  import PlanFixButton from './PlanFixButton.svelte';
  import FixMenuItems from './FixMenuItems.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { studioLink, studioUrl } from '$lib/studio';
  import { addRule, app, data, removeRule, startScan, ui } from '$lib/store.svelte';
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
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="flex flex-none items-center gap-2 border-b px-4 py-2.5">
    {#if onback}
      <Button size="icon-sm" variant="ghost" class="-ml-2" aria-label="Back to the list" onclick={onback}><ArrowLeft /></Button>
    {/if}
    {#if onexpand}
      <Button size="icon-sm" variant="ghost" class="-ml-2" aria-label="Show the list" title="Show the list" onclick={onexpand}><PanelLeftOpen /></Button>
    {/if}
    <StatusBadge category={row.cls.category} />
    <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs">
      in {row.videos.length} video{row.videos.length === 1 ? '' : 's'}{#if multiChannel}{' '}across {channelCount} channel{channelCount === 1 ? '' : 's'}{/if}
    </span>
    {#if row.cls.category === 'domain-changed' && finalBase}
      <Hint text="Mark {startBase} → {finalBase} as an expected redirect. Every link that makes this move counts as OK in this workspace.">
        {#snippet children(props)}
          <Button {...props} size="sm" variant="outline" onclick={() => addRule('accepted', startBase, finalBase)}>Accept</Button>
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
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button {...props} size="icon-sm" variant="ghost" aria-label="More actions"><Ellipsis /></Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-80 max-w-[calc(100vw-2rem)]">
        <FixMenuItems {row} />
        <DropdownMenu.Separator />
        <DropdownMenu.Item disabled={!canRecheck} onSelect={() => startScan('urls', [row.url])}>Recheck now</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => window.open(row.url, '_blank', 'noreferrer')}>Open link</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <div class="-mr-2"><ItemArrows {onprev} {onnext} noun="link" /></div>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    <section class="space-y-1 border-b px-4 py-3">
      <a href={row.url} target="_blank" rel="noreferrer" class="font-mono text-sm font-medium break-all hover:underline">{row.url}</a>
      {#if moved}
        <div class="text-muted-foreground font-mono text-xs break-all">
          → {final}{#if (row.result?.chain.length ?? 0) > 2}<span class="font-sans"> · {row.result!.chain.length - 1} hops</span>{/if}
        </div>
      {/if}
      {#if row.cls.detail}<div class="text-muted-foreground text-xs">{row.cls.detail}</div>{/if}
      {#if row.cls.accepted}<div class="text-muted-foreground text-xs">Accepted redirect</div>{/if}
      <PlannedFix url={row.url} />
    </section>

    <div class="text-muted-foreground px-4 pt-3 pb-1 text-xs font-medium">Used in</div>
    <ul class="divide-y border-b">
      {#each vids as v (v.id)}
        <!-- Problem links in this video besides this one. -->
        {@const others = (problemsByVideo.get(v.id) ?? 0) - (countsAsProblem(row) ? 1 : 0)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <img src="https://i.ytimg.com/vi/{v.id}/mqdefault.jpg" alt="" loading="lazy" class="bg-muted aspect-video w-16 shrink-0 rounded-[4px] object-cover" />
          <div class="min-w-0 flex-1 basis-40">
            <div class="truncate text-sm" title={v.title}>{v.title}</div>
            <div class="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
              {#if multiChannel}<span>{channelTitle[v.channelId]}</span>{/if}
              {#if others > 0}<span class="text-[#8a5a00] dark:text-[#fac34d]">+{others} other problem link{others === 1 ? '' : 's'}</span>{/if}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <a class="text-muted-foreground hover:text-foreground shrink-0 text-xs" href="https://www.youtube.com/watch?v={v.id}" target="_blank" rel="noreferrer">Watch</a>
            {#if problemsByVideo.get(v.id)}
              <button
                class="hover:bg-muted inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors duration-150"
                onclick={() => (ui.openVideo = { id: v.id, tab: 'description', url: row.url })}
              >
                <FileText class="size-3" /> Fix description
              </button>
            {/if}
            <a
              class="hover:bg-muted inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors duration-150"
              href={studioUrl(v.id)}
              use:studioLink
              target="_blank"
              rel="noreferrer"
            >
              Studio <ExternalLink class="size-3" />
            </a>
          </div>
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
