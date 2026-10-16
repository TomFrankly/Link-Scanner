<script lang="ts">
  // Plan what happens to one link when descriptions are fixed: replace it or remove it.
  // Mounted once by the Report page; opens when `ui.fixLinkUrl` is set (the "Replace with a
  // different link…" menu item, or clicking a PlannedFix summary). Saves through setFix in
  // store.svelte.ts, which stores the plan for the whole workspace. When the link is used in
  // more than one channel, the plan can be limited to one channel (`scope`); a channel's own
  // plan wins over the every-channel one for its videos.
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { REDIRECTS } from '$shared/fixes';
  import { Label } from '$lib/components/ui/label';
  import StatusBadge from './StatusBadge.svelte';
  import { data, setFix, ui } from '$lib/store.svelte';

  const row = $derived(ui.fixLinkUrl ? data.rows.find((r) => r.url === ui.fixLinkUrl) : undefined);
  // '' plans the fix for every channel; a channel id limits it to that channel's videos.
  let scope = $state('');
  const current = $derived(ui.fixLinkUrl ? data.fixes.exact(ui.fixLinkUrl, scope) : undefined);
  // The channels whose videos use this link, with how many of each.
  const linkChannels = $derived.by(() => {
    const n = new Map<string, number>();
    for (const v of row?.videos ?? []) n.set(v.channelId, (n.get(v.channelId) ?? 0) + 1);
    return [...n];
  });
  const moved = $derived(row?.result && row.result.finalUrl !== row.url ? row.result.finalUrl : '');
  // Only a redirect's destination is worth suggesting; a broken link's last hop is broken too.
  const suggestion = $derived(row && REDIRECTS.includes(row.cls.category) ? moved : '');
  let field = $state<HTMLTextAreaElement>();
  // The field grows with the link so the whole replacement is visible.
  function fit() {
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }
  // `void replacement` subscribes the effect, so it refits on every change, typed or set in code.
  $effect(() => {
    void replacement;
    fit();
  });

  let choice = $state<'replace' | 'remove'>('replace');
  let replacement = $state('');
  let saving = $state(false);
  // Start on the scope the dialog was opened for, each time it opens for a link.
  $effect(() => {
    if (ui.fixLinkUrl) scope = ui.fixLinkChannel;
  });
  // Reset the form whenever the link or scope changes, to what's planned for that scope.
  $effect(() => {
    if (!ui.fixLinkUrl) return;
    void scope;
    choice = current?.action ?? 'replace';
    replacement = current?.replacement ?? suggestion ?? '';
  });

  // A replacement needs to look like a web address (scheme, then something with a dot).
  const valid = $derived(choice === 'remove' || /^https?:\/\/\S+\.\S+/.test(replacement.trim()));
  const close = () => (ui.fixLinkUrl = null);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!row || !valid) return;
    saving = true;
    if (await setFix(row.url, choice, choice === 'replace' ? replacement.trim() : undefined, { channelId: scope })) close();
    saving = false;
  }
  async function clear() {
    if (row && (await setFix(row.url, 'clear', undefined, { channelId: scope }))) close();
  }
</script>

<Dialog.Root open={!!ui.fixLinkUrl} onOpenChange={(o) => !o && close()}>
  <!-- Focus the link field on open, not the first focusable element (which would pop a tooltip). -->
  <Dialog.Content
    class="sm:max-w-lg"
    onOpenAutoFocus={(e) => {
      e.preventDefault();
      requestAnimationFrame(() => (choice === 'replace' ? field?.focus() : null));
    }}
  >
    <Dialog.Header>
      <Dialog.Title>Plan a fix</Dialog.Title>
      <Dialog.Description>
        Used when you fix a video's description. It applies to every video with this link, and nothing changes on YouTube until you paste the new
        description.
      </Dialog.Description>
    </Dialog.Header>
    {#if row}
      <div class="bg-muted/40 space-y-1 rounded-md border p-3">
        <div class="flex items-center gap-2">
          <StatusBadge category={row.cls.category} tooltip={false} />
          <span class="text-muted-foreground text-xs">in {row.videos.length} video{row.videos.length === 1 ? '' : 's'}</span>
        </div>
        <div class="font-mono text-xs break-all">{row.url}</div>
        {#if moved}<div class="text-muted-foreground font-mono text-xs break-all">→ {moved}</div>{/if}
      </div>
      <form class="space-y-4" onsubmit={save}>
        {#if linkChannels.length > 1 || scope}
          <label class="flex items-center gap-2 text-sm">
            <span class="text-muted-foreground shrink-0">Apply in</span>
            <select
              bind:value={scope}
              class="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-3"
            >
              <option value="">All channels ({row.videos.length} video{row.videos.length === 1 ? '' : 's'})</option>
              {#each linkChannels as [id, n] (id)}
                <option value={id}>{data.channelTitle[id] ?? id} only ({n} video{n === 1 ? '' : 's'})</option>
              {/each}
            </select>
          </label>
        {/if}
        <div class="space-y-2" role="radiogroup" aria-label="Fix">
          <label class="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-md border p-3 {choice === 'replace' ? 'border-ring' : ''}">
            <input type="radio" class="mt-1" bind:group={choice} value="replace" />
            <span class="flex-1 space-y-2">
              <span class="block text-sm font-medium">Replace with a new link</span>
              <Label for="replacement" class="sr-only">Replacement link</Label>
              <!-- A textarea only so long links wrap. It holds one line: pasted line breaks are
                   stripped and Enter submits the form. -->
              <textarea
                id="replacement"
                bind:this={field}
                rows="1"
                placeholder="https://"
                spellcheck="false"
                class="border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30 block w-full resize-none overflow-hidden rounded-md border bg-transparent px-2.5 py-1.5 font-mono text-xs leading-relaxed break-all outline-none focus-visible:ring-3"
                bind:value={replacement}
                oninput={() => (replacement = replacement.replace(/[\r\n]+/g, ''))}
                onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit())}
                onfocus={() => (choice = 'replace')}
                aria-invalid={choice === 'replace' && replacement.trim() !== '' && !valid}
              ></textarea>
              {#if suggestion && replacement !== suggestion}
                <button type="button" class="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2" onclick={() => (replacement = suggestion)}>
                  Use where it redirects now
                </button>
              {/if}
            </span>
          </label>
          <label class="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-md border p-3 {choice === 'remove' ? 'border-ring' : ''}">
            <input type="radio" class="mt-1" bind:group={choice} value="remove" />
            <span>
              <span class="block text-sm font-medium">Remove it from descriptions</span>
              <span class="text-muted-foreground block text-xs">Text around the link stays, so check the result before pasting it.</span>
            </span>
          </label>
        </div>
        <Dialog.Footer class="gap-2 sm:justify-between">
          {#if current}<Button type="button" variant="ghost" onclick={clear}>Clear planned fix</Button>{:else}<span></span>{/if}
          <div class="flex gap-2">
            <Button type="button" variant="outline" onclick={close}>Cancel</Button>
            <Button type="submit" disabled={!valid || saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
