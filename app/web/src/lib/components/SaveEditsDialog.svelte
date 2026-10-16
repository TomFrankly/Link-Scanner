<script lang="ts">
  // Saves a hand edit from the Fix description drawer. The drawer works out what changed and
  // passes it in as `changes`:
  // - `swaps`: links changed inside an otherwise unchanged line (shared/textEdits.ts
  //   splitLinkSwaps), or a link edited or removed from its chip in the editor (`to` is '' for a
  //   removal). By default each becomes a planned link fix, which changes the link in every video
  //   that has it, whatever text surrounds it. It can be limited to this video's channel, or
  //   saved as a text edit for just this video.
  // - `edits`: other changed lines, saved as text edits. For each, this dialog searches every
  //   other video's saved description for the same lines and lets the user pick which of those
  //   videos get the change too. Saved descriptions come from full scans, so the search costs no
  //   YouTube quota. A change applied to every match is saved with `videos: null`, so it also
  //   reaches videos that get the same lines later; unticking any video saves an explicit list.
  //   In a workspace with several channels, the search can be limited to this video's channel.
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { applyTextEdits, contains, type FoundEdit, type LinkSwap } from '$shared/textEdits';
  import { app, data, loadDescriptions, saveTextEdits, setFix } from '$lib/store.svelte';

  let {
    changes,
    videoId,
    channelId,
    onclose,
    onsaved,
  }: {
    changes: { edits: FoundEdit[]; swaps: LinkSwap[] } | null;
    videoId: string;
    channelId: string;
    onclose: () => void;
    onsaved: () => void;
  } = $props();
  const channelName = $derived(data.channelTitle[channelId] ?? 'this channel');
  const edits = $derived(changes?.edits.length ? changes.edits : null);
  const swaps = $derived(changes?.swaps ?? []);

  // Per link swap: change it in every video or in this channel's videos (a planned fix), or only
  // in this video (a text edit).
  let swapScope = $state<('all' | 'channel' | 'here')[]>([]);
  $effect(() => {
    swapScope = swaps.map(() => 'all');
  });
  const videosWith = (url: string) => data.rows.find((r) => r.url === url)?.videos ?? [];
  const inChannel = (url: string) => videosWith(url).filter((v) => v.channelId === channelId).length;
  const videos = (n: number) => (n === 1 ? 'the 1 video that uses it' : `all ${n} videos that use it`);

  const titles = $derived(new Map((app.report?.videos ?? []).map((v) => [v.id, v.t])));

  // Every other video's description, with the workspace's saved edits already applied (that's
  // the text a new edit would run on). Null while loading.
  let sources = $state<Map<string, string> | null>(null);
  let unsearched = $state(0);
  let loadError = $state<string | null>(null);
  $effect(() => {
    if (!edits) return;
    sources = null;
    loadError = null;
    const rules = app.report?.textEdits ?? [];
    loadDescriptions()
      .then((all) => {
        const out = new Map<string, string>();
        let missing = 0;
        for (const v of app.report?.videos ?? []) {
          if (v.id === videoId) continue;
          const d = all.get(v.id)?.d;
          if (d == null) missing++;
          else out.set(v.id, applyTextEdits(d, rules, v.id, v.c).text);
        }
        unsearched = missing;
        sources = out;
      })
      .catch((e) => (loadError = (e as Error).message));
  });

  // For each change, the other videos that contain its lines, newest first as the report lists
  // them; with `onlyChannel` ticked, just those in this video's channel.
  let onlyChannel = $state<boolean[]>([]);
  const found = $derived(
    edits && sources ? edits.map((e) => [...sources!].filter(([, text]) => contains(text, e.find)).map(([id]) => id)) : null,
  );
  const matches = $derived(found?.map((m, i) => (onlyChannel[i] ? m.filter((id) => data.channelOf.get(id) === channelId) : m)) ?? null);
  // Whether a change's matches include another channel's videos, so the channel choice is worth showing.
  const crossChannel = (i: number) => !!found?.[i]?.some((id) => data.channelOf.get(id) !== channelId);
  // Which matches are ticked, per change. Everything starts ticked.
  let picked = $state<Set<string>[]>([]);
  let shown = $state<boolean[]>([]);
  $effect(() => {
    onlyChannel = (changes?.edits ?? []).map(() => false);
  });
  $effect(() => {
    picked = matches ? matches.map((m) => new Set(m)) : [];
  });
  $effect(() => {
    shown = (changes?.edits ?? []).map(() => false);
  });
  function toggle(i: number, id: string) {
    const next = new Set(picked[i]);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    picked[i] = next;
  }
  const toggleAll = (i: number) => (picked[i] = picked[i]!.size === matches![i]!.length ? new Set() : new Set(matches![i]));

  let saving = $state(false);
  // Ready once the other videos have been searched (or the search failed).
  const ready = $derived(!edits || !!matches || !!loadError);
  async function save() {
    if (!changes || !ready) return;
    saving = true;
    let ok = true;
    for (const [i, s] of swaps.entries()) {
      if (swapScope[i] === 'here') continue;
      const opts = { quiet: true, channelId: swapScope[i] === 'channel' ? channelId : '' };
      ok = (await (s.to ? setFix(s.from, 'replace', s.to, opts) : setFix(s.from, 'remove', undefined, opts))) && ok;
    }
    const lineEdits: (FoundEdit & { videos: string[] | null; channelId?: string | null })[] = (edits ?? []).map((e, i) => {
      // If the search failed, the edit is saved for this video only.
      const m = matches?.[i] ?? [];
      const all = m.length > 0 && picked[i]!.size === m.length;
      return all ? { ...e, videos: null, channelId: onlyChannel[i] ? channelId : null } : { ...e, videos: [videoId, ...(picked[i] ?? [])] };
    });
    // Swaps kept to this video go last: an edit above may include their line, unchanged, as context.
    const seen = new Set<string>();
    for (const [i, s] of swaps.entries())
      if (swapScope[i] === 'here' && !seen.has(s.find)) {
        seen.add(s.find);
        lineEdits.push({ find: s.find, replace: s.replace, videos: [videoId] });
      }
    if (lineEdits.length) ok = (await saveTextEdits(lineEdits)) && ok;
    saving = false;
    if (ok) onsaved();
  }

  const lines = (s: string) => (s === '' ? [] : s.split('\n'));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<Dialog.Root open={!!changes} onOpenChange={(o) => !o && onclose()}>
  <Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Save {(edits?.length ?? 0) + swaps.length > 1 ? 'changes' : 'change'}</Dialog.Title>
      <Dialog.Description>
        Saved changes are applied whenever these descriptions are fixed here, and in the Excel export. Nothing changes on YouTube until you paste the new
        description.
      </Dialog.Description>
    </Dialog.Header>

    <div class="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
      {#each swaps as s, i (s.from)}
        {@const n = videosWith(s.from).length}
        {@const nHere = inChannel(s.from)}
        {@const verb = s.to ? 'Replace' : 'Remove'}
        <div class="space-y-2.5 rounded-md border p-3">
          <div class="space-y-0.5 font-mono text-xs break-all">
            <div class="text-muted-foreground line-through">{s.from}</div>
            <div>{s.to ? `→ ${s.to}` : '→ removed'}</div>
          </div>
          <div class="space-y-1.5" role="radiogroup" aria-label="Where to change this link">
            <label class="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="swap-{i}" class="accent-foreground mt-1" checked={swapScope[i] === 'all'} onchange={() => (swapScope[i] = 'all')} />
              <span>
                {verb} this link in {videos(n)}{nHere < n ? ', in every channel' : ''}
                <span class="text-muted-foreground block text-xs">Saved as a planned fix, so it changes wherever the link appears, whatever text is around it.</span>
              </span>
            </label>
            {#if nHere < n && nHere > 1}
              <label class="flex cursor-pointer items-start gap-2 text-sm">
                <input type="radio" name="swap-{i}" class="accent-foreground mt-1" checked={swapScope[i] === 'channel'} onchange={() => (swapScope[i] = 'channel')} />
                <span>{verb} it in {channelName}'s {nHere} videos only</span>
              </label>
            {/if}
            {#if s.find}
              <label class="flex cursor-pointer items-start gap-2 text-sm">
                <input type="radio" name="swap-{i}" class="accent-foreground mt-1" checked={swapScope[i] === 'here'} onchange={() => (swapScope[i] = 'here')} />
                <span>Only in this video</span>
              </label>
            {/if}
          </div>
        </div>
      {/each}

      {#each edits ?? [] as e, i (i)}
        <div class="space-y-2">
          <!-- The change itself, as removed and added lines. -->
          <div class="max-h-48 overflow-y-auto rounded-md border font-mono text-xs leading-relaxed">
            {#each lines(e.find) as l, k (k)}
              <div class="flex bg-[#d03b3b]/10 px-2 dark:bg-[#d03b3b]/20">
                <span class="text-muted-foreground w-4 shrink-0 select-none">−</span><span class="break-all whitespace-pre-wrap">{l || ' '}</span>
              </div>
            {/each}
            {#each lines(e.replace) as l, k (k)}
              <div class="flex bg-[#0ca30c]/10 px-2 dark:bg-[#0ca30c]/20">
                <span class="text-muted-foreground w-4 shrink-0 select-none">+</span><span class="break-all whitespace-pre-wrap">{l || ' '}</span>
              </div>
            {:else}
              <div class="text-muted-foreground px-2 italic">Lines deleted</div>
            {/each}
          </div>

          <!-- Where else it appears. -->
          {#if matches && (crossChannel(i) || onlyChannel[i])}
            <label class="text-muted-foreground flex items-center gap-2 text-xs">
              <input type="checkbox" class="accent-foreground size-3.5" checked={onlyChannel[i]} onchange={() => (onlyChannel[i] = !onlyChannel[i])} />
              Only search videos in {channelName}
            </label>
          {/if}
          {#if loadError}
            <div class="text-xs text-[#b42d2d] dark:text-[#f07070]">Couldn't search other videos: {loadError}</div>
          {:else if !matches}
            <div class="text-muted-foreground text-xs">Searching other videos…</div>
          {:else if matches[i]!.length === 0}
            <div class="text-muted-foreground text-xs">Not found in any other video. It will apply to this video only.</div>
          {:else}
            {@const m = matches[i]!}
            {@const sel = picked[i] ?? new Set()}
            <div class="rounded-md border">
              <div class="flex items-center gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  id="all-{i}"
                  class="accent-foreground size-3.5"
                  checked={sel.size === m.length}
                  indeterminate={sel.size > 0 && sel.size < m.length}
                  onchange={() => toggleAll(i)}
                />
                <label for="all-{i}" class="flex-1 text-sm">
                  Also apply to {sel.size === m.length ? `all ${plural(m.length, 'other video')}` : `${sel.size} of ${plural(m.length, 'other video')}`} with these lines
                </label>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-xs"
                  aria-expanded={shown[i]}
                  onclick={() => (shown[i] = !shown[i])}
                >
                  {shown[i] ? 'Hide' : 'Choose'} <ChevronRight class="size-3.5 transition-transform {shown[i] ? 'rotate-90' : ''}" />
                </button>
              </div>
              {#if shown[i]}
                <ul class="max-h-48 divide-y overflow-y-auto border-t">
                  {#each m as id (id)}
                    <li>
                      <label class="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs">
                        <input type="checkbox" class="accent-foreground size-3.5" checked={sel.has(id)} onchange={() => toggle(i, id)} />
                        <span class="truncate">{titles.get(id) ?? id}</span>
                      </label>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      {#if edits && matches && unsearched > 0}
        <p class="text-muted-foreground text-xs">
          {plural(unsearched, 'video')} {unsearched === 1 ? "hasn't" : "haven't"} had {unsearched === 1 ? 'its' : 'their'} description saved yet, so {unsearched === 1
            ? 'it'
            : 'they'} weren't searched. Run a full scan to include them.{#if matches.some((m) => m.length)} An edit applied to every match also reaches them once they're saved.{/if}
        </p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={onclose}>Cancel</Button>
      <Button onclick={save} disabled={saving || !ready}>{saving ? 'Saving…' : 'Save'}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
