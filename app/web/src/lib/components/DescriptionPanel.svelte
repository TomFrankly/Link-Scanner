<script lang="ts">
  // The Description tab of the video open in the report's Videos view: the video's links down
  // the side (each with Plan fix and a locate button), and its description with fixes applied,
  // ready to copy into YouTube Studio. The video's links come from
  // `data.rows`, their planned fixes from `data.fixes`, and the description itself is fetched
  // fresh from the API when the tab first opens.
  // The workspace's saved text edits (shared/textEdits.ts) run first, then the link fixes
  // (shared/fixes.ts). Hand edits typed here can be saved as new text edits, optionally for
  // every other video with the same lines (SaveEditsDialog). Nothing changes on YouTube: the
  // user copies the result into YouTube Studio. Problem links without a planned fix are flagged in
  // the editor (not in the text), and selecting text opens the quick edit (QuickEdit), which
  // saves an exact-text replacement for this video, its channel, or every video with that text.
  // `compact` is the same editor without the links list, for the drawers under each video in the
  // link pane (LinkDetail): another way into this editor, scrolled to that link.
  import { toast } from 'svelte-sonner';
  import X from '@lucide/svelte/icons/x';
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
  import DescriptionEditor, { type Flag, type LinkClick, type TextSelection } from './DescriptionEditor.svelte';
  import LinkPopover from './LinkPopover.svelte';
  import QuickEdit from './QuickEdit.svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import AppWindow from '@lucide/svelte/icons/app-window';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { api } from '$lib/api';
  import Resizer from './Resizer.svelte';
  import { app, checkVideo, data, fetchedDescriptions, layout, removeTextEdit, openHelp, saveTextEdits, setFix, videoChecks } from '$lib/store.svelte';
  import { onDestroy, untrack } from 'svelte';
  import CheckCheck from '@lucide/svelte/icons/check-check';
  import Loader from '@lucide/svelte/icons/loader-circle';
  import { hasStudioTab, openStudio } from '$lib/studio';
  import Hint from './Hint.svelte';
  import { applyFixes, FIXABLE, reasonFor, REDIRECTS, removeLinks, updateRedirects, urlsIn, type FixResult, type Problem } from '$shared/fixes';
  import { applyTextEdits, editsFromHandEdit, splitLinkSwaps, type FoundEdit, type LinkSwap } from '$shared/textEdits';

  let {
    video,
    allLinks = [],
    focus = null,
    compact = false,
  }: {
    video: VideoRef;
    /** Every link in the video, listed beside the editor (problems first). Not shown when compact. */
    allLinks?: Row[];
    /** A link to scroll to and flash once the text is ready; `n` changes on each request. */
    focus?: { url: string; n: number } | null;
    /** Just the toolbar and editor, for a drawer; it scrolls only itself to `focus`. */
    compact?: boolean;
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
  // The planned fix for each of those links, keyed by URL; links without one are flagged.
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
  // Kept for the session in the store, which "Check" (checkVideo) also updates.
  const description = $derived(fetchedDescriptions.get(video.id) ?? null);
  let loadError = $state<string | null>(null);
  $effect(() => {
    const id = video.id; // the panel is keyed by video, so this runs once
    if (untrack(() => fetchedDescriptions.has(id))) return;
    api<{ description: string }>(`/w/${app.wsId}/videos/${encodeURIComponent(id)}/description`)
      .then((r) => fetchedDescriptions.set(id, r.description))
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

  // Problem links still in the text with nothing planned: outlined in the editor, with a tag. Not
  // in "Remove all" (they're gone); in Original, every problem link.
  const flagged = $derived<Flag[]>(
    (mode === 'remove' ? [] : problemOnly.filter((p) => mode !== 'apply' || !Object.hasOwn(decisions, p.url))).map((p) => ({
      url: p.url,
      reason: reasonFor(p),
      tone: p.category === 'broken' || p.category === 'parked' ? 'red' : 'amber',
    })),
  );

  async function copy(open = false) {
    try {
      await navigator.clipboard.writeText(text);
      if (open) openStudio(video.id);
      const left = flagged.filter((f) => urlsIn(text).some((u) => u.url === f.url)).length;
      if (left && mode !== 'original') toast.warning(`Copied, but ${left} problem link${left === 1 ? ' still has' : 's still have'} no planned fix.`);
      else toast.success(open ? 'Copied. Paste it into the description in Studio.' : 'Description copied. Paste it into YouTube Studio.');
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
  /** The hand edit as saveable changes, measured against the text shown when typing began. */
  function changesFromEdit() {
    const edits: FoundEdit[] = [];
    const swaps: LinkSwap[] = [];
    if (!editBase) return { edits, swaps };
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
    return { edits, swaps };
  }
  async function startSave() {
    if (!editBase) return;
    const { edits, swaps } = changesFromEdit();
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

  // ---- leaving with unsaved edits ----
  // Closing the panel (another video, a closed drawer, another view) keeps a hand edit instead of
  // dropping it: it's saved for this video only, the narrowest choice the Save dialog offers. A
  // link used only here is saved as its planned fix, as Save does. Widening it to other videos is
  // still the Save button's job; the saved edit is listed under the editor and can be removed.
  onDestroy(() => {
    if (!edited || !editBase) return;
    if (mode === 'original') {
      toast.warning('Your edits on the Original tab weren’t saved', { description: video.title });
      return;
    }
    const { edits, swaps } = changesFromEdit();
    if (!edits.length && !swaps.length) return;
    const quick = swaps.filter((s) => onlyHere(s.from));
    const lineEdits = edits.map((e) => ({ ...e, videos: [video.id] }));
    // Links other videos share stay as they are there: here they're a line edit, like "Only this video".
    for (const s of swaps) if (!onlyHere(s.from) && !lineEdits.some((x) => x.find === s.find)) lineEdits.push({ find: s.find, replace: s.replace, videos: [video.id] });
    const title = video.title;
    (async () => {
      let ok = true;
      for (const s of quick) ok = (await quickFix(s.from, s.to, false)) && ok;
      if (lineEdits.length) ok = (await saveTextEdits(lineEdits)) && ok;
      if (ok) toast.success('Saved your edits to this video', { description: `${title}. Use Save before closing to apply them to other videos too.` });
    })();
  });

  // Closing or reloading the browser tab can't wait for a save, so the browser asks first.
  $effect(() => {
    if (!edited) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  });

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
  function locate(url: string, silent = false) {
    const fix = data.fixes.for(url, video.channelId);
    const texts = mode === 'original' ? [url] : [url, fix?.replacement ?? ''];
    if (editor?.reveal(texts, { quiet: compact }) || silent) return;
    toast.info(fix?.action === 'remove' && mode !== 'original' ? 'Its planned fix removes this link, so it isn’t in the text.' : 'This link isn’t in the text shown.');
  }
  // A locate request from the Links tab waits until the editor has the text.
  let handled = 0;
  $effect(() => {
    if (!focus || focus.n === handled || !editorReady || !text) return;
    handled = focus.n;
    locate(focus.url, compact); // a drawer has its own note when the link isn't in the text
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

  // ---- the quick edit for selected text ----
  let sel = $state<TextSelection | null>(null);
  const selLink = $derived(sel ? sourceOf(sel.text.trim()) : null);
  function quickSaved(find: string, replace: string, videos: number) {
    sel = null;
    // With unsaved hand edits the text no longer follows the saved edits, so change it here too.
    if (edited) text = text.split(find).join(replace);
    // The edit just saved (the newest one with this text), so the toast can undo it.
    const saved = app.report?.textEdits.filter((e) => e.find === find && e.replace === replace).sort((a, b) => b.id - a.id)[0];
    const where = videos === 1 ? 'this video' : `${videos} videos`;
    toast.success(`${replace ? 'Replaced in' : 'Removed from'} ${where}. It applies here and in the Excel export.`, {
      action: saved && !edited ? { label: 'Undo', onClick: () => removeTextEdit(saved.id) } : undefined,
      duration: 8000,
    });
  }

  // A saved edit's first changed line, for the list under the editor.
  const preview = (find: string, replace: string) => replace.split('\n').find((l) => l.trim() && !find.split('\n').includes(l)) ?? `Deleted: ${find.split('\n').find((l) => l.trim())}`;

  // ---- layout: links beside the editor when the panel is wide enough ----
  const LINKS_MIN = 180;
  const EDITOR_MIN = 320;
  let width = $state(0);
  const side = $derived(width >= LINKS_MIN + EDITOR_MIN + 100);
  const linksMax = $derived(Math.max(LINKS_MIN, Math.min(480, width - EDITOR_MIN)));
  const linksWidth = $derived(Math.min(Math.max(layout.linksWidth.value, LINKS_MIN), linksMax));

  const MODES = $derived([
    // [mode, short label (the menu button), full label, what it does]
    ['apply', 'Planned fixes', 'Apply planned fixes', 'Your plans; links without one are flagged'],
    ['remove', 'Remove all', 'Remove all problem links', 'Every broken or redirected link taken out'],
    ...(hasRedirects ? [['redirects', 'Update redirects', 'Update all redirects', 'Each redirect swapped for where it lands now']] : []),
    ['original', 'Original', 'Original', 'The description as it is on YouTube'],
  ] as [typeof mode, string, string, string][]);
  const current = $derived(MODES.find(([k]) => k === mode) ?? MODES[0]!);
</script>

<!-- The video's links beside the editor when there's room for both, above it when not. Each
     scrolls on its own, so locating a link moves only the description. -->
<div class="flex h-full min-h-0 {side ? 'flex-row' : 'flex-col'}" bind:clientWidth={width}>
  {#if !compact}
  <aside
    class="min-h-0 shrink-0 overflow-y-auto overscroll-contain {side ? '' : 'max-h-[38%] border-b'}"
    style={side ? `width: ${linksWidth}px` : undefined}
    aria-label="Links in this video"
  >
    <ul class="space-y-1 p-1.5">
      {#each allLinks as r (r.url)}
        <li class="px-1.5 py-1.5">
          <!-- Locate sits last, so a wider Plan fix / Change fix label grows leftward and never moves it. -->
          <div class="flex items-center gap-1">
            <StatusBadge category={r.cls.category} />
            <span class="ml-auto"><PlanFixButton row={r} {video} /></span>
            <Hint text="Show in description">
              {#snippet children(tip)}<button
                {...tip}
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded p-1 transition-colors duration-150"
                aria-label="Show in description"
                onclick={() => locate(r.url)}><LocateFixed class="size-3.5" /></button
              >{/snippet}
            </Hint>
          </div>
          <a href={r.url} target="_blank" rel="noreferrer" class="mt-1 block font-mono text-xs break-all hover:underline">{r.url}</a>
          <PlannedFix url={r.url} />
        </li>
      {/each}
    </ul>
    {#if savedHere.length}
      <div class="text-muted-foreground px-3 pt-3 pb-1 text-xs">Saved edits on this video</div>
      <ul class="space-y-1 px-1.5 pb-2">
        {#each savedHere as e (e.id)}
          <li class="flex items-start gap-2 px-1.5 py-1.5">
            <PencilLine class="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="truncate font-mono text-xs" title={e.replace || e.find}>{e.kind === 'text' ? `“${e.find}” → “${e.replace}”` : preview(e.find, e.replace)}</div>
              <div class="text-muted-foreground text-xs">{e.videos ? `${e.videos.length} video${e.videos.length === 1 ? '' : 's'}` : e.kind === 'text' ? 'Every video with this text' : 'Every video with these lines'}</div>
            </div>
            <Hint text="Remove this saved edit from every video it applies to">
              {#snippet children(tip)}<Button {...tip} size="icon-xs" variant="ghost" aria-label="Remove saved edit" onclick={() => removeTextEdit(e.id)}><X /></Button>{/snippet}
            </Hint>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
  {#if side}
    <Resizer bind:size={layout.linksWidth.value} min={LINKS_MIN} max={linksMax} initial={256} label="Resize the links list" />
  {/if}
  {/if}

  <!-- A container, so the buttons' labels follow this column's width, not the window's. -->
  <div class="@container flex min-h-0 min-w-0 flex-1 flex-col">
    <div class="flex h-11 flex-none items-center gap-1 px-2">
      <!-- Which version of the text to show, as one menu so the toolbar stays on one line. -->
      <DropdownMenu.Root>
        <Hint text={current[2]} side="bottom">
          {#snippet children(tip)}
            <DropdownMenu.Trigger {...tip}>
              {#snippet child({ props })}
                <Button {...props} size="sm" variant="ghost" class="min-w-0 shrink px-2" aria-label="Show: {current[2]}">
                  <span class="truncate">{current[1]}</span><ChevronDown class="opacity-60" />
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
          {/snippet}
        </Hint>
        <DropdownMenu.Content align="start" class="w-72">
          <DropdownMenu.Label class="text-muted-foreground text-xs font-normal">Show the description with</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={mode} onValueChange={(v) => ((mode = v as typeof mode), (edited = false))}>
            {#each MODES as [k, , full, hint] (k)}
              <DropdownMenu.RadioItem value={k}>
                <span>
                  <span class="block">{full}</span>
                  <span class="text-muted-foreground block text-xs">{hint}</span>
                </span>
              </DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <span class="text-muted-foreground min-w-0 flex-[1_1_0] truncate text-xs tabular-nums">
        {#if generated && mode !== 'original'}{generated.changed} change{generated.changed === 1 ? '' : 's'}{/if}
        {#if edited} · edited by hand{/if}
      </span>
      <div class="ml-auto flex shrink-0 gap-1">
        {#if edited}
          <!-- Undo and Save are icon-only, so the toolbar stays on one line while editing. -->
          <Hint text={stale ? 'Reapply fixes' : 'Undo my edits'} side="bottom">
            {#snippet children(tip)}<Button {...tip} size="icon-sm" variant="ghost" onclick={reset} aria-label={stale ? 'Reapply fixes' : 'Undo my edits'}><RotateCcw /></Button>{/snippet}
          </Hint>
        {/if}
        {#if canSave}
          <Hint text="Save this edit, here and in other videos with the same lines" side="bottom">
            {#snippet children(tip)}<Button {...tip} size="icon-sm" variant="outline" onclick={startSave} aria-label="Save edit"><Save /></Button>{/snippet}
          </Hint>
        {/if}
        <Hint text="Copy the description" side="bottom">
          {#snippet children(tip)}<Button {...tip} size="sm" variant="outline" onclick={() => copy()} disabled={description === null} aria-label="Copy"
            ><Copy /><span class="hidden @xl:inline">Copy</span></Button
          >{/snippet}
        </Hint>
        <Hint text="Copy the description and open this video in YouTube Studio" side="bottom">
          {#snippet children(tip)}<Button {...tip} size="sm" onclick={() => copy(true)} disabled={description === null}>
            <Copy /> Copy & open<span class="hidden @xl:inline">Studio</span> <ExternalLink />
          </Button>{/snippet}
        </Hint>
        <!-- After pasting in Studio and saving: reads the description on YouTube again. -->
        <Hint text="Saved it in Studio? Check the description on YouTube (1 unit of quota). Once no problem links are left, the video leaves Needs attention." side="bottom">
          {#snippet children(tip)}<Button {...tip} size="sm" variant="outline" onclick={() => checkVideo(video)} disabled={description === null || videoChecks.has(video.id)} aria-label="Check on YouTube">
            {#if videoChecks.has(video.id)}<Loader class="motion-safe:animate-spin" />{:else}<CheckCheck />{/if}<span class="hidden @lg:inline">Check</span>
          </Button>{/snippet}
        </Hint>
        {#if !hasStudioTab()}
          <Hint text="Open Studio links in one tab beside the app" side="bottom">
            {#snippet children(tip)}<Button {...tip} size="icon-sm" variant="ghost" aria-label="Reuse one Studio tab" onclick={() => openHelp('studio')}>
              <AppWindow />
            </Button>{/snippet}
          </Hint>
        {/if}
      </div>
    </div>

    {#if compact && focus && mode !== 'original' && data.fixes.for(focus.url, video.channelId)?.action === 'remove'}
      <p class="text-muted-foreground px-3 pb-1.5 text-xs">Its planned fix removes this link, so it isn’t in the text below.</p>
    {/if}
    {#if loadError}
      <div class="p-3 text-sm text-[#b42d2d] dark:text-[#f07070]">{loadError}</div>
    {:else if description === null}
      <div class="space-y-2 p-3">
        <Skeleton class="h-3 w-3/4" /><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-5/6" /><Skeleton class="h-3 w-2/3" />
      </div>
    {:else}
      <!-- Links show as chips: click one to change it. The editor scrolls inside this box. -->
      <div class="min-h-0 flex-1">
        <DescriptionEditor
          bind:this={editor}
          bind:ready={editorReady}
          bind:value={text}
          {needles}
          {tint}
          {flagged}
          oninput={onInput}
          onlink={(l) => ((sel = null), (popLink = l))}
          onselect={(s) => (sel = s)}
        />
      </div>
    {/if}
  </div>
</div>

<SaveEditsDialog changes={found} videoId={video.id} channelId={video.channelId} onclose={() => (found = null)} onsaved={saved} />
{#if popLink}
  <LinkPopover link={popLink} source={sourceOf(popLink.url)} onchange={linkChange} onclose={() => (popLink = null)} />
{:else if sel && source && mode !== 'original'}
  {@const s = sel}
  <QuickEdit
    sel={s}
    videoId={video.id}
    channelId={video.channelId}
    sourceText={source.text}
    isLink={!!selLink}
    onlink={() => {
      // `s` follows `sel`, so read it before clearing the selection.
      popLink = { url: s.text.trim(), from: s.from, to: s.to, left: s.left, top: s.top, bottom: s.bottom };
      sel = null;
    }}
    onclose={() => (sel = null)}
    onsaved={quickSaved}
  />
{/if}
