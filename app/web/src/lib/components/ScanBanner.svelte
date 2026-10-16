<script lang="ts">
  // Live scan progress: step indicator, animated bar and counters, speed and time left,
  // and a ticker of the links checked most recently.
  //
  // Sits under the top bar on every workspace page and shows only while `app.report.scan` is
  // fetching or checking. The scan runs on the server; this banner just polls its status
  // (see the polling effect below) and writes each reply into the store with applyScanState.
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

  const POLL_MS = 3000;
  // YouTube returns at most this many videos per uploads page, so pages × 50 ≈ videos.
  const VIDEOS_PER_PAGE = 50;
  // Minutes without progress before the banner says the scan looks stuck.
  const STALL_MINS = 2;
  // Links checked before the measured speed replaces the server's estimate.
  const MIN_DONE_FOR_RATE = 6;
  // Statuses that usually mean bot protection, not a broken page. Mirrors BOT_WALL_STATUSES in shared/core.ts.
  const BOT_WALL_STATUSES = [401, 403, 405, 429, 999];

  const scan = $derived(app.report?.scan);
  const active = $derived(scan?.status === 'fetching' || scan?.status === 'checking');
  const fetching = $derived(scan?.status === 'fetching');
  // Ticks every second while a scan runs, so elapsed time, speed and stall detection stay live.
  let now = $state(Date.now());

  // Fetch progress counts uploads pages; check progress counts links.
  const fraction = $derived.by(() => {
    if (!scan) return 0;
    if (scan.status === 'fetching') return scan.expected_pages ? Math.min(1, scan.pages_fetched / scan.expected_pages) : 0;
    return scan.total ? scan.done / scan.total : 0;
  });
  // Polls land every few seconds; tweening the bar and counter makes the jumps glide.
  const bar = new Tween(0, { duration: 900, easing: cubicOut });
  const count = new Tween(0, { duration: 900, easing: cubicOut });
  $effect(() => {
    bar.target = fraction;
    count.target = fetching ? (scan?.videos_fetched ?? 0) : (scan?.done ?? 0);
  });

  // The server sweeps stalled scans every 10 minutes; say so instead of showing a runaway ETA.
  const stalledMins = $derived(scan ? Math.floor((now - Date.parse(scan.updated_at)) / 60_000) : 0);
  const stalled = $derived(stalledMins >= STALL_MINS);
  // Measured speed of this scan once enough links are done; the server's estimate before that.
  const secsPerLink = $derived.by(() => {
    if (!scan?.checking_started_at || scan.done < MIN_DONE_FOR_RATE) return app.report?.estimates.secsPerLink ?? 2;
    return (now - Date.parse(scan.checking_started_at)) / 1000 / scan.done;
  });
  // While fetching, time left includes the checking still to come.
  const timeLeft = $derived.by(() => {
    if (!scan || !app.report) return '';
    const est = app.report.estimates;
    if (scan.status === 'fetching') {
      const pagesLeft = Math.max(0, scan.expected_pages - scan.pages_fetched);
      return duration(pagesLeft * est.secsPerPage + est.staleDay * est.secsPerLink);
    }
    return duration(Math.max(0, scan.total - scan.done) * secsPerLink);
  });
  // The server keeps the latest checked batch as JSON; show the newest four, newest first.
  const recent = $derived.by(() => {
    try {
      return (JSON.parse(scan?.recent ?? '[]') as { u: string; o: string; s: number | null }[]).slice(-4).reverse();
    } catch {
      return [];
    }
  });
  /** Label and dot color for a ticker entry, from its check outcome and HTTP status. */
  const tone = (o: string, s: number | null) =>
    o === 'unverifiable' || (s && BOT_WALL_STATUSES.includes(s))
      ? ['Could not verify', 'bg-muted-foreground/60']
      : o !== 'final' || (s ?? 0) >= 400
        ? ['Broken', 'bg-[#d03b3b]']
        : ['Reached', 'bg-[#0ca30c]'];

  // Poll while a scan runs; when it finishes, reload the report.
  // The effect starts when `active` turns true (a scan was started here, or one was already
  // running when the report loaded) and its cleanup stops both timers when the scan ends or the
  // workspace changes. Each reply updates `app.report` through applyScanState, which can end
  // `active` and so the polling. A reply for a workspace that's no longer open is dropped.
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
    }, POLL_MS);
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
        <!-- Step 1 only exists for full scans; rechecks go straight to checking. -->
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
            {fetching ? `videos fetched${app.report?.estimates ? ` of about ${(scan.expected_pages * VIDEOS_PER_PAGE).toLocaleString()}` : ''}` : `of ${scan.total.toLocaleString()} links checked`}
          </span>
        </div>
        <div class="text-muted-foreground text-right text-xs tabular-nums">
          {#if stalled}
            No progress for {stalledMins} min · it restarts automatically within 10 min
          {:else}
            {timeLeft} left{#if !fetching && scan.done >= MIN_DONE_FOR_RATE} · {(1 / secsPerLink).toFixed(1)} links/sec{/if}
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
