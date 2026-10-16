<script lang="ts">
  // The report's content pane for the video picked in the Videos list: its title, chips and
  // Studio links, then two tabs. Links lists every link in the video with Plan fix and a locate
  // button; Description (DescriptionPanel) is the description with fixes applied, to copy into
  // YouTube Studio. Report owns which video and tab are open, and the locate requests.
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import LocateFixed from '@lucide/svelte/icons/locate-fixed';
  import FileText from '@lucide/svelte/icons/file-text';
  import DescriptionPanel from './DescriptionPanel.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import PlannedFix from './PlannedFix.svelte';
  import PlanFixButton from './PlanFixButton.svelte';
  import { Button } from '$lib/components/ui/button';
  import { studioLink, studioUrl } from '$lib/studio';
  import { data } from '$lib/store.svelte';
  import { movedTo, shortDate, type VideoGroup } from '$lib/videoGroups';

  let {
    group,
    tab = $bindable(),
    focus,
    channelTitle,
    multiChannel,
    onlocate,
    onnext,
    onback,
  }: {
    group: VideoGroup;
    tab: 'links' | 'description';
    /** A link for the Description tab to scroll to; `n` changes on each request. */
    focus: { url: string; n: number } | null;
    channelTitle: Record<string, string>;
    multiChannel: boolean;
    onlocate: (url: string) => void;
    /** Opens the next video with problems; null hides the button. */
    onnext: (() => void) | null;
    /** Back to the list, when the panes are stacked (narrow windows); null hides it. */
    onback: (() => void) | null;
  } = $props();

  const v = $derived(group.video);
  const published = $derived(shortDate(v.publishedAt));
</script>

<!-- A container, so the header drops the thumbnail when the pane is narrow. -->
<div class="@container flex h-full min-h-0 flex-col">
  <header class="flex flex-none flex-wrap items-start gap-x-3 gap-y-1 border-b px-4 py-3">
    {#if onback}
      <Button size="icon-sm" variant="ghost" class="-ml-2" aria-label="Back to the list" onclick={onback}><ArrowLeft /></Button>
    {/if}
    <img
      src="https://i.ytimg.com/vi/{v.id}/mqdefault.jpg"
      alt=""
      width="96"
      height="54"
      class="bg-muted hidden aspect-video w-24 shrink-0 rounded-md border object-cover @lg:block"
    />
    <div class="min-w-0 flex-[1_1_10rem]">
      <h2 class="line-clamp-2 text-base leading-snug font-semibold" title={v.title}>{v.title}</h2>
      <div class="text-muted-foreground mt-0.5 truncate text-xs">
        {#if multiChannel}{channelTitle[v.channelId] ?? 'Unknown channel'}{#if published}{' · '}{/if}{/if}{published ?? ''}
      </div>
      <div class="mt-1.5 flex flex-wrap gap-1">
        {#each group.chips as c (c.label)}
          <span class="inline-flex h-5 items-center rounded-full border px-1.5 text-xs font-medium tabular-nums {c.cls}">{c.n} {c.label}</span>
        {/each}
      </div>
    </div>
    <div class="-mr-2 flex shrink-0 items-center gap-0.5 @max-sm:order-last @max-sm:-ml-2 @max-sm:w-full">
      <Button size="xs" variant="ghost" href="https://www.youtube.com/watch?v={v.id}" target="_blank" rel="noreferrer">Watch</Button>
      <a
        class="hover:bg-muted hover:text-foreground inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors duration-150 [&_svg]:size-3"
        href={studioUrl(v.id)}
        target="_blank"
        rel="noreferrer"
        use:studioLink
      >
        Studio <ExternalLink />
      </a>
    </div>
  </header>

  <div class="text-muted-foreground flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs">
    <!-- Links | Description, styled like the report's own view switcher. -->
    <div class="border-input bg-background inline-flex h-7 shrink-0 items-center rounded-md border p-0.5" role="tablist" aria-label="Show">
      {#each [['links', 'Links'], ['description', 'Description']] as const as [k, label] (k)}
        <button
          role="tab"
          aria-selected={tab === k}
          class="flex h-full items-center rounded-[4px] px-2 text-xs font-medium transition-colors duration-150 {tab === k
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (tab = k)}>{label}</button
        >
      {/each}
    </div>
    <span class="whitespace-nowrap"><span class="text-foreground tabular-nums">{group.links.length}</span> {group.links.length === 1 ? 'link' : 'links'}</span>
    <span class="whitespace-nowrap"><span class="text-foreground tabular-nums">{group.problems.length}</span> to fix</span>
    {#if onnext}
      <Button size="xs" variant="ghost" class="ml-auto" onclick={onnext} title="Open the next video with links to fix">Next to fix <ArrowRight /></Button>
    {/if}
  </div>

  <div class="min-h-0 flex-1">
    {#if tab === 'description'}
      {#key v.id}
        <DescriptionPanel video={v} allLinks={group.links} {focus} />
      {/key}
    {:else}
      <div class="@container h-full overflow-y-auto overscroll-contain">
        <ul class="divide-y border-b">
          {#each group.links as r (r.url)}
            {@const final = movedTo(r)}
            <li class="grid gap-x-3 gap-y-1 px-4 py-2.5 @md:grid-cols-[10rem_minmax(0,1fr)]">
              <div><StatusBadge category={r.cls.category} /></div>
              <div class="flex min-w-0 items-start gap-2 text-xs">
                <div class="min-w-0 flex-1">
                  <a href={r.url} target="_blank" rel="noreferrer" class="block font-mono font-medium break-all hover:underline">{r.url}</a>
                  {#if final}<div class="text-muted-foreground truncate font-mono" title={final}>→ {final}</div>{/if}
                  {#if r.cls.detail}<div class="text-muted-foreground">{r.cls.detail}</div>{/if}
                  <PlannedFix url={r.url} />
                </div>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded p-1 transition-colors duration-150"
                  aria-label="Show in description"
                  title="Show in description"
                  onclick={() => onlocate(r.url)}><LocateFixed class="size-3.5" /></button
                >
                <PlanFixButton row={r} />
              </div>
            </li>
          {/each}
        </ul>
        {#if group.problems.length}
          <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span class="text-muted-foreground text-xs">
              {group.problems.filter((p) => data.fixes.for(p.url, v.channelId)).length} of {group.problems.length} problem links have a planned fix
            </span>
            <Button size="sm" onclick={() => (tab = 'description')}><FileText /> Fix description</Button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
