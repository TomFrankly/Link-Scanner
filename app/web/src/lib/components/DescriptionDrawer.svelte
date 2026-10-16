<script lang="ts">
  // Bottom drawer for fixing one video's description. It doesn't block the page, so the
  // report stays scrollable behind it, and its top edge can be dragged to resize it.
  //
  // Mounted once by the Report page and opened by setting `ui.drawerVideoId` (the "Fix
  // description" buttons). The video's problem links come from `data.rows`, their planned
  // fixes from `data.fixes`, and the description itself is fetched fresh from the API.
  // The workspace's saved text edits (shared/textEdits.ts) run first, then the link fixes
  // (shared/fixes.ts). Hand edits typed here can be saved as new text edits, optionally for
  // every other video with the same lines (SaveEditsDialog). Nothing changes on YouTube: the
  // user copies the result into YouTube Studio.
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import X from '@lucide/svelte/icons/x';
  import Copy from '@lucide/svelte/icons/copy';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Save from '@lucide/svelte/icons/save';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import SaveEditsDialog from './SaveEditsDialog.svelte';
  import DescriptionEditor, { type LinkClick } from './DescriptionEditor.svelte';
  import LinkPopover from './LinkPopover.svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import PlanFixButton from './PlanFixButton.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import StatusBadge from './StatusBadge.svelte';
  import PlannedFix from './PlannedFix.svelte';
  import { api } from '$lib/api';
  import { app, data, removeTextEdit, ui } from '$lib/store.svelte';
  import { applyFixes, FIXABLE, REDIRECTS, removeLinks, updateRedirects, type FixResult, type Problem } from '$shared/fixes';
  import { applyTextEdits, editsFromHandEdit, splitLinkSwaps, type FoundEdit, type LinkSwap } from '$shared/textEdits';

  const MIN = 220;
  // Room left above the drawer at full height, so the top bar stays visible.
  const TOP_GAP = 72;
  // Default height before the user has resized it, as a share of the window.
  const DEFAULT_SHARE = 0.6;
  // How far one arrow-key press on the handle resizes it, in px.
  const KEY_STEP = 40;
  // The chosen height is remembered per browser.
  const HEIGHT_KEY = 'ytlinks-drawer-h';
  const maxHeight = () => window.innerHeight - TOP_GAP;
  let height = $state(0);
  onMount(() => {
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(HEIGHT_KEY)) || 0;
    } catch {
      /* private mode */
    }
    height = Math.min(Math.max(saved || window.innerHeight * DEFAULT_SHARE, MIN), maxHeight());
  });
  // Publish the height so the report can pad its end and the Help button can sit above it.
  $effect(() => {
    ui.drawerHeight = ui.drawerVideoId ? height : 0;
  });

  // ---- resize by dragging the top edge ----
  let dragging = $state(false);
  function startDrag(e: PointerEvent) {
    dragging = true;
    // Capture keeps move events coming to the handle even when the pointer outruns it.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function drag(e: PointerEvent) {
    if (dragging) height = Math.min(Math.max(window.innerHeight - e.clientY, MIN), maxHeight());
  }
  function endDrag() {
    dragging = false;
    try {
      localStorage.setItem(HEIGHT_KEY, String(Math.round(height)));
    } catch {
      /* private mode */
    }
  }
  function keyResize(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') height = Math.min(height + KEY_STEP, maxHeight());
    else if (e.key === 'ArrowDown') height = Math.max(height - KEY_STEP, MIN);
    else return;
    e.preventDefault();
  }

  // ---- the video and its problem links ----
  const video = $derived.by(() => {
    for (const r of data.rows) for (const v of r.videos) if (v.id === ui.drawerVideoId) return v;
    return null;
  });
  // This video's links that the fixes act on, in the shape shared/fixes.ts expects: problem links
  // (broken or redirected), plus any working link with a planned fix (e.g. a swapped affiliate link).
  const links = $derived(
    data.rows.filter((r) => r.videos.some((v) => v.id === ui.drawerVideoId) && (FIXABLE.includes(r.cls.category) || data.fixes.for(r.url, video?.channelId ?? ''))),
  );
  const problems = $derived<Problem[]>(
    links.map((r) => ({ url: r.url, category: r.cls.category, finalUrl: r.result?.finalUrl ?? null, detail: r.cls.detail ?? null })),
  );
  // Just the broken or redirected ones, for the "Remove all" and "Update all redirects" tabs.
  const problemOnly = $derived(problems.filter((p) => FIXABLE.includes(p.category)));
  // The planned fix for each of those links, keyed by URL; links without one get a FIX THIS marker.
  const decisions = $derived(
    Object.fromEntries(
      links.flatMap((r) => {
        const fix = data.fixes.for(r.url, video?.channelId ?? '');
        return fix ? [[r.url, { action: fix.action, replacement: fix.replacement }]] : [];
      }),
    ),
  );
  // The "Update all redirects" tab only shows when there's a redirect to update.
  const hasRedirects = $derived(problems.some((p) => REDIRECTS.includes(p.category) && p.finalUrl && p.finalUrl !== p.url));

  // ---- description: fetched fresh from YouTube each time a video opens ----
  let description = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  // Not state, so writing it here doesn't rerun the effect. It skips refetching the video already loaded.
  let loadedFor = '';
  $effect(() => {
    const id = ui.drawerVideoId;
    if (!id || id === loadedFor) return;
    loadedFor = id;
    description = null;
    loadError = null;
    edited = false;
    // The checks drop a reply that arrives after the user has moved on to another video.
    api<{ description: string }>(`/w/${app.wsId}/videos/${encodeURIComponent(id)}/description`)
      .then((r) => ui.drawerVideoId === id && (description = r.description))
      .catch((e) => ui.drawerVideoId === id && (loadError = (e as Error).message));
  });

  // The tabs above the editor: apply planned fixes (unplanned links get a marker), remove every
  // problem link, swap every redirect for where it lands now, or show the original text.
  let mode = $state<'apply' | 'remove' | 'redirects' | 'original'>('apply');
  // The description with the workspace's saved text edits applied; the link fixes run on this.
  const textEdits = $derived(app.report?.textEdits ?? []);
  const source = $derived(description === null ? null : applyTextEdits(description, textEdits, ui.drawerVideoId ?? '', video?.channelId ?? ''));
  // The saved edits that changed this video, listed beside the editor.
  const savedHere = $derived((source?.used ?? []).map((i) => textEdits[i]!));
  const generated = $derived.by((): FixResult | null => {
    if (description === null || source === null) return null;
    if (mode === 'original') return { text: description, changed: 0, parts: [{ text: description }], origin: description.split('\n').map((_, i) => i) };
    const fixed =
      mode === 'remove' ? removeLinks(source.text, problemOnly) : mode === 'redirects' ? updateRedirects(source.text, problemOnly) : applyFixes(source.text, problems, decisions);
    return { ...fixed, changed: fixed.changed + source.changed };
  });

  // The editable text follows the generated text until the user types in it.
  let text = $state('');
  let edited = $state(false);
  $effect(() => {
    if (generated && !edited) text = generated.text;
  });
  // What the text looked like when the user started typing, so a save compares against that
  // even if a planned fix changes the generated text meanwhile.
  let editBase = $state<{ source: string; shown: FixResult } | null>(null);
  // A planned fix changed the generated text after the user started editing.
  const stale = $derived(edited && generated !== null && editBase !== null && generated.text !== editBase.shown.text);
  function onInput() {
    if (!edited && source && generated) editBase = { source: source.text, shown: generated };
    edited = true;
  }

  // Highlight changed spots by searching the current text, so they survive hand edits.
  // `generated.parts` marks each changed run with `hl`; those runs are what we search for.
  const needles = $derived([
    ...(generated?.parts ?? []).filter((p) => p.hl && p.text.trim()).map((p) => p.text),
    ...(mode !== 'original' ? (source?.added ?? []) : []),
  ]);
  // Highlight color per tab: red for removals, green for updated redirects, amber otherwise.
  const tint = $derived(
    mode === 'remove' ? 'bg-[#d03b3b]/15 dark:bg-[#d03b3b]/30' : mode === 'redirects' ? 'bg-[#0ca30c]/15 dark:bg-[#0ca30c]/30' : 'bg-[#fab219]/30',
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Description copied. Paste it into YouTube Studio.');
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.');
    }
  }
  function reset() {
    edited = false;
    if (generated) text = generated.text;
  }

  // ---- saving a hand edit ----
  // What changed, ready to save; setting this opens SaveEditsDialog. `swaps` are links changed
  // in place (saved as planned link fixes by default), `edits` are other changed lines.
  let found = $state<{ edits: FoundEdit[]; swaps: LinkSwap[] } | null>(null);
  // Saving needs a base the edit can be traced back to, which the Original tab (YouTube's text,
  // before saved edits) isn't.
  const canSave = $derived(edited && mode !== 'original' && description !== null);
  function startSave() {
    if (!editBase || !video) return;
    const edits: FoundEdit[] = [];
    const swaps: LinkSwap[] = [];
    for (const e of editsFromHandEdit(editBase.source, editBase.shown, text)) {
      const split = splitLinkSwaps(e);
      if (split.rest) edits.push(split.rest);
      for (const s of split.swaps) {
        const fix = data.fixes.for(s.from, video.channelId);
        // Already planned: the drawer showed this replacement, and the user left it alone.
        if (fix?.action === 'replace' && fix.replacement === s.to) continue;
        // A link no scan has seen can't have a planned fix, so it stays a line edit.
        if (!data.rows.some((r) => r.url === s.from)) {
          if (!edits.some((x) => x.find === s.find)) edits.push({ find: s.find, replace: s.replace });
        } else if (!swaps.some((x) => x.from === s.from)) swaps.push(s);
      }
    }
    if (edits.length || swaps.length) found = { edits, swaps };
    else toast.info('Nothing to save: only spacing or blank lines changed.');
  }
  function saved() {
    found = null;
    edited = false; // the generated text now includes the saved edit
    toast.success('Saved. It applies here and in the Excel export.');
  }

  // ---- clicking a link chip ----
  let popLink = $state<LinkClick | null>(null);
  // The scanned link a chip stands for: itself, or the link whose planned replacement it shows.
  function sourceOf(url: string) {
    if (data.rows.some((r) => r.url === url)) return url;
    return links.find((r) => data.fixes.for(r.url, video?.channelId ?? '')?.replacement === url)?.url ?? null;
  }
  /** The popover's new address ('' removes the link): ask where to apply it. */
  function linkChange(to: string) {
    if (!popLink || !video) return;
    const from = sourceOf(popLink.url);
    if (!from) return;
    // For "only in this video", the line as the saved edits see it, before and after. Only known
    // while the text is what the drawer generated (no unsaved hand edits, not the Original tab).
    let find = '';
    let replace = '';
    if (!edited && generated && source && mode !== 'original') {
      const line = text.slice(0, popLink.from).split('\n').length - 1;
      const src = source.text.split('\n')[generated.origin[line] ?? -1];
      if (src?.includes(from)) {
        find = src;
        replace = to ? src.split(from).join(to) : src.split(from).join('').replace(/[ \t]{2,}/g, ' ').trimEnd();
      }
    }
    popLink = null;
    found = { edits: [], swaps: [{ from, to, find, replace }] };
  }

  const close = () => (ui.drawerVideoId = null);
  // Escape closes the drawer, unless a dialog is open on top of it (Escape closes that instead).
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui.drawerVideoId && !ui.fixLinkUrl && !found && !popLink && close();
  // A saved edit's first changed line, for the list beside the editor.
  const preview = (find: string, replace: string) => replace.split('\n').find((l) => l.trim() && !find.split('\n').includes(l)) ?? `Deleted: ${find.split('\n').find((l) => l.trim())}`;

  const MODES = $derived([
    // [mode, label, short label for phones]
    ['apply', 'Apply planned fixes', 'Planned fixes'],
    ['remove', 'Remove all problem links', 'Remove all'],
    ...(hasRedirects ? [['redirects', 'Update all redirects', 'Redirects']] : []),
    ['original', 'Original', 'Original'],
  ] as [typeof mode, string, string][]);
</script>

<svelte:window onkeydown={onKey} />

{#if ui.drawerVideoId && video}
  <section
    class="bg-background fixed inset-x-0 bottom-0 z-40 flex flex-col border-t shadow-[0_-12px_32px_-12px_rgb(0_0_0/0.25)]"
    style="height: {height}px"
    aria-label="Fix description"
  >
    <!-- Drag handle -->
    <div
      class="group flex h-4 shrink-0 cursor-ns-resize touch-none items-center justify-center"
      role="slider"
      tabindex="0"
      aria-label="Resize drawer"
      aria-orientation="vertical"
      aria-valuenow={Math.round(height)}
      onpointerdown={startDrag}
      onpointermove={drag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      onkeydown={keyResize}
    >
      <span class="bg-border group-hover:bg-muted-foreground/50 h-1 w-10 rounded-full transition-colors duration-150 {dragging ? 'bg-muted-foreground/60' : ''}"></span>
    </div>

    <header class="flex items-center gap-3 border-b px-4 pb-2.5">
      <img src="https://i.ytimg.com/vi/{video.id}/mqdefault.jpg" alt="" class="bg-muted aspect-video w-14 shrink-0 rounded-[4px] object-cover" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium" title={video.title}>{video.title}</div>
        <div class="text-muted-foreground text-xs">
          {problemOnly.length} problem link{problemOnly.length === 1 ? '' : 's'}<span class="hidden sm:inline"> · copy the result into Studio</span>
        </div>
      </div>
      <a class="text-muted-foreground hover:text-foreground hidden text-xs sm:inline" href="https://www.youtube.com/watch?v={video.id}" target="_blank" rel="noreferrer">Watch</a>
      <Button size="sm" variant="outline" href="https://studio.youtube.com/video/{video.id}/edit" target="_blank" rel="noreferrer">
        <span class="hidden sm:inline">Edit in</span> Studio <ExternalLink />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Close" onclick={close}><X /></Button>
    </header>

    <div class="flex min-h-0 flex-1 flex-col md:flex-row">
      <!-- The video's problem links, any other link with a planned change, and their fixes -->
      <aside class="max-h-40 shrink-0 overflow-y-auto border-b md:max-h-none md:w-80 md:border-r md:border-b-0">
        <div class="text-muted-foreground px-4 pt-3 pb-1 text-xs">Plan a fix for each link, and it's applied below.</div>
        <ul class="divide-y">
          {#each links as r (r.url)}
            <li class="px-4 py-2.5">
              <div class="flex items-center justify-between gap-2">
                <StatusBadge category={r.cls.category} />
                <PlanFixButton row={r} />
              </div>
              <div class="mt-1 font-mono text-xs break-all">{r.url}</div>
              <PlannedFix url={r.url} />
            </li>
          {/each}
        </ul>
        {#if savedHere.length}
          <div class="text-muted-foreground border-t px-4 pt-3 pb-1 text-xs">Saved edits on this video</div>
          <ul class="divide-y">
            {#each savedHere as e (e.id)}
              <li class="flex items-start gap-2 px-4 py-2">
                <PencilLine class="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                <div class="min-w-0 flex-1">
                  <div class="truncate font-mono text-xs" title={e.replace || e.find}>{preview(e.find, e.replace)}</div>
                  <div class="text-muted-foreground text-xs">{e.videos ? `${e.videos.length} video${e.videos.length === 1 ? '' : 's'}` : 'Every video with these lines'}</div>
                </div>
                <Button size="icon-xs" variant="ghost" aria-label="Remove saved edit" title="Remove this saved edit from every video it applies to" onclick={() => removeTextEdit(e.id)}><X /></Button>
              </li>
            {/each}
          </ul>
        {/if}
      </aside>

      <!-- Editor -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="bg-muted inline-flex flex-wrap rounded-md p-0.5" role="tablist" aria-label="What to change">
            {#each MODES as [k, label, short] (k)}
              <button
                role="tab"
                aria-selected={mode === k}
                class="rounded-[5px] px-2 py-1 text-xs font-medium transition-colors duration-150 {mode === k
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => ((mode = k), (edited = false))}><span class="sm:hidden">{short}</span><span class="hidden sm:inline">{label}</span></button
              >
            {/each}
          </div>
          <span class="text-muted-foreground text-xs tabular-nums">
            {#if generated && mode !== 'original'}{generated.changed} change{generated.changed === 1 ? '' : 's'}{/if}
            {#if edited} · edited by hand{/if}
          </span>
          <div class="ml-auto flex gap-1">
            {#if edited}
              <Button size="sm" variant="ghost" onclick={reset}><RotateCcw /> {stale ? 'Reapply fixes' : 'Undo my edits'}</Button>
            {/if}
            {#if canSave}
              <Button size="sm" variant="outline" onclick={startSave} title="Save your edit, here and in other videos with the same lines"><Save /> Save edit</Button>
            {/if}
            <Button size="sm" onclick={copy} disabled={description === null}><Copy /> Copy</Button>
          </div>
        </div>

        {#if loadError}
          <div class="text-sm text-[#b42d2d] dark:text-[#f07070]">{loadError}</div>
        {:else if description === null}
          <div class="space-y-2 rounded-md border p-3">
            <Skeleton class="h-3 w-3/4" /><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-5/6" /><Skeleton class="h-3 w-2/3" />
          </div>
        {:else}
          <!-- Links show as chips: click one to change it everywhere it's used. -->
          <div class="relative min-h-0 flex-1 overflow-hidden rounded-md border">
            <DescriptionEditor bind:value={text} {needles} {tint} oninput={onInput} onlink={(l) => (popLink = l)} />
          </div>
        {/if}
      </div>
    </div>
  </section>
  <SaveEditsDialog changes={found} videoId={video.id} channelId={video.channelId} onclose={() => (found = null)} onsaved={saved} />
  {#if popLink}
    <LinkPopover link={popLink} source={sourceOf(popLink.url)} onchange={linkChange} onclose={() => (popLink = null)} />
  {/if}
{/if}
