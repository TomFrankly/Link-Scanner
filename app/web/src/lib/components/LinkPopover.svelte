<script lang="ts">
  // The small editor that opens when you click a link chip in a video's Description tab: type a
  // new address (Enter saves) or remove the link. It doesn't save anything itself: `onchange`
  // hands the change to DescriptionPanel, which asks where to apply it (SaveEditsDialog: every video,
  // this channel's videos, or just this one).
  //
  // `link` is what was clicked; `source` is the scanned link it stands for. They differ when the
  // chip shows a planned replacement, in which case editing it changes that plan.
  import { tick } from 'svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import StatusBadge from './StatusBadge.svelte';
  import PlanFixButton from './PlanFixButton.svelte';
  import Hint from './Hint.svelte';
  import { data, ui } from '$lib/store.svelte';
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

  // Close on a click anywhere else (but not the click that opened it, which landed on a chip,
  // nor one in the Plan fix menu, which opens outside the popover).
  function outside(e: PointerEvent) {
    const t = e.target as HTMLElement;
    if (box && !box.contains(t) && !t.closest?.('.cm-link, [role="menu"]')) onclose();
  }
  /** Opens this link's entry in the Links view. */
  function goToLink() {
    if (!source) return;
    ui.openLink = source;
    onclose();
  }
</script>

<!-- It's placed where the link was on screen, so it closes when anything scrolls (the editor or
     a pane; scroll events don't bubble, hence the capture listener). Not its own address field,
     though: a long address scrolls that field sideways when it's selected, typed or pasted. -->
<svelte:window onpointerdown={outside} onkeydown={(e) => e.key === 'Escape' && (e.stopPropagation(), onclose())} />
<svelte:document onscrollcapture={(e) => !box?.contains(e.target as Node) && onclose()} />

<div
  bind:this={box}
  role="dialog"
  aria-label="Edit link"
  class="bg-popover text-popover-foreground fixed z-50 space-y-2.5 rounded-lg border p-3 shadow-lg"
  style="left: {left}px; width: min({WIDTH}px, calc(100vw - 16px)); {below ? `top: ${link.bottom + 6}px` : `bottom: ${window.innerHeight - link.top + 6}px`}"
>
  {#if row}
    <!-- Plan fix has the same choices as the link's own page; the arrow opens that page. -->
    <div class="flex items-center gap-1.5">
      <StatusBadge category={row.cls.category} tooltip={false} />
      <Hint text="Open this link in the Links view">
        {#snippet children(tip)}
          <button {...tip} type="button" class="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs transition-colors duration-150" onclick={goToLink}>
            <span class="truncate">{row.videos.length} video{row.videos.length === 1 ? '' : 's'}</span><ArrowRight class="size-3 shrink-0" />
          </button>
        {/snippet}
      </Hint>
      <span class="ml-auto"><PlanFixButton {row} /></span>
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
