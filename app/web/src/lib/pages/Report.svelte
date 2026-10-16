<script lang="ts">
  // Report page (#/report, the default), laid out like an email inbox: a header strip (summary,
  // health bar, Export and Rescan), then a list pane of links or videos with filters, search and
  // sort, and a content pane for the picked link (LinkDetail) or video (VideoDetail). The panes
  // scroll on their own and the list pane can be resized; in a narrow window they stack, and
  // the content pane opens over the list with a back button. Collapsing the list (focus mode)
  // leaves the content pane, which then moves through the list with its own up and down arrows. All rows come from `data.rows` in
  // store.svelte.ts, already classified in the browser with this workspace's rules, so
  // filtering, searching and the counts here never call the server. Other pages open a video
  // here through `ui.openVideo`.
  import { tick } from 'svelte';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Info from '@lucide/svelte/icons/info';
  import Search from '@lucide/svelte/icons/search';
  import Download from '@lucide/svelte/icons/download';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import X from '@lucide/svelte/icons/x';
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
  import Tv from '@lucide/svelte/icons/tv';
  import FixLinkDialog from '$lib/components/FixLinkDialog.svelte';
  import Hint from '$lib/components/Hint.svelte';
  import LinkDetail from '$lib/components/LinkDetail.svelte';
  import VideoDetail from '$lib/components/VideoDetail.svelte';
  import Resizer from '$lib/components/Resizer.svelte';
  import { FIXABLE } from '$shared/fixes';
  import { toast } from 'svelte-sonner';
  import BreakdownChart from '$lib/components/BreakdownChart.svelte';
  import { copyForSheets, downloadCsv, downloadXlsx } from '$lib/export';
  import { duration, runEstimates } from '$lib/estimate';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Input } from '$lib/components/ui/input';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { FILTERS, isFlagged } from '$lib/categories';
  import { app, data, go, layout, loadDescriptions, startScan, ui } from '$lib/store.svelte';
  import { groupVideos, movedTo, shortDate } from '$lib/videoGroups';
  import type { Row } from '$lib/types';

  // How many links (or videos) the list shows before "Show more".
  const PAGE = 100;
  const VIDEO_PAGE = 50;
  const report = $derived(app.report!);
  const scanning = $derived(report.scan?.status === 'fetching' || report.scan?.status === 'checking');

  let filter = $state('attention');
  let query = $state('');
  let sort = $state('videos');
  let channel = $state('all');
  let limit = $state(PAGE);
  let view = $state<'links' | 'videos'>('links');
  // Search shows as an icon until clicked; the field focuses when it opens.
  let searching = $state(false);
  let searchEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (searching) searchEl?.focus();
  });

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
  // The scan details behind the heading's info icon.
  const scanSummary = $derived(
    [
      scopeChannels.map((c) => c.title).join(', '),
      `${inChannel.length.toLocaleString()} unique links checked`,
      plannedCount ? `${plannedCount} with a planned fix` : '',
      lastScan ? `Last scan ${lastScan}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
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
        const descriptions = await loadDescriptions();
        await downloadXlsx(rows, channelTitle, data.fixes, fileBase, { allRows: data.rows, descriptions, textEdits: app.report?.textEdits ?? [] });
      } else {
        await copyForSheets(rows, channelTitle, data.fixes);
        toast.success(`Copied ${rows.length.toLocaleString()} rows. In Google Sheets, click cell A1 and paste.`);
      }
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  }

  const filterLabel = $derived(FILTERS.find((f) => f.key === filter)?.label);
  const sortLabel = $derived(sort === 'az' ? 'A–Z' : 'Most videos');

  function setFilter(key: string) {
    filter = key;
    limit = PAGE;
  }

  // ---- the Videos view: the same rows grouped by video ----
  const groups = $derived(groupVideos(rows, inChannel));
  // Back to the first page whenever the filtered rows change; "Show more" raises it.
  let videoLimit = $derived.by(() => {
    void rows;
    return VIDEO_PAGE;
  });
  const shownGroups = $derived(groups.slice(0, videoLimit));

  // ---- panes ----
  // Side by side when there's room for both; otherwise the list, with the picked item opening
  // over it (`stacked` and `detailOpen`).
  const LIST_MIN = 260;
  const DETAIL_MIN = 380;
  let width = $state(0);
  const stacked = $derived(width < LIST_MIN + DETAIL_MIN);
  const listMax = $derived(Math.max(LIST_MIN, Math.min(width * 0.6, width - DETAIL_MIN)));
  const listWidth = $derived(Math.min(Math.max(layout.listWidth.value, LIST_MIN), listMax));
  let detailOpen = $state(false);
  const collapsed = $derived(layout.listCollapsed.value && !stacked);

  // What's open in the content pane. Side by side, the first item opens until another is picked.
  let pickedLink = $state<string | null>(null);
  let pickedVideo = $state<string | null>(null);
  const currentLink = $derived(rows.find((r) => r.url === pickedLink) ?? (stacked ? null : (rows[0] ?? null)));
  const currentGroup = $derived(groups.find((g) => g.video.id === pickedVideo) ?? (stacked ? null : (groups[0] ?? null)));
  // The open video's tab, kept while moving between videos, and a link for its description to scroll to.
  let tab = $state<'links' | 'description'>('description');
  let focus = $state<{ url: string; n: number } | null>(null);
  let focusCount = 0;

  /** Opens a link or video in the content pane and keeps its row in view in the list. */
  async function pick(kind: 'link' | 'video', key: string) {
    if (kind === 'link') pickedLink = key;
    else pickedVideo = key;
    detailOpen = true;
    // Show enough of the list to include it.
    if (kind === 'video') {
      const at = groups.findIndex((g) => g.video.id === key);
      if (at >= videoLimit) videoLimit = Math.ceil((at + 1) / VIDEO_PAGE) * VIDEO_PAGE;
    } else {
      const at = rows.findIndex((r) => r.url === key);
      if (at >= limit) limit = Math.ceil((at + 1) / PAGE) * PAGE;
    }
    await tick();
    rowEl(kind, key)?.scrollIntoView({ block: 'nearest' });
  }
  const rowEl = (kind: 'link' | 'video', key: string) =>
    document.querySelector<HTMLElement>(`[data-${kind}="${CSS.escape(key)}"]`);

  // Requests from elsewhere, e.g. a link's "Fix description" button.
  $effect(() => {
    const req = ui.openVideo;
    if (!req) return;
    ui.openVideo = null;
    view = 'videos';
    tab = req.tab;
    if (req.url) focus = { url: req.url, n: ++focusCount };
    pick('video', req.id);
  });
  function locate(url: string) {
    tab = 'description';
    focus = { url, n: ++focusCount };
  }
  /** The items before and after the open one in the list's order, for the content pane's arrows. */
  const around = $derived.by(() => {
    const keys = view === 'links' ? rows.map((r) => r.url) : groups.map((g) => g.video.id);
    const now = view === 'links' ? currentLink?.url : currentGroup?.video.id;
    const at = now ? keys.indexOf(now) : -1;
    return { prev: at > 0 ? keys[at - 1] : null, next: keys[at + 1] ?? null };
  });
  const step = (key: string | null) => (key ? () => pick(view === 'links' ? 'link' : 'video', key) : null);

  // Up and down arrows move through the list, opening each item, like an email inbox.
  function listKeys(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if ((e.target as HTMLElement).closest('input, [role="combobox"]')) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? around.next : around.prev;
    if (!next) return;
    const kind = view === 'links' ? 'link' : 'video';
    pick(kind, next).then(() => rowEl(kind, next)?.focus());
  }
  function setView(v: 'links' | 'videos') {
    view = v;
    limit = PAGE;
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <!-- Header strip: what needs attention, link health, Export and Rescan. When it's tight (e.g. a
       half-width window) the buttons lose their labels and the health bar gets its own row. -->
  <header class="@container flex flex-none flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2.5">
    <div class="min-w-0 flex-[1_1_16rem]">
      <h1 class="text-base leading-snug font-semibold text-balance">
        {#if !report.videos.length}
          Link report
        {:else if attentionCount}
          {attentionCount.toLocaleString()} link{attentionCount === 1 ? '' : 's'} need{attentionCount === 1 ? 's' : ''} attention
          <span class="text-muted-foreground font-normal">in {videosAffected.toLocaleString()} of {videosInScope.toLocaleString()} videos</span>
        {:else}
          Every link looks good
        {/if}
        <!-- The scan details, on hover or focus, instead of a second line. -->
        <Hint text={scanSummary}>
          {#snippet children(props)}
            <button {...props} type="button" class="text-muted-foreground hover:text-foreground -my-1 inline-flex size-6 items-center justify-center rounded-md align-middle transition-colors duration-150" aria-label="Scan details">
              <Info class="size-3.5" />
            </button>
          {/snippet}
        </Hint>
      </h1>
    </div>
    {#if report.videos.length}
      <div class="order-last min-w-0 basis-full @4xl:order-none @4xl:max-w-md @4xl:flex-[1_1_16rem] @4xl:basis-auto"><BreakdownChart rows={inChannel} active={filter} onSelect={setFilter} /></div>
    {/if}
    <div class="flex shrink-0 gap-2">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger disabled={!rows.length}>
          {#snippet child({ props })}
            <Button {...props} size="sm" variant="outline" aria-label="Export" title="Export"><Download /><span class="@max-4xl:hidden">Export</span> <ChevronDown class="opacity-60" /></Button>
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
            <Button {...props} size="sm" aria-label="Rescan" title="Rescan"><RefreshCw /><span class="@max-4xl:hidden">Rescan</span> <ChevronDown class="opacity-60" /></Button>
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
  </header>

  {#if !report.channels.length}
    <div class="min-h-0 flex-1 overflow-y-auto p-6">
      <Card.Root class="mx-auto max-w-xl">
        <Card.Header>
          <Card.Title>Add a channel to get started</Card.Title>
          <Card.Description>Link Checker reads the public descriptions of a channel's videos and checks every link in them.</Card.Description>
        </Card.Header>
        <Card.Footer><Button onclick={() => go('channels')}>Add a channel</Button></Card.Footer>
      </Card.Root>
    </div>
  {:else if !report.videos.length && !scanning}
    <div class="min-h-0 flex-1 overflow-y-auto p-6">
      <Card.Root class="mx-auto max-w-xl">
        <Card.Header>
          <Card.Title>Run your first scan</Card.Title>
          <Card.Description>A full scan fetches every video description, then checks each link. Large channels take a while; you can close this tab.</Card.Description>
        </Card.Header>
        <Card.Footer><Button onclick={() => startScan('full')}><RefreshCw /> Start full scan</Button></Card.Footer>
      </Card.Root>
    </div>
  {:else}
    <div class="flex min-h-0 flex-1" bind:clientWidth={width}>
      <!-- List pane -->
      {#if !collapsed && (!stacked || !detailOpen || !(view === 'links' ? currentLink : currentGroup))}
        <section
          class="flex min-h-0 flex-col {stacked ? 'w-full' : 'shrink-0'}"
          style={stacked ? undefined : `width: ${listWidth}px`}
          aria-label={view === 'links' ? 'Links' : 'Videos'}
        >
          <!-- Toolbar, one row: the Links | Videos switcher (search replaces it while it's used),
               then icon menus for the status filter and channel, and the collapse button. A dot
               marks a menu that's changed. -->
          <div class="flex h-11 flex-none items-center gap-0.5 border-b px-2">
            {#if searching || query}
              <div class="relative min-w-0 flex-1">
                <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  bind:ref={searchEl}
                  class="h-7 pr-7 pl-8 text-sm"
                  placeholder="Search links or videos"
                  aria-label="Search links or video titles"
                  bind:value={query}
                  oninput={() => (limit = PAGE)}
                  onkeydown={(e) => e.key === 'Escape' && ((query = ''), (searching = false))}
                  onblur={() => !query && (searching = false)}
                />
                {#if query}
                  <button
                    class="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5"
                    aria-label="Clear search"
                    onclick={() => ((query = ''), (searching = false))}><X class="size-3.5" /></button
                  >
                {/if}
              </div>
            {:else}
              <!-- Same look as the video pane's Links | Description switcher. -->
              <div class="border-input bg-background ml-1 inline-flex h-7 shrink-0 items-center rounded-md border p-0.5" role="tablist" aria-label="List">
                {#each [['links', 'Links'], ['videos', 'Videos']] as const as [k, text] (k)}
                  <button
                    role="tab"
                    aria-selected={view === k}
                    class="flex h-full items-center rounded-[4px] px-2 text-xs font-medium transition-colors duration-150 {view === k
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => setView(k)}>{text}</button
                  >
                {/each}
              </div>
              <div class="flex-1"></div>
              <Button size="icon-sm" variant="ghost" aria-label="Search" title="Search" onclick={() => (searching = true)}><Search /></Button>
            {/if}

            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button {...props} size="icon-sm" variant="ghost" class="relative" aria-label="Filter by status: {filterLabel}" title="Filter by status">
                    <ListFilter />{#if filter !== 'attention'}<span class="bg-foreground absolute top-1 right-1 size-1.5 rounded-full"></span>{/if}
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="w-60">
                <DropdownMenu.Label class="text-muted-foreground text-xs font-normal">Status</DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={filter} onValueChange={(v) => v && setFilter(v)}>
                  {#each FILTERS as f (f.key)}
                    {#if f.key !== 'pending' || counts.pending}
                      <DropdownMenu.RadioItem value={f.key}>
                        {f.label}<span class="text-muted-foreground ml-auto text-xs tabular-nums">{counts[f.key]}</span>
                      </DropdownMenu.RadioItem>
                    {/if}
                  {/each}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Root>

            {#if report.channels.length > 1}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <Button {...props} size="icon-sm" variant="ghost" class="relative" aria-label="Channel: {channel === 'all' ? 'All channels' : channelTitle[channel]}" title="Channel">
                      <Tv />{#if channel !== 'all'}<span class="bg-foreground absolute top-1 right-1 size-1.5 rounded-full"></span>{/if}
                    </Button>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" class="w-60">
                  <DropdownMenu.Label class="text-muted-foreground text-xs font-normal">Channel</DropdownMenu.Label>
                  <DropdownMenu.RadioGroup value={channel} onValueChange={(v) => v && ((channel = v), (limit = PAGE))}>
                    <DropdownMenu.RadioItem value="all">All channels</DropdownMenu.RadioItem>
                    {#each report.channels as c (c.id)}<DropdownMenu.RadioItem value={c.id}><span class="truncate">{c.title}</span></DropdownMenu.RadioItem>{/each}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            {/if}

            {#if !stacked}
              <Button size="icon-sm" variant="ghost" aria-label="Collapse the list" title="Collapse the list (focus on one item)" onclick={() => (layout.listCollapsed.value = true)}><PanelLeftClose /></Button>
            {/if}
          </div>

          <!-- What the list shows, and the sort order for links. -->
          <div class="text-muted-foreground flex h-8 flex-none items-center gap-2 border-b pr-1.5 pl-3 text-xs">
            <span class="min-w-0 flex-1 truncate">
              {filterLabel}{#if channel !== 'all'}{' · '}{channelTitle[channel]}{/if} · <span class="tabular-nums">{(view === 'links' ? rows.length : groups.length).toLocaleString()}</span>
            </span>
            {#if view === 'links'}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <Button {...props} size="xs" variant="ghost" class="text-muted-foreground shrink-0 font-normal" aria-label="Sort: {sortLabel}">{sortLabel} <ChevronDown class="opacity-60" /></Button>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" class="w-48">
                  <DropdownMenu.Label class="text-muted-foreground text-xs font-normal">Sort</DropdownMenu.Label>
                  <DropdownMenu.RadioGroup bind:value={sort}>
                    <DropdownMenu.RadioItem value="videos">Most videos</DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="az">A–Z</DropdownMenu.RadioItem>
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            {/if}
          </div>

          <!-- The list scrolls on its own. A container, so video rows turn into cards when it's narrow. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="@container min-h-0 flex-1 overflow-y-auto overscroll-contain" onkeydown={listKeys}>
            {#if view === 'links'}
              {#each shown as r (r.url)}
                {@const final = movedTo(r)}
                {@const on = !stacked && currentLink?.url === r.url}
                <button
                  data-link={r.url}
                  class="block w-full border-b px-3 py-2.5 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset {on
                    ? 'bg-muted'
                    : 'hover:bg-muted/50'}"
                  aria-current={on ? 'true' : undefined}
                  onclick={() => pick('link', r.url)}
                >
                  <span class="flex items-center justify-between gap-2">
                    <StatusBadge category={r.cls.category} tooltip={false} />
                    <span class="text-muted-foreground text-xs whitespace-nowrap tabular-nums">{r.videos.length} video{r.videos.length === 1 ? '' : 's'}</span>
                  </span>
                  <span class="mt-1 line-clamp-2 font-mono text-xs font-medium break-all">{r.url}</span>
                  {#if final}<span class="text-muted-foreground block truncate font-mono text-xs">→ {final}</span>{/if}
                  {#if data.fixes.has(r.url)}<span class="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs"><PencilLine class="size-3" /> Fix planned</span>{/if}
                </button>
              {:else}
                <div class="text-muted-foreground px-4 py-14 text-center text-sm">
                  {query ? `No links match "${query}" in this filter.` : 'No links in this category.'}
                  {#if filter !== 'all'}<button class="text-foreground ml-1 underline underline-offset-2" onclick={() => setFilter('all')}>Show all links</button>{/if}
                </div>
              {/each}
              {#if rows.length > shown.length}
                <div class="border-b p-3 text-center">
                  <Button variant="outline" size="sm" onclick={() => (limit += PAGE)}>
                    Show {Math.min(PAGE, rows.length - shown.length)} more ({(rows.length - shown.length).toLocaleString()} left)
                  </Button>
                </div>
              {/if}
            {:else}
              {#each shownGroups as g (g.video.id)}
                {@const v = g.video}
                {@const on = !stacked && currentGroup?.video.id === v.id}
                {@const published = shortDate(v.publishedAt)}
                {@const summary = g.chips.map((c) => `${c.n} ${c.label}`).join(' · ')}
                <!-- A row with the thumbnail on the left; a card with it on top when the pane is narrow. -->
                <button
                  data-video={v.id}
                  class="flex w-full gap-3 border-b px-3 py-2.5 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset @max-2xs:flex-col @max-2xs:gap-2 {on
                    ? 'bg-muted'
                    : 'hover:bg-muted/50'}"
                  aria-current={on ? 'true' : undefined}
                  onclick={() => pick('video', v.id)}
                >
                  <img
                    src="https://i.ytimg.com/vi/{v.id}/mqdefault.jpg"
                    alt=""
                    loading="lazy"
                    width="96"
                    height="54"
                    class="bg-muted aspect-video w-24 shrink-0 rounded-md border object-cover @max-2xs:w-full"
                  />
                  <span class="block min-w-0 flex-1">
                    <span class="line-clamp-2 text-sm leading-snug font-medium" title={v.title}>{v.title}</span>
                    <span class="text-muted-foreground mt-0.5 block truncate text-xs">
                      {#if report.channels.length > 1}{channelTitle[v.channelId] ?? 'Unknown channel'}{#if published}{' · '}{/if}{/if}{published ?? ''}
                    </span>
                    <!-- Traffic lights: one dot per kind of link in the video; the counts are in the tooltip. -->
                    <Hint text={summary}>
                      {#snippet children(props)}
                        <span {...props} class="mt-1.5 inline-flex items-center gap-1 py-0.5" aria-label={summary}>
                          {#each g.chips as c (c.label)}<span class="size-2.5 rounded-full" style="background: {c.color}"></span>{/each}
                        </span>
                      {/snippet}
                    </Hint>
                  </span>
                </button>
              {:else}
                <div class="text-muted-foreground px-4 py-14 text-center text-sm">Nothing here.</div>
              {/each}
              {#if groups.length > shownGroups.length}
                <div class="border-b p-3 text-center">
                  <Button variant="outline" size="sm" onclick={() => (videoLimit += VIDEO_PAGE)}>
                    Show {Math.min(VIDEO_PAGE, groups.length - shownGroups.length)} more ({(groups.length - shownGroups.length).toLocaleString()} left)
                  </Button>
                </div>
              {/if}
            {/if}
            <p class="text-muted-foreground flex items-start gap-2 px-4 py-4 text-xs">
              <Info class="mt-px size-3.5 shrink-0" />
              <span>
                Link check results are shared across all workspaces, since they're public links on public videos. Your channels, members and
                exception lists are private to this workspace.
              </span>
            </p>
          </div>
        </section>
      {/if}

      {#if !stacked && !collapsed}
        <Resizer bind:size={layout.listWidth.value} min={LIST_MIN} max={listMax} initial={340} label="Resize the list" />
      {/if}

      <!-- Content pane -->
      {#if !stacked || detailOpen}
        {@const back = stacked ? () => (detailOpen = false) : null}
        {@const expand = collapsed ? () => (layout.listCollapsed.value = false) : null}
        <section class="min-h-0 min-w-0 flex-1" aria-label={view === 'links' ? 'Link' : 'Video'}>
          {#if view === 'links' && currentLink}
            <LinkDetail row={currentLink} {channelTitle} canRecheck={!scanning && left.rechecks > 0} onback={back} onexpand={expand} onprev={step(around.prev)} onnext={step(around.next)} />
          {:else if view === 'videos' && currentGroup}
            <VideoDetail
              group={currentGroup}
              bind:tab
              {focus}
              {channelTitle}
              multiChannel={report.channels.length > 1}
              onlocate={locate}
              onback={back}
              onexpand={expand}
              onprev={step(around.prev)}
              onnext={step(around.next)}
            />
          {:else if !stacked}
            <div class="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-sm">
              {view === 'links' ? 'No link to show in this filter.' : 'No video to show in this filter.'}
            </div>
          {/if}
        </section>
      {/if}
    </div>
  {/if}
</div>

<FixLinkDialog />
