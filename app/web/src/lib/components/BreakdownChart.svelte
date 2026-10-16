<script lang="ts">
  // Part-to-whole: one horizontal stacked bar in the fixed status palette, with a labeled,
  // clickable legend so color never carries meaning alone. The hover tooltip floats over the
  // bar so nothing below it moves.
  // Shown near the top of the Report page. Report passes the channel-filtered rows and the
  // active status filter; clicking a segment or legend item calls onSelect with a FILTERS key.
  import CircleX from '@lucide/svelte/icons/circle-x';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import CircleHelp from '@lucide/svelte/icons/circle-help';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Clock from '@lucide/svelte/icons/clock';
  import type { Row } from '$lib/types';

  let { rows, active, onSelect }: { rows: Row[]; active: string; onSelect: (filter: string) => void } = $props();

  const SEGMENTS = [
    { key: 'broken', label: 'Broken', color: '#d03b3b', icon: CircleX, cats: ['broken', 'parked'] },
    { key: 'redirects', label: 'Redirected', color: '#fab219', icon: TriangleAlert, cats: ['domain-changed', 'destination-changed', 'homepage'] },
    { key: 'unverifiable', label: 'Could not verify', color: 'var(--chart-neutral)', icon: CircleHelp, cats: ['unverifiable'] },
    { key: 'ok', label: 'OK', color: '#0ca30c', icon: CircleCheck, cats: ['ok'] },
    { key: 'ignored', label: 'Ignored', color: 'var(--chart-faint)', icon: EyeOff, cats: ['ignored'] },
    { key: 'pending', label: 'Not checked', color: 'var(--chart-faint)', icon: Clock, cats: ['pending'] },
  ];

  // Keeps the tooltip's center this far from the bar's ends, so it never spills past them.
  const TOOLTIP_HALF_WIDTH = 80;
  // These four always appear in the legend, even at zero; the rest only when they have links.
  const ALWAYS_SHOWN = ['broken', 'redirects', 'unverifiable', 'ok'];

  const total = $derived(rows.length);
  const parts = $derived(
    SEGMENTS.map((s) => ({ ...s, count: rows.filter((r) => s.cats.includes(r.cls.category)).length })).filter(
      (s) => s.count > 0 || ALWAYS_SHOWN.includes(s.key),
    ),
  );
  const okShare = $derived(total ? Math.round((parts.find((p) => p.key === 'ok')!.count / total) * 100) : 0);
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  // A tiny share reads "<1%" rather than a misleading "0%".
  const fmtPct = (n: number) => {
    const share = pct(n);
    return share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`;
  };

  let hover = $state<{ key: string; x: number } | null>(null);
  const hovered = $derived(parts.find((p) => p.key === hover?.key));
  let barEl = $state<HTMLDivElement>();
  /** Moves the tooltip with the pointer, in px from the bar's left edge. */
  function track(e: MouseEvent, key: string) {
    const rect = barEl!.getBoundingClientRect();
    hover = { key, x: Math.min(Math.max(e.clientX - rect.left, TOOLTIP_HALF_WIDTH), rect.width - TOOLTIP_HALF_WIDTH) };
  }
</script>

<section class="bg-card rounded-lg border p-5" aria-labelledby="health-heading">
  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <h2 id="health-heading" class="text-base font-semibold">Link health</h2>
    <p class="text-muted-foreground text-sm">
      <span class="text-foreground font-medium tabular-nums">{okShare}%</span> of {total.toLocaleString()} links are OK
    </p>
  </div>

  <div class="relative mt-4" bind:this={barEl}>
    {#if hovered && hover}
      <div
        class="bg-popover text-popover-foreground pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-sm tabular-nums"
        style="left: {hover.x}px"
        role="tooltip"
      >
        <span class="font-medium">{hovered.label}</span> · {hovered.count.toLocaleString()} links · {fmtPct(hovered.count)}
      </div>
    {/if}
    <!-- 2px surface gaps between segments; only the outer ends are rounded. -->
    <div class="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={parts.map((p) => `${p.label} ${p.count}`).join(', ')}>
      {#each parts.filter((p) => p.count > 0) as p (p.key)}
        <button
          class="h-full min-w-[3px] cursor-pointer transition-opacity duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
          style="width: {pct(p.count)}%; background: {p.color}; opacity: {hover && hover.key !== p.key ? 0.4 : 1}"
          aria-label="{p.label}: {p.count} links"
          onmousemove={(e) => track(e, p.key)}
          onmouseleave={() => (hover = null)}
          onclick={() => onSelect(p.key)}
        ></button>
      {/each}
    </div>
  </div>

  <div class="mt-3 flex flex-wrap gap-x-1 gap-y-1">
    {#each parts as p (p.key)}
      {@const Icon = p.icon}
      <button
        class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors duration-150 {active === p.key ? 'bg-muted' : ''}"
        onclick={() => onSelect(p.key)}
        aria-pressed={active === p.key}
      >
        <span class="size-2.5 shrink-0 rounded-[3px]" style="background: {p.color}"></span>
        <Icon class="text-muted-foreground size-3.5" />
        <span>{p.label}</span>
        <span class="font-medium tabular-nums">{p.count.toLocaleString()}</span>
        <span class="text-muted-foreground text-xs tabular-nums">{fmtPct(p.count)}</span>
      </button>
    {/each}
  </div>
</section>
