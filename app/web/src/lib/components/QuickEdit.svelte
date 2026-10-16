<script lang="ts">
  // The quick edit for text selected in a video's Description tab (DescriptionPanel). First a
  // small bar above the selection; clicking Replace opens a form: what to put instead, and
  // where: every video whose description has this exact text, this channel's videos with it,
  // or only this video. It's saved as a text edit of kind 'text' (shared/textEdits.ts), which
  // replaces that exact text, inside lines too, in the videos it covers. The other videos are
  // searched in their saved descriptions (from full scans), so it costs no YouTube quota.
  // A selection that's exactly one of the video's links offers "Change link" instead, which
  // opens the link popover (a planned link fix is the better tool for links).
  import { tick } from 'svelte';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Link2 from '@lucide/svelte/icons/link-2';
  import { Button } from '$lib/components/ui/button';
  import { app, data, loadDescriptions, saveTextEdits } from '$lib/store.svelte';
  import { applyTextEdits } from '$shared/textEdits';
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
  let scope = $state<'all' | 'channel' | 'here'>('all');
  let saving = $state(false);
  const find = $derived(sel.text);
  // A text edit runs before planned link fixes, so it can only change text that's there then.
  const inSource = $derived(sourceText.includes(find));

  // Other videos with the same text: every channel, and this video's channel. Null while searching.
  let others = $state<{ all: number; channel: number } | null>(null);
  let searchError = $state<string | null>(null);
  async function startForm() {
    open = true;
    value = find;
    await tick();
    input?.focus();
    input?.select();
    if (!inSource) return;
    const rules = app.report?.textEdits ?? [];
    loadDescriptions()
      .then((all) => {
        let n = 0;
        let inChannel = 0;
        for (const v of app.report?.videos ?? []) {
          if (v.id === videoId) continue;
          const d = all.get(v.id)?.d;
          if (d == null || !applyTextEdits(d, rules, v.id, v.c).text.includes(find)) continue;
          n++;
          if (v.c === channelId) inChannel++;
        }
        others = { all: n, channel: inChannel };
        if (!n) scope = 'here';
      })
      .catch((e) => (searchError = (e as Error).message));
  }
  const multiChannel = $derived((app.report?.channels.length ?? 0) > 1);
  const channelName = $derived(data.channelTitle[channelId] ?? 'this channel');
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!inSource || value === find || saving) return;
    saving = true;
    const ok = await saveTextEdits([
      scope === 'here'
        ? { find, replace: value, kind: 'text', videos: [videoId] }
        : { find, replace: value, kind: 'text', videos: null, channelId: scope === 'channel' ? channelId : null },
    ]);
    saving = false;
    if (ok) onsaved(find, value, 1 + (scope === 'all' ? (others?.all ?? 0) : scope === 'channel' ? (others?.channel ?? 0) : 0));
  }

  // Placed above the selection, or below it when there's no room; kept inside the window.
  const WIDTH = 368;
  const left = $derived(Math.max(8, Math.min(sel.left, window.innerWidth - (open ? WIDTH : 160) - 8)));
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
      <Button size="xs" variant="ghost" onclick={startForm}><PencilLine /> Replace…</Button>
    {/if}
  {:else}
    <form class="space-y-3" onsubmit={save}>
      <div class="space-y-1">
        <div class="text-muted-foreground text-xs">Replace</div>
        <div class="bg-muted line-clamp-3 rounded-md px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap">{find}</div>
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
      {:else}
        <div class="space-y-1.5 text-sm" role="radiogroup" aria-label="Where to replace it">
          {#if searchError}
            <p class="text-xs text-[#b42d2d] dark:text-[#f07070]">Couldn’t search other videos: {searchError}</p>
          {:else if !others}
            <p class="text-muted-foreground text-xs">Searching other videos…</p>
          {:else if others.all}
            <label class="flex cursor-pointer items-start gap-2">
              <input type="radio" name="qe-scope" class="accent-foreground mt-1" checked={scope === 'all'} onchange={() => (scope = 'all')} />
              <span>
                Every video with this text
                <span class="text-muted-foreground block text-xs">This one and {plural(others.all, 'other')}, plus any that get this text later</span>
              </span>
            </label>
            {#if multiChannel && others.channel < others.all}
              <label class="flex cursor-pointer items-start gap-2">
                <input type="radio" name="qe-scope" class="accent-foreground mt-1" checked={scope === 'channel'} onchange={() => (scope = 'channel')} />
                <span>
                  {channelName}’s videos with it
                  <span class="text-muted-foreground block text-xs">This one and {plural(others.channel, 'other')}</span>
                </span>
              </label>
            {/if}
          {:else}
            <p class="text-muted-foreground text-xs">No other video’s saved description has this exact text.</p>
          {/if}
          {#if others?.all || searchError}
            <label class="flex cursor-pointer items-start gap-2">
              <input type="radio" name="qe-scope" class="accent-foreground mt-1" checked={scope === 'here'} onchange={() => (scope = 'here')} />
              <span>Only this video</span>
            </label>
          {/if}
        </div>
      {/if}

      <div class="flex justify-end gap-1.5">
        <Button type="button" size="sm" variant="ghost" onclick={onclose}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!inSource || value === find || saving || (!others && !searchError)}>
          {saving ? 'Saving…' : value ? 'Replace' : 'Delete'}
        </Button>
      </div>
    </form>
  {/if}
</div>
