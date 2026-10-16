<script lang="ts" module>
  // Descriptions fetched this session, by video id, so switching tabs or reopening a video
  // doesn't spend another YouTube quota unit. A page reload fetches fresh copies.
  const fetched = new Map<string, string>();
</script>

<script lang="ts">
  // The Description tab of a video in the report's Videos view: the video's links down the
  // side (each with Plan fix and a locate button), and its description with fixes applied,
  // ready to copy into YouTube Studio. The video's links come from
  // `data.rows`, their planned fixes from `data.fixes`, and the description itself is fetched
  // fresh from the API when the tab first opens.
  // The workspace's saved text edits (shared/textEdits.ts) run first, then the link fixes
  // (shared/fixes.ts). Hand edits typed here can be saved as new text edits, optionally for
  // every other video with the same lines (SaveEditsDialog). Nothing changes on YouTube: the
  // user copies the result into YouTube Studio.
  import { toast } from 'svelte-sonner';
  import X from '@lucide/svelte/icons/x';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Copy from '@lucide/svelte/icons/copy';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Save from '@lucide/svelte/icons/save';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import LocateFixed from '@lucide/svelte/icons/locate-fixed';
  import StatusBadge from './StatusBadge.svelte';
  import PlannedFix from './PlannedFix.svelte';
  import PlanFixButton from './PlanFixButton.svelte';
  import type { Row, VideoRef } from '$lib/types';
  import SaveEditsDialog from './SaveEditsDialog.svelte';
  import DescriptionEditor, { type LinkClick } from './DescriptionEditor.svelte';
  import LinkPopover from './LinkPopover.svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import AppWindow from '@lucide/svelte/icons/app-window';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { api } from '$lib/api';
  import { app, data, removeTextEdit, setFix, ui } from '$lib/store.svelte';
  import { hasStudioTab, openStudio } from '$lib/studio';
  import { applyFixes, FIXABLE, REDIRECTS, removeLinks, updateRedirects, type FixResult, type Problem } from '$shared/fixes';
  import { applyTextEdits, editsFromHandEdit, splitLinkSwaps, type FoundEdit, type LinkSwap } from '$shared/textEdits';

  let {
    video,
    allLinks,
    focus = null,
    onnext = null,
  }: {
    video: VideoRef;
    /** Every link in the video, listed beside the editor (problems first). */
    allLinks: Row[];
    /** A link to scroll to and flash once the text is ready; `n` changes on each request. */
    focus?: { url: string; n: number } | null;
    /** Moves to the next video to fix; null hides the button. */
    onnext?: (() => void) | null;
  } = $props();

  // ---- the video's links ----
  // This video's links that the fixes act on, in the shape shared/fixes.ts expects: problem links
  // (broken or redirected), plus any working link with a planned fix (e.g. a swapped affiliate link).
  const links = $derived(
    data.rows.filter((r) => r.videos.some((v) => v.id === video.id) && (FIXABLE.includes(r.cls.category) || data.fixes.for(r.url, video.channelId))),
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
        const fix = data.fixes.for(r.url, video.channelId);
        return fix ? [[r.url, { action: fix.action, replacement: fix.replacement }]] : [];
      }),
    ),
  );
  // The "Update all redirects" tab only shows when there's a redirect to update.
  const hasRedirects = $derived(problems.some((p) => REDIRECTS.includes(p.category) && p.finalUrl && p.finalUrl !== p.url));

  // ---- description: fetched from YouTube (1 quota unit) the first time a video's tab opens ----
  let description = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  $effect(() => {
    const id = video.id; // the panel is keyed by video, so this runs once
    const cached = fetched.get(id);
    if (cached !== undefined) return void (description = cached);
    api<{ description: string }>(`/w/${app.wsId}/videos/${encodeURIComponent(id)}/description`)
      .then((r) => {
        fetched.set(id, r.description);
        description = r.description;
      })
      .catch((e) => (loadError = (e as Error).message));
  });

  // The tabs above the editor: apply planned fixes (unplanned links get a marker), remove every
  // problem link, swap every redirect for where it lands now, or show the original text.
  let mode = $state<'apply' | 'remove' | 'redirects' | 'original'>('apply');
  // The description with the workspace's saved text edits applied; the link fixes run on this.
  const textEdits = $derived(app.report?.textEdits ?? []);
  const source = $derived(description === null ? null : applyTextEdits(description, textEdits, video.id, video.channelId));
  // The saved edits that changed this video, listed under the editor.
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

  async function copy(open = false) {
    try {
      await navigator.clipboard.writeText(text);
      if (open) openStudio(video.id);
      toast.success(open ? 'Copied. Paste it into the description in Studio.' : 'Description copied. Paste it into YouTube Studio.');
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
  async function startSave() {
    if (!editBase) return;
    const edits: FoundEdit[] = [];
    const swaps: LinkSwap[] = [];
    for (const e of editsFromHandEdit(editBase.source, editBase.shown, text)) {
      const split = splitLinkSwaps(e);
      if (split.rest) edits.push(split.rest);
      for (const s of split.swaps) {
        const fix = data.fixes.for(s.from, video.channelId);
        // Already planned: the editor showed this replacement, and the user left it alone.
        if (fix?.action === 'replace' && fix.replacement === s.to) continue;
        // A link no scan has seen can't have a planned fix, so it stays a line edit.
        if (!data.rows.some((r) => r.url === s.from)) {
          if (!edits.some((x) => x.find === s.find)) edits.push({ find: s.find, replace: s.replace });
        } else if (!swaps.some((x) => x.from === s.from)) swaps.push(s);
      }
    }
    if (!edits.length && !swaps.length) return toast.info('Nothing to save: only spacing or blank lines changed.');
    // A link used only in this video has nowhere else to go, so it's saved without asking.
    const quick = swaps.filter((s) => onlyHere(s.from));
    for (const s of quick) await quickFix(s.from, s.to, quick.length === 1);
    const rest = swaps.filter((s) => !onlyHere(s.from));
    if (edits.length || rest.length) found = { edits, swaps: rest };
    else {
      edited = false; // the generated text now includes the change
      if (quick.length > 1) toast.success(`${quick.length} links changed`);
    }
  }

  // ---- changing a link used only in this video ----
  const onlyHere = (url: string) => (data.rows.find((r) => r.url === url)?.videos.length ?? 0) <= 1;
  /**
   * Saves a link change as a planned fix without asking where it applies. Kept in the scope of
   * the plan that applies now (normally every channel). The toast's Undo puts the old plan back.
   */
  async function quickFix(from: string, to: string, notify = true) {
    const scope = data.fixes.for(from, video.channelId)?.channelId ?? '';
    const prev = data.fixes.exact(from, scope);
    const opts = { quiet: true, channelId: scope };
    const ok = await (to ? setFix(from, 'replace', to, opts) : setFix(from, 'remove', undefined, opts));
    if (ok && notify)
      toast.success(to ? 'Link changed' : 'Link removed', {
        duration: 8000, // long enough to reach Undo
        action: {
          label: 'Undo',
          onClick: () => (prev ? setFix(from, prev.action, prev.replacement ?? undefined, opts) : setFix(from, 'clear', undefined, opts)),
        },
      });
    return ok;
  }

  // ---- locating a link in the editor ----
  let editor = $state<ReturnType<typeof DescriptionEditor>>();
  let editorReady = $state(false);
  /** Scrolls the editor to a link (or the replacement shown in its place) and flashes its line. */
  function locate(url: string) {
    const fix = data.fixes.for(url, video.channelId);
    const texts = mode === 'original' ? [url] : [url, fix?.replacement ?? ''];
    if (editor?.reveal(texts)) return;
    toast.info(fix?.action === 'remove' && mode !== 'original' ? 'Its planned fix removes this link, so it isn’t in the text.' : 'This link isn’t in the text shown.');
  }
  // A locate request from the Links tab waits until the editor has the text.
  let handled = 0;
  $effect(() => {
    if (!focus || focus.n === handled || !editorReady || !text) return;
    handled = focus.n;
    locate(focus.url);
  });
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
    return links.find((r) => data.fixes.for(r.url, video.channelId)?.replacement === url)?.url ?? null;
  }
  /** The popover's new address ('' removes the link): ask where to apply it. */
  function linkChange(to: string) {
    if (!popLink) return;
    const from = sourceOf(popLink.url);
    if (!from) return;
    // For "only in this video", the line as the saved edits see it, before and after. Only known
    // while the text is what the panel generated (no unsaved hand edits, not the Original tab).
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
    if (onlyHere(from)) quickFix(from, to);
    else found = { edits: [], swaps: [{ from, to, find, replace }] };
  }

  // A saved edit's first changed line, for the list under the editor.
  const preview = (find: string, replace: string) => replace.split('\n').find((l) => l.trim() && !find.split('\n').includes(l)) ?? `Deleted: ${find.split('\n').find((l) => l.trim())}`;

  const MODES = $derived([
    // [mode, label, short label for phones]
    ['apply', 'Apply planned fixes', 'Planned fixes'],
    ['remove', 'Remove all problem links', 'Remove all'],
    ...(hasRedirects ? [['redirects', 'Update all redirects', 'Redirects']] : []),
    ['original', 'Original', 'Original'],
  ] as [typeof mode, string, string][]);
</script>

<!-- The video's links beside the editor (stacked above it on phones), then the editor. -->
<div class="grid items-start gap-3 md:grid-cols-[17rem_minmax(0,1fr)]">
  <aside class="bg-background max-h-56 overflow-y-auto rounded-md border md:sticky md:top-16 md:max-h-[calc(100dvh-5rem)]" aria-label="Links in this video">
    <ul class="divide-y">
      {#each allLinks as r (r.url)}
        <li class="px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <StatusBadge category={r.cls.category} />
            <PlanFixButton row={r} />
          </div>
          <div class="mt-1 flex items-start gap-1">
            <a href={r.url} target="_blank" rel="noreferrer" class="min-w-0 flex-1 font-mono text-xs break-all hover:underline" title="Open in a new tab">{r.url}</a>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground hover:bg-muted -my-0.5 shrink-0 rounded p-0.5 transition-colors duration-150"
              aria-label="Show in description"
              title="Show in description"
              onclick={() => locate(r.url)}><LocateFixed class="size-3.5" /></button
            >
          </div>
          <PlannedFix url={r.url} />
        </li>
      {/each}
    </ul>
    {#if savedHere.length}
      <div class="text-muted-foreground border-t px-3 pt-2.5 pb-1 text-xs">Saved edits on this video</div>
      <ul class="divide-y">
        {#each savedHere as e (e.id)}
          <li class="flex items-start gap-2 px-3 py-2">
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

  <div class="min-w-0 space-y-2">
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
      <div class="ml-auto flex flex-wrap gap-1">
        {#if edited}
          <Button size="sm" variant="ghost" onclick={reset}><RotateCcw /> {stale ? 'Reapply fixes' : 'Undo my edits'}</Button>
        {/if}
        {#if canSave}
          <Button size="sm" variant="outline" onclick={startSave} title="Save your edit, here and in other videos with the same lines"><Save /> Save edit</Button>
        {/if}
        <Button size="sm" variant="outline" onclick={() => copy()} disabled={description === null}><Copy /> Copy</Button>
        <Button size="sm" onclick={() => copy(true)} disabled={description === null} title="Copy the description and open this video in YouTube Studio">
          <Copy /> Copy & open Studio <ExternalLink />
        </Button>
        {#if !hasStudioTab()}
          <Button size="icon-sm" variant="ghost" aria-label="Reuse one Studio tab" title="Reuse one Studio tab (optional extension)" onclick={() => (ui.studioTab = true)}>
            <AppWindow />
          </Button>
        {/if}
      </div>
    </div>

    {#if loadError}
      <div class="text-sm text-[#b42d2d] dark:text-[#f07070]">{loadError}</div>
    {:else if description === null}
      <div class="bg-background space-y-2 rounded-md border p-3">
        <Skeleton class="h-3 w-3/4" /><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-5/6" /><Skeleton class="h-3 w-2/3" />
      </div>
    {:else}
      <!-- Links show as chips: click one to change it. The editor grows with the text. -->
      <div class="bg-background rounded-md border">
        <DescriptionEditor bind:this={editor} bind:ready={editorReady} bind:value={text} {needles} {tint} oninput={onInput} onlink={(l) => (popLink = l)} />
      </div>
    {/if}

    {#if onnext}
      <div class="flex justify-end pt-1">
        <Button size="sm" variant="ghost" onclick={onnext}>Next video to fix <ArrowRight /></Button>
      </div>
    {/if}
  </div>
</div>

<SaveEditsDialog changes={found} videoId={video.id} channelId={video.channelId} onclose={() => (found = null)} onsaved={saved} />
{#if popLink}
  <LinkPopover link={popLink} source={sourceOf(popLink.url)} onchange={linkChange} onclose={() => (popLink = null)} />
{/if}
