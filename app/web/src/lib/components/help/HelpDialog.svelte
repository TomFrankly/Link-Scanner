<script lang="ts">
  // The Help dialog, opened by the sidebar's Help item (`ui.help`) or on one page by
  // openHelp(page). A large docs-style modal: a sidebar listing every page (the tour, four
  // "How it works" pages, the Studio tab page), and the page itself, with Previous / Next at its
  // end. On narrow screens the sidebar becomes the start screen, and each page has a back button.
  import GraduationCap from '@lucide/svelte/icons/graduation-cap';
  import ScanSearch from '@lucide/svelte/icons/scan-search';
  import Server from '@lucide/svelte/icons/server';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import CircleHelp from '@lucide/svelte/icons/circle-help';
  import AppWindow from '@lucide/svelte/icons/app-window';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import { MediaQuery } from 'svelte/reactivity';
  import { ui, type HelpPage } from '$lib/store.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { brand } from '$lib/brand';
  import Tutorial from './Tutorial.svelte';
  import HowItWorks from './HowItWorks.svelte';
  import StudioTab from './StudioTab.svelte';
  import GitHubMark from './GitHubMark.svelte';

  const GROUPS = [
    { title: 'Get started', pages: [{ key: 'tour', Icon: GraduationCap, title: 'Take the tour', text: 'Seven short steps, from adding a channel to fixing descriptions.' }] },
    {
      title: 'How it works',
      pages: [
        { key: 'scan', Icon: ScanSearch, title: 'What a scan does', text: 'From YouTube’s video list to a status for every link.' },
        { key: 'runs', Icon: Server, title: 'Where it runs', text: 'Cloudflare Workers, Queues and the D1 database.' },
        { key: 'privacy', Icon: ShieldCheck, title: 'Privacy and safety', text: 'Sign-in, what’s private, and YouTube’s daily allowance.' },
        { key: 'verify', Icon: CircleHelp, title: '“Could not verify” links', text: 'Why some sites can’t be checked, and what to do.' },
      ],
    },
    { title: 'Tools', pages: [{ key: 'studio', Icon: AppWindow, title: 'Reuse one Studio tab', text: 'Open Studio links in one pane beside the app.' }] },
  ] as const;
  const PAGES = GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.title })));

  // Wide enough for the sidebar; below that, the page list is the start screen.
  const wide = new MediaQuery('min-width: 768px');
  const current = $derived(ui.helpPage ?? (wide.current ? 'tour' : null));
  const index = $derived(PAGES.findIndex((p) => p.key === current));
  const page = $derived(PAGES[index]);

  let scroller = $state<HTMLDivElement>();
  function show(key: HelpPage | null) {
    ui.helpPage = key;
    scroller?.scrollTo(0, 0);
  }
</script>

{#snippet nav(large: boolean)}
  <nav aria-label="Help pages" class="space-y-5">
    {#each GROUPS as g (g.title)}
      <div>
        <div class="text-muted-foreground mb-1 px-2 text-xs font-medium">{g.title}</div>
        <ul class="space-y-0.5">
          {#each g.pages as p (p.key)}
            <li>
              <button
                type="button"
                aria-current={p.key === current ? 'page' : undefined}
                class="focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-md px-2 text-left font-medium transition-colors duration-150 outline-none focus-visible:ring-2 {large
                  ? 'py-2.5'
                  : 'h-8'} {p.key === current && !large ? 'bg-muted text-foreground' : `hover:bg-muted/60 hover:text-foreground ${large ? '' : 'text-muted-foreground'}`}"
                onclick={() => show(p.key)}
              >
                {#if large}
                  <span class="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md"><p.Icon class="size-4" /></span>
                  <span class="min-w-0 flex-1">
                    <span class="block">{p.title}</span>
                    <span class="text-muted-foreground block text-xs font-normal">{p.text}</span>
                  </span>
                  <ChevronRight class="text-muted-foreground size-4 shrink-0" />
                {:else}
                  <p.Icon class="size-4 shrink-0" />
                  <span class="truncate">{p.title}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </nav>
{/snippet}

{#snippet github()}
  <a
    href={brand.repo}
    target="_blank"
    rel="noreferrer"
    class="hover:bg-muted/60 text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-8 items-center gap-2.5 rounded-md px-2 font-medium transition-colors duration-150 outline-none focus-visible:ring-2"
  >
    <GitHubMark class="size-4 shrink-0" />
    <span class="flex-1 truncate">Code on GitHub</span>
    <ArrowUpRight class="text-muted-foreground size-3.5" />
  </a>
{/snippet}

<Dialog.Root bind:open={ui.help}>
  <!-- A fixed height, so it doesn't jump around between pages. overflow-hidden keeps every scrollbar inside the rounded card. -->
  <!-- No autofocus: it would ring the first page in the list, which reads as the selected one. -->
  <Dialog.Content class="flex h-[min(52rem,calc(100dvh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-5xl" onOpenAutoFocus={(e) => e.preventDefault()}>
    <aside class="hidden w-60 shrink-0 flex-col border-r md:flex">
      <div class="px-4 pt-4 pb-3">
        <div class="font-semibold">Help</div>
        <div class="text-muted-foreground text-xs">{brand.name || 'Link Checker'}</div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-4">{@render nav(false)}</div>
      <div class="border-t p-2">{@render github()}</div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <Dialog.Header class="flex-row items-center gap-2 border-b px-4 py-3 pr-12 md:px-8">
        {#if page && !wide.current}
          <Button size="icon-sm" variant="ghost" aria-label="All help pages" onclick={() => show(null)}><ArrowLeft /></Button>
        {/if}
        <div class="min-w-0">
          {#if page}<div class="text-muted-foreground text-xs">{page.group}</div>{/if}
          <Dialog.Title class="truncate text-base">{page?.title ?? 'Help'}</Dialog.Title>
        </div>
        <Dialog.Description class="sr-only">How to use Link Checker and how it works.</Dialog.Description>
      </Dialog.Header>

      <div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto">
        {#if !page}
          <div class="space-y-5 p-4">
            {@render nav(true)}
            <div class="border-t pt-3">{@render github()}</div>
          </div>
        {:else if page.key === 'tour'}
          <Tutorial onDone={() => (ui.help = false)} onNavigate={() => (ui.help = false)} />
        {:else}
          <div class="mx-auto max-w-2xl px-4 py-6 leading-relaxed md:px-8 md:py-8">
            {#if page.key === 'studio'}
              <StudioTab />
            {:else}
              <HowItWorks page={page.key} />
            {/if}

            <!-- Previous / Next, like a docs site. -->
            <div class="mt-10 grid grid-cols-2 gap-3">
              {#each [PAGES[index - 1], PAGES[index + 1]] as p, i (i)}
                {#if p}
                  <button
                    type="button"
                    class="hover:bg-muted/60 rounded-lg border px-3 py-2.5 transition-colors duration-150 {i ? 'col-start-2 text-right' : 'text-left'}"
                    onclick={() => show(p.key)}
                  >
                    <span class="text-muted-foreground flex items-center gap-1 text-xs {i ? 'justify-end' : ''}">
                      {#if !i}<ChevronLeft class="size-3.5" />{/if}{i ? 'Next' : 'Previous'}{#if i}<ChevronRight class="size-3.5" />{/if}
                    </span>
                    <span class="mt-0.5 block truncate font-medium">{p.title}</span>
                  </button>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
