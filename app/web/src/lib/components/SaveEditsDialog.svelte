<script lang="ts">
  // Saves a hand edit from the Fix description drawer as text edits (shared/textEdits.ts).
  // The drawer works out which lines changed and passes them in as `edits`; this dialog shows
  // each change, searches every other video's saved description for the same lines, and lets
  // the user pick which of those videos get the change too. Saved descriptions come from full
  // scans, so the search costs no YouTube quota.
  //
  // A change applied to every match is saved with `videos: null`, so it also reaches videos
  // that get the same lines later. Unticking any video saves an explicit list instead.
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { applyTextEdits, contains, type FoundEdit } from '$shared/textEdits';
  import { app, loadDescriptions, saveTextEdits } from '$lib/store.svelte';

  let { edits, videoId, onclose, onsaved }: { edits: FoundEdit[] | null; videoId: string; onclose: () => void; onsaved: () => void } =
    $props();

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
          else out.set(v.id, applyTextEdits(d, rules, v.id).text);
        }
        unsearched = missing;
        sources = out;
      })
      .catch((e) => (loadError = (e as Error).message));
  });

  // For each change, the other videos that contain its lines, newest first as the report lists them.
  const matches = $derived(
    edits && sources ? edits.map((e) => [...sources!].filter(([, text]) => contains(text, e.find)).map(([id]) => id)) : null,
  );
  // Which matches are ticked, per change. Everything starts ticked.
  let picked = $state<Set<string>[]>([]);
  let shown = $state<boolean[]>([]);
  $effect(() => {
    picked = matches ? matches.map((m) => new Set(m)) : [];
    shown = matches ? matches.map(() => false) : [];
  });
  function toggle(i: number, id: string) {
    const next = new Set(picked[i]);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    picked[i] = next;
  }
  const toggleAll = (i: number) => (picked[i] = picked[i]!.size === matches![i]!.length ? new Set() : new Set(matches![i]));

  let saving = $state(false);
  async function save() {
    if (!edits || (!matches && !loadError)) return;
    saving = true;
    const ok = await saveTextEdits(
      edits.map((e, i) => {
        // If the search failed, the edit is saved for this video only.
        const m = matches?.[i] ?? [];
        const all = m.length > 0 && picked[i]!.size === m.length;
        return { ...e, videos: all ? null : [videoId, ...(picked[i] ?? [])] };
      }),
    );
    saving = false;
    if (ok) onsaved();
  }

  const lines = (s: string) => (s === '' ? [] : s.split('\n'));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<Dialog.Root open={!!edits} onOpenChange={(o) => !o && onclose()}>
  <Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Save {edits && edits.length > 1 ? `${edits.length} edits` : 'edit'}</Dialog.Title>
      <Dialog.Description>
        Saved edits are applied whenever these descriptions are fixed here, and in the Excel export. Nothing changes on YouTube until you paste the new
        description.
      </Dialog.Description>
    </Dialog.Header>

    <div class="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
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

      {#if matches && unsearched > 0}
        <p class="text-muted-foreground text-xs">
          {plural(unsearched, 'video')} {unsearched === 1 ? "hasn't" : "haven't"} had {unsearched === 1 ? 'its' : 'their'} description saved yet, so {unsearched === 1
            ? 'it'
            : 'they'} weren't searched. Run a full scan to include them.{#if matches.some((m) => m.length)} An edit applied to every match also reaches them once they're saved.{/if}
        </p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={onclose}>Cancel</Button>
      <Button onclick={save} disabled={saving || (!matches && !loadError)}>{saving ? 'Saving…' : 'Save'}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
