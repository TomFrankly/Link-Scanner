<script lang="ts">
  // The small editor that opens when you click a link chip in the Fix description drawer: type a
  // new address (Enter saves) or remove the link. It doesn't save anything itself: `onchange`
  // hands the change to the drawer, which asks where to apply it (SaveEditsDialog: every video,
  // this channel's videos, or just this one).
  //
  // `link` is what was clicked; `source` is the scanned link it stands for. They differ when the
  // chip shows a planned replacement, in which case editing it changes that plan.
  import { tick } from 'svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import StatusBadge from './StatusBadge.svelte';
  import { data } from '$lib/store.svelte';
  import type { LinkClick } from './DescriptionEditor.svelte';

  let {
    link,
    source,
    onchange,
    onclose,
  }: { link: LinkClick; source: string | null; onchange: (to: string) => void; onclose: () => void } = $props();

  const row = $derived(source ? data.rows.find((r) => r.url === source) : undefined);
  let value = $state(''); // set from `link` below, each time a chip is clicked
  let input = $state<HTMLInputElement>();
  let box = $state<HTMLDivElement>();
  $effect(() => {
    value = link.url;
    // Focus as soon as the new value is in the box (tick), so typing right after the click
    // lands here, not in the editor, and replaces the old address.
    tick().then(() => {
      input?.focus();
      input?.select();
    });
  });

  const valid = $derived(/^https?:\/\/\S+\.\S+$/.test(value.trim()));
  function submit(e: SubmitEvent) {
    e.preventDefault();
    const to = value.trim();
    if (to === link.url) return onclose();
    if (valid) onchange(to);
  }

  // Below the link, or above it when there isn't room. Kept inside the window.
  const WIDTH = 352;
  const left = $derived(Math.max(8, Math.min(link.left, window.innerWidth - WIDTH - 8)));
  const below = $derived(link.bottom + 200 < window.innerHeight);

  // Close on a click anywhere else (but not the click that opened it, which landed on a chip).
  function outside(e: PointerEvent) {
    if (box && !box.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.cm-link')) onclose();
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={(e) => e.key === 'Escape' && (e.stopPropagation(), onclose())} />

<div
  bind:this={box}
  role="dialog"
  aria-label="Edit link"
  class="bg-popover text-popover-foreground fixed z-50 space-y-2.5 rounded-lg border p-3 shadow-lg"
  style="left: {left}px; width: min({WIDTH}px, calc(100vw - 16px)); {below ? `top: ${link.bottom + 6}px` : `bottom: ${window.innerHeight - link.top + 6}px`}"
>
  {#if row}
    <div class="flex items-center gap-2">
      <StatusBadge category={row.cls.category} tooltip={false} />
      <span class="text-muted-foreground text-xs">in {row.videos.length} video{row.videos.length === 1 ? '' : 's'}</span>
    </div>
    {#if source !== link.url}<div class="text-muted-foreground font-mono text-xs break-all">Planned replacement for {source}</div>{/if}
    <form class="space-y-2.5" onsubmit={submit}>
      <input
        bind:this={input}
        bind:value
        spellcheck="false"
        aria-label="Link address"
        aria-invalid={!valid}
        class="border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30 h-8 w-full rounded-md border bg-transparent px-2.5 font-mono text-xs outline-none focus-visible:ring-3"
      />
      <div class="flex items-center gap-1.5">
        <Button type="button" size="sm" variant="ghost" onclick={() => onchange('')}><Trash /> Remove</Button>
        <Button type="button" size="sm" variant="ghost" href={value} target="_blank" rel="noreferrer"><ExternalLink /> Open</Button>
        <Button type="submit" size="sm" class="ml-auto" disabled={!valid}>Change…</Button>
      </div>
    </form>
  {:else}
    <div class="font-mono text-xs break-all">{link.url}</div>
    <p class="text-muted-foreground text-xs">This link isn't in a scan yet, so it can only be edited as text here. Run a full scan to pick it up.</p>
    <Button size="sm" variant="ghost" href={link.url} target="_blank" rel="noreferrer"><ExternalLink /> Open</Button>
  {/if}
</div>
