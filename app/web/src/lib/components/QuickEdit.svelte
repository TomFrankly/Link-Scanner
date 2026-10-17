<script lang="ts">
  // The quick edit for text selected in a video's Description tab (DescriptionPanel). First a
  // small bar above the selection; clicking Replace opens a form: what to put instead, and
  // where: every video whose description has this exact text, this channel's videos with it,
  // or only this video. It's saved as a text edit of kind 'text' (shared/textEdits.ts), which
  // replaces that exact text, inside lines too, in the videos it covers. The other videos are
  // searched in their saved descriptions (from full scans), so it costs no YouTube quota.
  // The bar also offers "Remove from N videos": as soon as text is selected it counts the videos
  // whose description has it, and one click saves a removal for all of them (a selection of whole
  // lines takes their line break too, so no blank line is left). The toast has Undo.
  // A selection that's exactly one of the video's links offers "Change link" instead, which
  // opens the link popover (a planned link fix is the better tool for links).
  import { tick } from 'svelte';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Link2 from '@lucide/svelte/icons/link-2';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Hint from './Hint.svelte';
  import { Button } from '$lib/components/ui/button';
  import { app, data, loadDescriptions, saveTextEdits } from '$lib/store.svelte';
  import { applyTextEdits, contains, type EditKind } from '$shared/textEdits';
  import type { TextSelection } from './DescriptionEditor.svelte';

  let {
    sel,
    videoId,
    channelId,
    sourceText,
    isLink,
    onlink,
    onclose,
    onsaved,
  }: {
    sel: TextSelection;
    videoId: string;
    channelId: string;
    /** This video's description before link fixes: where a text edit has to find its text. */
    sourceText: string;
    /** The selection is exactly one of the video's links. */
    isLink: boolean;
    onlink: () => void;
    onclose: () => void;
    /** After saving; `find` became `replace` in the videos it covers. */
    onsaved: (find: string, replace: string, videos: number) => void;
  } = $props();

  let open = $state(false);
  let value = $state('');
  let input = $state<HTMLTextAreaElement>();
  let box = $state<HTMLDivElement>();
  let saving = $state(false);
  // Whole selected lines are matched and saved as lines (kind 'lines'): they match the same
  // lines in other videos even where one is a description's last line (no line break after it),
  // and removing them leaves no blank line. Anything else is exact text (kind 'text').
  const kind = $derived<EditKind>(sel.wholeLines ? 'lines' : 'text');
  const find = $derived(sel.wholeLines ? sel.text.replace(/\n$/, '') : sel.text);
  // A text edit runs before planned link fixes, so it can only change text that's there then.
  const inSource = $derived(contains(sourceText, find, kind));

  // Other videos with the same text: every channel, and this video's channel. Null while
  // searching, which starts as soon as text is selected, for the bar's Remove button.
  let others = $state<{ all: number; channel: number } | null>(null);
  let searchError = $state<string | null>(null);
  $effect(() => {
    const [text, k, here, ch] = [find, kind, videoId, channelId];
    others = null;
    searchError = null;
    if (!inSource || isLink) return;
    let stale = false;
    loadDescriptions()
      .then((all) => {
        if (stale) return;
        // Read here, untracked, so saving an edit doesn't restart the count mid-save.
        const rules = app.report?.textEdits ?? [];
        const counts = { all: 0, channel: 0 };
        for (const v of app.report?.videos ?? []) {
          if (v.id === here) continue;
          const d = all.get(v.id)?.d;
          if (d == null || !contains(applyTextEdits(d, rules, v.id, v.c).text, text, k)) continue;
          counts.all++;
          if (v.c === ch) counts.channel++;
        }
        others = counts;
      })
      .catch((e) => !stale && (searchError = (e as Error).message));
    return () => (stale = true);
  });
  async function startForm() {
    open = true;
    value = find;
    await tick();
    input?.focus();
    input?.select();
  }

  /** One click: removes the selected text from this video and every other video that has it. */
  async function removeEverywhere() {
    if (!others || saving) return;
    saving = true;
    const n = 1 + others.all;
    const ok = await saveTextEdits([{ find, replace: '', kind, videos: n > 1 ? null : [videoId] }]);
    saving = false;
    if (ok) onsaved(find, '', n);
  }
  const multiChannel = $derived((app.report?.channels.length ?? 0) > 1);
  const channelName = $derived(data.channelTitle[channelId] ?? 'this channel');
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  type Where = 'all' | 'channel' | 'here';
  /** Saves the replacement for `where`: every video with the text, this channel's, or only this one. */
  async function save(where: Where) {
    if (!inSource || value === find || saving) return;
    saving = true;
    const n = 1 + (where === 'all' ? (others?.all ?? 0) : where === 'channel' ? (others?.channel ?? 0) : 0);
    const ok = await saveTextEdits([
      where === 'here'
        ? { find, replace: value, kind, videos: [videoId] }
        : { find, replace: value, kind, videos: null, channelId: where === 'channel' ? channelId : null },
    ]);
    saving = false;
    if (ok) onsaved(find, value, n);
  }
  // Enter saves for the widest choice the buttons offer.
  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (others || searchError) save(others?.all ? 'all' : 'here');
  }

  // Placed above the selection, or below it when there's no room; kept inside the window.
  const WIDTH = 368;
  const left = $derived(Math.max(8, Math.min(sel.left, window.innerWidth - (open ? WIDTH : 320) - 8)));
  const above = $derived(sel.top > (open ? 300 : 52));

  // Closes on a click elsewhere, Escape, or any scroll outside it (it's placed on screen).
  function outside(e: PointerEvent) {
    if (box && !box.contains(e.target as Node)) onclose();
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={(e) => e.key === 'Escape' && (e.stopPropagation(), onclose())} />
<svelte:document onscrollcapture={(e) => !box?.contains(e.target as Node) && onclose()} />

<div
  bind:this={box}
  role="dialog"
  aria-label="Quick edit"
  class="bg-popover text-popover-foreground fixed z-50 rounded-lg border shadow-lg {open ? 'space-y-3 p-3' : 'p-1'}"
  style="left: {left}px; {open ? `width: min(${WIDTH}px, calc(100vw - 16px));` : ''} {above
    ? `bottom: ${window.innerHeight - sel.top + 6}px`
    : `top: ${sel.bottom + 6}px`}"
>
  {#if !open}
    {#if isLink}
      <Button size="xs" variant="ghost" onclick={onlink}><Link2 /> Change link…</Button>
    {:else}
      <div class="flex items-center gap-0.5">
        <Button size="xs" variant="ghost" onclick={startForm}><PencilLine /> Replace…</Button>
        {#if inSource && !searchError}
          {@const n = others ? 1 + others.all : null}
          <Hint text={n === null ? 'Counting the videos with this text…' : n === 1 ? 'Delete this text from this video' : `Delete this text from this video and ${n - 1} other${n === 2 ? '' : 's'}, plus any that get it later`}>
            {#snippet children(tip)}
              <!-- A wrapper, so the hint still shows while it's counting (disabled). -->
              <span {...tip}>
                <Button size="xs" variant="ghost" disabled={n === null || saving} onclick={removeEverywhere}>
                  <Trash />
                  {n === null ? 'Remove' : n === 1 ? 'Remove' : `Remove from ${n.toLocaleString()} videos`}
                </Button>
              </span>
            {/snippet}
          </Hint>
        {/if}
      </div>
    {/if}
  {:else}
    <form class="space-y-3" onsubmit={submit}>
      <div class="space-y-1">
        <div class="text-muted-foreground text-xs">Replace</div>
        <div class="bg-muted rounded-md px-2 py-1"><div class="line-clamp-3 font-mono text-xs break-all whitespace-pre-wrap">{find}</div></div>
      </div>
      <label class="block space-y-1">
        <span class="text-muted-foreground text-xs">With</span>
        <!-- Wraps and grows with its text (up to about 8 lines), so a long pasted link is easy to read. Enter saves; Shift+Enter adds a line. -->
        <textarea
          bind:this={input}
          bind:value
          rows="1"
          spellcheck="false"
          class="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 block max-h-40 min-h-8 w-full resize-none rounded-md border bg-transparent px-2.5 py-1.5 font-mono text-xs break-all outline-none [field-sizing:content] focus-visible:ring-3"
          placeholder="Leave empty to delete it"
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        ></textarea>
      </label>

      {#if !inSource}
        <p class="text-muted-foreground text-xs">This text comes from a planned link fix, so it can’t be saved as a text edit. Click the link to change its fix instead.</p>
      {:else if searchError}
        <p class="text-xs text-[#b42d2d] dark:text-[#f07070]">Couldn’t search other videos: {searchError}</p>
      {:else if !others}
        <p class="text-muted-foreground text-xs">Counting other videos with this text…</p>
      {:else if !others.all}
        <p class="text-muted-foreground text-xs">No other video’s saved description has this exact text.</p>
      {:else if multiChannel && others.channel && others.channel < others.all}
        <!-- A third choice when the text is also in other channels' videos. -->
        <button type="button" class="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2" disabled={value === find || saving} onclick={() => save('channel')}>
          Only in {channelName}’s videos ({plural(1 + others.channel, 'video')})
        </button>
      {/if}

      <!-- Where it applies is the button you click: here, or every video with this text (including ones that get it later). -->
      <div class="flex flex-wrap justify-end gap-1.5">
        <Button type="button" size="sm" variant="ghost" onclick={onclose}>Cancel</Button>
        {#if others?.all}
          <Button type="button" size="sm" variant="outline" disabled={value === find || saving} onclick={() => save('here')}>{value ? 'Replace' : 'Delete'} here</Button>
          <Button type="submit" size="sm" disabled={value === find || saving}>{saving ? 'Saving…' : `${value ? 'Replace' : 'Delete'} in ${plural(1 + others.all, 'video')}`}</Button>
        {:else}
          <Button type="submit" size="sm" disabled={!inSource || value === find || saving || (!others && !searchError)}>{saving ? 'Saving…' : value ? 'Replace' : 'Delete'}</Button>
        {/if}
      </div>
    </form>
  {/if}
</div>
