<script lang="ts">
  // Report page (#/report, the default): the heading summary, Export and Rescan menus, the
  // health chart, and the list of links (or videos) with filters, search and sort. All rows
  // come from `data.rows` in store.svelte.ts, already classified in the browser with this
  // workspace's rules, so filtering, searching and the counts here never call the server.
  // Actions go through the store (addRule, removeRule, startScan) or open the fix dialog and
  // the description drawer by setting `ui.fixLinkUrl` / `ui.drawerVideoId`.
  import { MediaQuery, SvelteSet } from 'svelte/reactivity';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Info from '@lucide/svelte/icons/info';
  import Search from '@lucide/svelte/icons/search';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Download from '@lucide/svelte/icons/download';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import VideosView from '$lib/components/VideosView.svelte';
  import FileText from '@lucide/svelte/icons/file-text';
  import Hint from '$lib/components/Hint.svelte';
  import PlannedFix from '$lib/components/PlannedFix.svelte';
  import FixMenuItems from '$lib/components/FixMenuItems.svelte';
  import FixLinkDialog from '$lib/components/FixLinkDialog.svelte';
  import DescriptionDrawer from '$lib/components/DescriptionDrawer.svelte';
  import { FIXABLE } from '$shared/fixes';
  import { toast } from 'svelte-sonner';
  import BreakdownChart from '$lib/components/BreakdownChart.svelte';
  import { copyForSheets, downloadCsv, downloadXlsx } from '$lib/export';
  import { api } from '$lib/api';
  import { duration, runEstimates } from '$lib/estimate';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Select from '$lib/components/ui/select';
  import * as Table from '$lib/components/ui/table';
  import { Input } from '$lib/components/ui/input';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { baseDomain, hostOf } from '$shared/core';
  import { FILTERS, isFlagged } from '$lib/categories';
  import { addRule, app, data, go, removeRule, startScan, ui } from '$lib/store.svelte';
  import type { Row } from '$lib/types';

  // How many links show before "Show more", and how many videos an expanded link lists at first.
  const PAGE = 100;
  const VIDEOS_SHOWN = 10;
  const VIDEOS_MORE = 25;
  const report = $derived(app.report!);
  // Full-width table rows must span only the visible columns, or the fixed layout adds a phantom one.
  const sm = new MediaQuery('min-width: 640px');
  const md = new MediaQuery('min-width: 768px');
  // The Status column appears at Tailwind's `sm` breakpoint and "Used in" at `md`, so the table
  // has 2, 3 or 4 columns; the expanded-videos row and the empty-state row use this as colspan.
  const cols = $derived(md.current ? 4 : sm.current ? 3 : 2);
  const scanning = $derived(report.scan?.status === 'fetching' || report.scan?.status === 'checking');

  let filter = $state('attention');
  let query = $state('');
  let sort = $state('videos');
  let channel = $state('all');
  let limit = $state(PAGE);
  let view = $state<'links' | 'videos'>('links');
  // Links whose video list is expanded, and how many videos each one shows so far.
  const open = new SvelteSet<string>();
  const videoLimit = $state<Record<string, number>>({});
  const toggle = (url: string) => (open.has(url) ? open.delete(url) : open.add(url));

  // Rows narrowed by the channel picker. Counts, the chart and the heading all use this, so
  // they agree with each other; the status filter and search only narrow the table.
  const inChannel = $derived(channel === 'all' ? data.rows : data.rows.filter((r) => r.videos.some((v) => v.channelId === channel)));
  const counts = $derived(Object.fromEntries(FILTERS.map((f) => [f.key, inChannel.filter((r) => f.match(r.cls.category)).length])));
  // The table's rows (and what Export saves): status filter, then search over the link, where
  // it ends up, and the titles of the videos using it. Sorted by most videos or A to Z.
  const rows = $derived.by(() => {
    const activeFilter = FILTERS.find((x) => x.key === filter)!;
    const needle = query.trim().toLowerCase();
    const matchesSearch = (r: Row) =>
      !needle ||
      r.url.toLowerCase().includes(needle) ||
      (r.result?.finalUrl ?? '').toLowerCase().includes(needle) ||
      r.videos.some((v) => v.title.toLowerCase().includes(needle));
    const out = inChannel.filter((r) => activeFilter.match(r.cls.category) && matchesSearch(r));
    return out.sort((a, b) => (sort === 'az' ? a.url.localeCompare(b.url) : b.videos.length - a.videos.length));
  });
  const shown = $derived(rows.slice(0, limit));
  // URLs for "Recheck flagged links": everything not OK and not ignored, across all channels.
  const flagged = $derived(data.rows.filter((r) => isFlagged(r.cls.category)).map((r) => r.url));
  // How many problem links each video has, for the "+N other problem links" hint and the
  // "Fix description" button. Same FIXABLE rule as the description drawer, so the counts match
  // what it lists: unverifiable links (probably fine, just blocked) and pending ones (not
  // checked yet) don't count.
  const countsAsProblem = (r: Row) => FIXABLE.includes(r.cls.category);
  const problemsByVideo = $derived.by(() => {
    const perVideo = new Map<string, number>();
    for (const r of data.rows) if (countsAsProblem(r)) for (const v of r.videos) perVideo.set(v.id, (perVideo.get(v.id) ?? 0) + 1);
    return perVideo;
  });
  const channelTitle = $derived(Object.fromEntries(report.channels.map((c) => [c.id, c.title])));

  // Scans and rechecks still allowed today under the workspace's daily limits.
  const left = $derived({
    full: Math.max(0, report.limits.fullScans - report.usedToday.full),
    rechecks: Math.max(0, report.limits.rechecks - report.usedToday.rechecks),
  });
  const lastScan = $derived(report.scan?.finished_at ? ago(report.scan.finished_at) : null);
  /** "just now", "5 min ago", "3 hours ago", "2 days ago", or a date after a month. */
  function ago(iso: string) {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });
  }
  // Heading numbers follow the channel picker.
  const attentionCount = $derived(inChannel.filter((r) => FIXABLE.includes(r.cls.category)).length);
  const videosAffected = $derived(new Set(inChannel.filter((r) => FIXABLE.includes(r.cls.category)).flatMap((r) => r.videos.map((v) => v.id))).size);
  const videosInScope = $derived(channel === 'all' ? report.videos.length : report.videos.filter((v) => v.c === channel).length);
  const plannedCount = $derived(inChannel.filter((r) => FIXABLE.includes(r.cls.category) && data.fixes.has(r.url)).length);
  const scopeChannels = $derived(channel === 'all' ? report.channels : report.channels.filter((c) => c.id === channel));
  const est = $derived(runEstimates(report.estimates, flagged.length));
  // A full scan is offered only if today's shared YouTube quota can cover it.
  const fullTooBig = $derived(est.full.units > report.estimates.quotaLeft);
  // Export file name: "link-report-" plus the workspace name as a lowercase slug.
  const fileBase = $derived(`link-report-${report.workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`);

  /** Exports the rows currently in the table (see lib/export.ts for the formats). */
  async function exportAs(kind: 'csv' | 'xlsx' | 'sheets') {
    try {
      if (kind === 'csv') downloadCsv(rows, channelTitle, data.fixes, fileBase);
      else if (kind === 'xlsx') {
        // Saved descriptions come from the database (full scans save them), so no quota is spent.
        const res = await api<{ descriptions: { id: string; d: string | null; at: string | null }[] }>(`/w/${app.wsId}/descriptions`);
        const descriptions = new Map(res.descriptions.map((x) => [x.id, { d: x.d, at: x.at }]));
        await downloadXlsx(rows, channelTitle, data.fixes, fileBase, { allRows: data.rows, descriptions });
      } else {
        await copyForSheets(rows, channelTitle, data.fixes);
        toast.success(`Copied ${rows.length.toLocaleString()} rows. In Google Sheets, click cell A1 and paste.`);
      }
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  }

  function setFilter(key: string) {
    filter = key;
    limit = PAGE;
  }
  // The ignore rules hiding a link: one for this exact URL, or one for its domain or a parent
  // domain (same matching as classify in shared/core.ts). Unignore removes all of them.
  const ruleFor = (r: Row) => report.rules.filter((x) => x.type === 'ignored' && (x.value === r.url || (!x.value.includes('/') && (r.host === x.value || r.host.endsWith(`.${x.value}`)))));
</script>

<div class="flex flex-wrap items-end justify-between gap-4">
  <div class="min-w-0">
    {#if report.channels.length}
      <div class="flex items-center gap-2">
        <div class="flex -space-x-1.5">
          {#each scopeChannels.slice(0, 4) as c (c.id)}
            {#if c.thumbnail}
              <img src={c.thumbnail} alt="" class="ring-background size-6 rounded-full ring-2" />
            {:else}
              <span class="bg-muted ring-background flex size-6 items-center justify-center rounded-full text-[10px] font-medium ring-2">{c.title[0]}</span>
            {/if}
          {/each}
        </div>
        <span class="text-muted-foreground truncate text-sm">{scopeChannels.map((c) => c.title).join(' · ')}</span>
      </div>
    {/if}
    <h1 class="mt-2 text-2xl font-semibold tracking-tight text-balance">
      {#if !report.videos.length}
        Link report
      {:else if attentionCount}
        {attentionCount.toLocaleString()} link{attentionCount === 1 ? '' : 's'} need{attentionCount === 1 ? 's' : ''} attention
        <span class="text-muted-foreground font-normal">in {videosAffected.toLocaleString()} of {videosInScope.toLocaleString()} videos</span>
      {:else}
        Every link looks good
      {/if}
    </h1>
    <p class="text-muted-foreground mt-1 text-sm tabular-nums">
      {inChannel.length.toLocaleString()} unique links checked{#if plannedCount}{' · '}{plannedCount} with a planned fix{/if}{#if lastScan}{' · '}last scan {lastScan}{/if}
    </p>
  </div>

  <div class="flex gap-2">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger disabled={!rows.length}>
        {#snippet child({ props })}
          <Button {...props} variant="outline"><Download /> Export <ChevronDown class="opacity-60" /></Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-52">
        <DropdownMenu.Label class="text-muted-foreground text-xs font-normal tabular-nums">
          {rows.length.toLocaleString()} links in this view
        </DropdownMenu.Label>
        <DropdownMenu.Item onSelect={() => exportAs('xlsx')}>Excel workbook</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => exportAs('csv')}>CSV file</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => exportAs('sheets')}>Copy for Google Sheets</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger disabled={scanning || !report.channels.length}>
        {#snippet child({ props })}
          <Button {...props}><RefreshCw /> Rescan <ChevronDown class="opacity-60" /></Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <!-- One line per option: what it covers and how long it takes. Quota only comes up when it's short. -->
      <DropdownMenu.Content align="end" class="w-64">
        <DropdownMenu.Item onSelect={() => startScan('full')} disabled={!left.full || fullTooBig}>
          <div>
            <div class="font-medium">Full scan</div>
            <div class="text-muted-foreground text-xs tabular-nums">
              {fullTooBig ? 'Not enough YouTube quota left today' : `Finds new videos · ${duration(est.full.secs)}`}
            </div>
          </div>
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => startScan('urls', flagged)} disabled={!flagged.length || !left.rechecks}>
          <div>
            <div class="font-medium">Recheck flagged links</div>
            <div class="text-muted-foreground text-xs tabular-nums">{flagged.length.toLocaleString()} links · {duration(est.flagged.secs)}</div>
          </div>
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => startScan('all')} disabled={!left.rechecks || !est.all.links}>
          <div>
            <div class="font-medium">Recheck all links</div>
            <div class="text-muted-foreground text-xs tabular-nums">
              {est.all.links ? `${est.all.links.toLocaleString()} links · ${duration(est.all.secs)}` : 'All checked in the last hour'}
            </div>
          </div>
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <div class="text-muted-foreground px-2 py-1.5 text-xs tabular-nums">
          Left today: {left.full} full {left.full === 1 ? 'scan' : 'scans'}, {left.rechecks} {left.rechecks === 1 ? 'recheck' : 'rechecks'}
        </div>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</div>

{#if !report.channels.length}
  <Card.Root class="mt-6">
    <Card.Header>
      <Card.Title>Add a channel to get started</Card.Title>
      <Card.Description>Link Checker reads the public descriptions of a channel's videos and checks every link in them.</Card.Description>
    </Card.Header>
    <Card.Footer><Button onclick={() => go('channels')}>Add a channel</Button></Card.Footer>
  </Card.Root>
{:else if !report.videos.length && !scanning}
  <Card.Root class="mt-6">
    <Card.Header>
      <Card.Title>Run your first scan</Card.Title>
      <Card.Description>A full scan fetches every video description, then checks each link. Large channels take a while; you can close this tab.</Card.Description>
    </Card.Header>
    <Card.Footer><Button onclick={() => startScan('full')}><RefreshCw /> Start full scan</Button></Card.Footer>
  </Card.Root>
{:else}
  <div class="mt-6"><BreakdownChart rows={inChannel} active={filter} onSelect={setFilter} /></div>

  <div class="bg-card mt-4 rounded-lg border">
    <!-- One toolbar: view, status filter, channel, search, sort. -->
    <div class="flex flex-wrap items-center gap-2 border-b p-2">
      <!-- Same height, border and background as the small Select triggers beside it. -->
      <div class="border-input dark:bg-input/30 inline-flex h-7 items-center gap-0.5 rounded-md border p-0.5" role="tablist" aria-label="View">
        {#each [['links', 'Links'], ['videos', 'Videos']] as [k, label] (k)}
          <button
            role="tab"
            aria-selected={view === k}
            class="flex h-full items-center rounded-[4px] px-2 text-sm font-medium transition-colors duration-150 {view === k
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => ((view = k as 'links' | 'videos'), (limit = PAGE))}>{label}</button
          >
        {/each}
      </div>
      <Select.Root type="single" value={filter} onValueChange={(v) => v && setFilter(v)}>
        <Select.Trigger size="sm" class="min-w-0 flex-1 sm:w-52 sm:flex-none" aria-label="Filter by status">
          <span class="flex w-full items-center justify-between gap-2">
            <span>{FILTERS.find((f) => f.key === filter)?.label}</span>
            <span class="text-muted-foreground tabular-nums">{counts[filter]}</span>
          </span>
        </Select.Trigger>
        <Select.Content>
          {#each FILTERS as f (f.key)}
            {#if f.key !== 'pending' || counts.pending}
              <Select.Item value={f.key} label={f.label}>
                <span class="flex w-full items-center justify-between gap-4">
                  <span>{f.label}</span>
                  <span class="text-muted-foreground tabular-nums">{counts[f.key]}</span>
                </span>
              </Select.Item>
            {/if}
          {/each}
        </Select.Content>
      </Select.Root>
      <!-- Phones: search gets its own row; channel and sort share the next. -->
      <div class="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        {#if report.channels.length > 1}
          <Select.Root type="single" bind:value={channel} onValueChange={() => (limit = PAGE)}>
            <Select.Trigger size="sm" class="order-2 min-w-0 flex-1 sm:order-none sm:w-40 sm:flex-none"><span class="truncate">{channel === 'all' ? 'All channels' : channelTitle[channel]}</span></Select.Trigger>
            <Select.Content>
              <Select.Item value="all" label="All channels" />
              {#each report.channels as c (c.id)}<Select.Item value={c.id} label={c.title} />{/each}
            </Select.Content>
          </Select.Root>
        {/if}
        <div class="relative w-full sm:w-56">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input class="h-7 pl-8 text-sm" placeholder="Search links or videos" aria-label="Search links or video titles" bind:value={query} oninput={() => (limit = PAGE)} />
        </div>
        {#if view === 'links'}
          <Select.Root type="single" bind:value={sort}>
            <Select.Trigger size="sm" class="order-3 min-w-0 flex-1 sm:order-none sm:w-32 sm:flex-none" aria-label="Sort">{sort === 'az' ? 'A–Z' : 'Most videos'}</Select.Trigger>
            <Select.Content>
              <Select.Item value="videos" label="Most videos" />
              <Select.Item value="az" label="A–Z" />
            </Select.Content>
          </Select.Root>
        {/if}
      </div>
    </div>

    {#if view === 'videos'}
      <VideosView {rows} allRows={inChannel} {channelTitle} multiChannel={report.channels.length > 1} />
    {:else}
      <Table.Root class="table-fixed">
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class="hidden w-40 pl-4 sm:table-cell">Status</Table.Head>
            <Table.Head class="pl-4 sm:pl-2">Link</Table.Head>
            <Table.Head class="hidden w-32 md:table-cell">Used in</Table.Head>
            <Table.Head class="w-12 pr-4 text-right sm:w-40"><span class="sr-only sm:not-sr-only">Actions</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each shown as r (r.url)}
            {@const final = r.result?.finalUrl}
            <!-- A trailing-slash difference isn't a real move, so it isn't shown as one. -->
            {@const moved = final && final.replace(/\/$/, '') !== r.url.replace(/\/$/, '')}
            {@const startBase = baseDomain(r.host)}
            {@const finalBase = final ? baseDomain(hostOf(final)) : ''}
            {@const isOpen = open.has(r.url)}
            <Table.Row class="align-top {isOpen ? 'border-b-0' : ''}">
              <Table.Cell class="hidden py-3 pl-4 sm:table-cell"><StatusBadge category={r.cls.category} /></Table.Cell>
              <Table.Cell class="py-3 pl-4 whitespace-normal sm:pl-2">
                <!-- Phones: status sits above the link instead of in its own column. It's a plain badge
                     there (no tooltip), since phones can't hover to see one. -->
                <div class="mb-1.5 sm:hidden"><StatusBadge category={r.cls.category} tooltip={false} /></div>
                <a href={r.url} target="_blank" rel="noreferrer" class="font-mono text-xs font-medium break-all hover:underline">{r.url}</a>
                {#if moved}
                  <div class="text-muted-foreground mt-1 line-clamp-2 font-mono text-xs break-all" title={final}>
                    → {final}{#if (r.result?.chain.length ?? 0) > 2}<span class="font-sans"> · {r.result!.chain.length - 1} hops</span>{/if}
                  </div>
                {/if}
                {#if r.cls.detail}<div class="text-muted-foreground mt-1 text-xs">{r.cls.detail}</div>{/if}
                {#if r.cls.accepted}<div class="text-muted-foreground mt-1 text-xs">Accepted redirect</div>{/if}
                <PlannedFix url={r.url} />
                <div class="mt-1.5 flex items-center gap-3 md:hidden">
                  <button class="text-muted-foreground text-xs underline underline-offset-2" aria-expanded={isOpen} onclick={() => toggle(r.url)}>
                    {r.videos.length} video{r.videos.length === 1 ? '' : 's'}
                  </button>
                  {#if r.cls.category === 'domain-changed' && finalBase}
                    <Button size="sm" variant="outline" class="h-7 sm:hidden" onclick={() => addRule('accepted', startBase, finalBase)}>Accept</Button>
                  {:else if r.cls.category === 'ignored'}
                    <Button size="sm" variant="outline" class="h-7 sm:hidden" onclick={() => ruleFor(r).forEach((x) => removeRule(x.id))}>Unignore</Button>
                  {/if}
                </div>
              </Table.Cell>
              <Table.Cell class="hidden py-3 md:table-cell">
                <button
                  class="hover:bg-muted -mx-1.5 -my-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm tabular-nums transition-colors duration-150"
                  aria-expanded={isOpen}
                  onclick={() => toggle(r.url)}
                >
                  <ChevronRight class="text-muted-foreground size-3.5 transition-transform duration-150 {isOpen ? 'rotate-90' : ''}" />
                  {r.videos.length} video{r.videos.length === 1 ? '' : 's'}
                </button>
              </Table.Cell>
              <Table.Cell class="py-3 pr-4">
                <div class="flex justify-end gap-1">
                  {#if r.cls.category === 'domain-changed' && finalBase}
                    <Hint text="Mark {startBase} → {finalBase} as an expected redirect. Every link that makes this move counts as OK in this workspace.">
                      {#snippet children(props)}
                        <Button {...props} size="sm" variant="outline" class="hidden sm:inline-flex" onclick={() => addRule('accepted', startBase, finalBase)}>Accept</Button>
                      {/snippet}
                    </Hint>
                  {:else if r.cls.category === 'ignored'}
                    <Hint text="Remove the ignore rule that hides this link, so it shows in the report again.">
                      {#snippet children(props)}
                        <Button {...props} size="sm" variant="outline" class="hidden sm:inline-flex" onclick={() => ruleFor(r).forEach((x) => removeRule(x.id))}>Unignore</Button>
                      {/snippet}
                    </Hint>
                  {/if}
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      {#snippet child({ props })}
                        <Button {...props} size="icon-sm" variant="ghost" aria-label="More actions"><Ellipsis /></Button>
                      {/snippet}
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" class="w-80 max-w-[calc(100vw-2rem)]">
                      <FixMenuItems row={r} />
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item disabled={scanning || !left.rechecks} onSelect={() => startScan('urls', [r.url])}>Recheck now</DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => window.open(r.url, '_blank', 'noreferrer')}>Open link</DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
              </Table.Cell>
            </Table.Row>
            {#if isOpen}
              {@const vids = r.videos.slice(0, videoLimit[r.url] ?? VIDEOS_SHOWN)}
              {@const channelCount = new Set(r.videos.map((v) => v.channelId)).size}
              <Table.Row class="hover:bg-transparent">
                <Table.Cell colspan={cols} class="px-4 pt-0 pb-4 whitespace-normal">
                  <div class="bg-muted/40 rounded-md border">
                    <div class="text-muted-foreground flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
                      <span>
                        Used in <span class="text-foreground font-medium tabular-nums">{r.videos.length}</span> video{r.videos.length === 1 ? '' : 's'}
                        {#if report.channels.length > 1}
                          across {channelCount} channel{channelCount === 1 ? '' : 's'}
                        {/if}
                      </span>
                    </div>
                    <ul class="divide-y">
                      {#each vids as v (v.id)}
                        <!-- Problem links in this video besides the one this row is about. -->
                        {@const others = (problemsByVideo.get(v.id) ?? 0) - (countsAsProblem(r) ? 1 : 0)}
                        <li class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                          <img
                            src="https://i.ytimg.com/vi/{v.id}/mqdefault.jpg"
                            alt=""
                            loading="lazy"
                            class="bg-muted aspect-video w-16 shrink-0 rounded-[4px] object-cover"
                          />
                          <div class="min-w-0 flex-1 basis-40">
                            <div class="truncate text-sm" title={v.title}>{v.title}</div>
                            <div class="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                              {#if report.channels.length > 1}<span>{channelTitle[v.channelId]}</span>{/if}
                              {#if others > 0}<span class="text-[#8a5a00] dark:text-[#fac34d]">+{others} other problem link{others === 1 ? '' : 's'}</span>{/if}
                            </div>
                          </div>
                          <!-- Phones: the buttons wrap as one row under the video. -->
                          <div class="flex shrink-0 items-center gap-3 max-sm:w-full">
                          <a class="text-muted-foreground hover:text-foreground shrink-0 text-xs" href="https://www.youtube.com/watch?v={v.id}" target="_blank" rel="noreferrer">Watch</a>
                          {#if problemsByVideo.get(v.id)}
                            <button
                              class="hover:bg-background inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors duration-150"
                              onclick={() => (ui.drawerVideoId = v.id)}
                            >
                              <FileText class="size-3" /> Fix description
                            </button>
                          {/if}
                          <a
                            class="hover:bg-background inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors duration-150"
                            href="https://studio.youtube.com/video/{v.id}/edit"
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span class="max-sm:hidden">Edit in</span> Studio <ExternalLink class="size-3" />
                          </a>
                          </div>
                        </li>
                      {/each}
                    </ul>
                    {#if r.videos.length > vids.length}
                      <div class="border-t px-3 py-2">
                        <button
                          class="text-muted-foreground hover:text-foreground text-xs"
                          onclick={() => (videoLimit[r.url] = (videoLimit[r.url] ?? VIDEOS_SHOWN) + VIDEOS_MORE)}
                        >
                          Show {Math.min(VIDEOS_MORE, r.videos.length - vids.length)} more of {r.videos.length}
                        </button>
                      </div>
                    {/if}
                  </div>
                </Table.Cell>
              </Table.Row>
            {/if}
          {:else}
            <Table.Row class="hover:bg-transparent">
              <Table.Cell colspan={cols} class="text-muted-foreground py-14 text-center text-sm">
                {query ? `No links match "${query}" in this filter.` : 'No links in this category.'}
                {#if filter !== 'all'}<button class="text-foreground ml-1 underline underline-offset-2" onclick={() => setFilter('all')}>Show all links</button>{/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
      {#if rows.length > shown.length}
        <div class="border-t p-3 text-center">
          <Button variant="outline" size="sm" onclick={() => (limit += PAGE)}>
            Show {Math.min(PAGE, rows.length - shown.length)} more ({(rows.length - shown.length).toLocaleString()} left)
          </Button>
        </div>
      {/if}
    {/if}
  </div>

  <p class="text-muted-foreground mx-auto mt-10 mb-4 flex max-w-xl items-start justify-center gap-2 px-6 text-center text-xs">
    <Info class="mt-px size-3.5 shrink-0" />
    <span>
      Link check results are shared across all workspaces, since they're public links on public videos. Your channels, members and exception
      lists are private to this workspace.
    </span>
  </p>
{/if}

<FixLinkDialog />
<DescriptionDrawer />
<!-- Keeps the end of the list reachable above the open drawer, which overlays the page. -->
<div style="height: {ui.drawerHeight}px" aria-hidden="true"></div>
