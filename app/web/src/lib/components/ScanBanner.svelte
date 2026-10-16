<script lang="ts">
  // Live scan progress: step indicator, animated bar and counters, speed and time left,
  // and a ticker of the links checked most recently.
  import { fly } from 'svelte/transition';
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { toast } from 'svelte-sonner';
  import Check from '@lucide/svelte/icons/check';
  import Loader from '@lucide/svelte/icons/loader-circle';
  import { api } from '$lib/api';
  import { duration } from '$lib/estimate';
  import { app, applyScanState, loadReport } from '$lib/store.svelte';
  import type { ScanState } from '$lib/types';

  const scan = $derived(app.report?.scan);
  const active = $derived(scan?.status === 'fetching' || scan?.status === 'checking');
  const fetching = $derived(scan?.status === 'fetching');
  let now = $state(Date.now());

  // Fetch progress counts uploads pages; check progress counts links.
  const fraction = $derived.by(() => {
    if (!scan) return 0;
    if (scan.status === 'fetching') return scan.expected_pages ? Math.min(1, scan.pages_fetched / scan.expected_pages) : 0;
    return scan.total ? scan.done / scan.total : 0;
  });
  const bar = new Tween(0, { duration: 900, easing: cubicOut });
  const count = new Tween(0, { duration: 900, easing: cubicOut });
  $effect(() => {
    bar.target = fraction;
    count.target = fetching ? (scan?.videos_fetched ?? 0) : (scan?.done ?? 0);
  });

  // The server sweeps stalled scans every 10 minutes; say so instead of showing a runaway ETA.
  const stalledMins = $derived(scan ? Math.floor((now - Date.parse(scan.updated_at)) / 60_000) : 0);
  const stalled = $derived(stalledMins >= 2);
  const secsPerLink = $derived.by(() => {
    if (!scan?.checking_started_at || scan.done < 6) return app.report?.estimates.secsPerLink ?? 2;
    return (now - Date.parse(scan.checking_started_at)) / 1000 / scan.done;
  });
  const timeLeft = $derived.by(() => {
    if (!scan || !app.report) return '';
    const e = app.report.estimates;
    if (scan.status === 'fetching') {
      const pagesLeft = Math.max(0, scan.expected_pages - scan.pages_fetched);
      return duration(pagesLeft * e.secsPerPage + e.staleDay * e.secsPerLink);
    }
    return duration(Math.max(0, scan.total - scan.done) * secsPerLink);
  });
  const recent = $derived.by(() => {
    try {
      return (JSON.parse(scan?.recent ?? '[]') as { u: string; o: string; s: number | null }[]).slice(-4).reverse();
    } catch {
      return [];
    }
  });
  const tone = (o: string, s: number | null) =>
    o === 'unverifiable' || (s && [401, 403, 405, 429, 999].includes(s))
      ? ['Could not verify', 'bg-muted-foreground/60']
      : o !== 'final' || (s ?? 0) >= 400
        ? ['Broken', 'bg-[#d03b3b]']
        : ['Reached', 'bg-[#0ca30c]'];

  // Poll while a scan runs; when it finishes, reload the report.
  $effect(() => {
    if (!active || !app.wsId) return;
    const wsId = app.wsId;
    const tick = setInterval(() => (now = Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const s = await api<ScanState>(`/w/${wsId}/scan`);
        if (wsId !== app.wsId) return;
        applyScanState(s);
        if (s.scan?.status === 'done') {
          toast.success(`Scan finished: ${s.scan.total.toLocaleString()} links checked`);
          await loadReport();
        } else if (s.scan?.status === 'failed') {
          toast.error(s.scan.error ?? 'Scan failed');
          await loadReport();
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  });
</script>

{#if active && scan}
  <div class="bg-muted/40 border-b" transition:fly={{ y: -8, duration: 250 }}>
    <div class="mx-auto max-w-6xl px-4 py-4 sm:px-6">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {#each [['Fetch videos', scan.kind === 'full'], ['Check links', true]] as [label, shown], i (label)}
          {#if shown}
            {@const state = i === 0 ? (fetching ? 'now' : 'done') : fetching ? 'next' : 'now'}
            <span class="flex items-center gap-2 {state === 'next' ? 'text-muted-foreground' : 'font-medium'}">
              <span
                class="flex size-5 items-center justify-center rounded-full text-[11px] {state === 'done'
                  ? 'bg-primary text-primary-foreground'
                  : state === 'now'
                    ? 'border-primary border-2'
                    : 'border'}"
              >
                {#if state === 'done'}<Check class="size-3" />{:else if state === 'now'}<Loader class="size-3 animate-spin" />{:else}{i + 1}{/if}
              </span>
              {label}
            </span>
          {/if}
        {/each}
        <span class="text-muted-foreground ml-auto text-xs">You can close this tab; the scan keeps running.</span>
      </div>

      <div class="mt-3 flex items-baseline justify-between gap-4">
        <div class="text-2xl font-semibold tracking-tight tabular-nums">
          {Math.round(count.current).toLocaleString()}
          <span class="text-muted-foreground text-sm font-normal">
            {fetching ? `videos fetched${app.report?.estimates ? ` of about ${(scan.expected_pages * 50).toLocaleString()}` : ''}` : `of ${scan.total.toLocaleString()} links checked`}
          </span>
        </div>
        <div class="text-muted-foreground text-right text-xs tabular-nums">
          {#if stalled}
            No progress for {stalledMins} min · it restarts automatically within 10 min
          {:else}
            {timeLeft} left{#if !fetching && scan.done >= 6} · {(1 / secsPerLink).toFixed(1)} links/sec{/if}
          {/if}
        </div>
      </div>

      <div class="bg-border relative mt-2 h-2 overflow-hidden rounded-full">
        <div class="bg-primary absolute inset-y-0 left-0 rounded-full" style="width: {Math.max(2, bar.current * 100)}%"></div>
        <div class="scan-shimmer absolute inset-0"></div>
      </div>

      {#if !fetching && recent.length}
        <ul class="mt-3 grid gap-1 sm:grid-cols-2">
          {#each recent as r (r.u)}
            {@const [label, dot] = tone(r.o, r.s)}
            <li class="text-muted-foreground flex min-w-0 items-center gap-2 text-xs" in:fly={{ y: 6, duration: 300 }}>
              <span class="size-1.5 shrink-0 rounded-full {dot}" title={label}></span>
              <span class="sr-only">{label}:</span>
              <span class="truncate font-mono">{r.u}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scan-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgb(255 255 255 / 0.35) 50%, transparent 100%);
    background-size: 40% 100%;
    background-repeat: no-repeat;
    animation: shimmer 1.6s ease-in-out infinite;
  }
  @keyframes shimmer {
    from {
      background-position: -40% 0;
    }
    to {
      background-position: 140% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scan-shimmer {
      animation: none;
    }
  }
</style>
