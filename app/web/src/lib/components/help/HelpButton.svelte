<script lang="ts">
  // The Help dialog, opened by the sidebar's Help item (`ui.help`).
  // The dialog has three screens: a menu (home), a step-by-step tour, and a plain-language
  // explanation of how the tool works. Each sub-screen has a back button to the menu.
  import GraduationCap from '@lucide/svelte/icons/graduation-cap';
  import Workflow from '@lucide/svelte/icons/workflow';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import AppWindow from '@lucide/svelte/icons/app-window';
  import { ui } from '$lib/store.svelte';
  import StudioTabDialog from './StudioTabDialog.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { brand } from '$lib/brand';
  import Tutorial from './Tutorial.svelte';
  import HowItWorks from './HowItWorks.svelte';
  import GitHubMark from './GitHubMark.svelte';

  type Screen = 'home' | 'tour' | 'how';
  let screen = $state<Screen>('home');

  // Always start from the menu when the dialog is reopened.
  $effect(() => {
    if (ui.help) screen = 'home';
  });

  const TITLES: Record<Screen, string> = { home: 'Help', tour: 'Take the tour', how: 'How it works' };
</script>

<Dialog.Root bind:open={ui.help}>
  <!-- The tour and explainer get a fixed height, so the dialog doesn't jump around between steps. -->
  <Dialog.Content
    class="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 p-0 sm:max-w-xl {screen === 'home' ? '' : 'h-[min(44rem,calc(100dvh-2rem))]'}"
  >
    <Dialog.Header class="flex-row items-center gap-2 border-b px-4 py-3 pr-12">
      {#if screen !== 'home'}
        <Button size="icon-sm" variant="ghost" aria-label="Back to help" onclick={() => (screen = 'home')}><ArrowLeft /></Button>
      {/if}
      <Dialog.Title class="text-base">{TITLES[screen]}</Dialog.Title>
    </Dialog.Header>

    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if screen === 'home'}
        <div class="p-4">
          <Dialog.Description class="mb-4">Learn your way around Link Checker, or see what it does behind the scenes.</Dialog.Description>
          <div class="divide-y rounded-lg border">
            {#each [
              { key: 'tour', Icon: GraduationCap, title: 'Take the tour', text: 'Seven short steps: add channels, run a scan, and fix what it finds.' },
              { key: 'how', Icon: Workflow, title: 'How it works', text: 'What happens during a scan, where it runs, and what it can and can’t access.' },
            ] as const as item (item.key)}
              <button
                type="button"
                class="hover:bg-muted/60 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 first:rounded-t-lg"
                onclick={() => (screen = item.key)}
              >
                <span class="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md"><item.Icon class="size-4" /></span>
                <span class="min-w-0 flex-1">
                  <span class="block font-medium">{item.title}</span>
                  <span class="text-muted-foreground block text-xs">{item.text}</span>
                </span>
                <ChevronRight class="text-muted-foreground size-4 shrink-0" />
              </button>
            {/each}
            <button
              type="button"
              class="hover:bg-muted/60 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150"
              onclick={() => ((ui.help = false), (ui.studioTab = true))}
            >
              <span class="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md"><AppWindow class="size-4" /></span>
              <span class="min-w-0 flex-1">
                <span class="block font-medium">Reuse one Studio tab</span>
                <span class="text-muted-foreground block text-xs">Open Studio links in one pane beside the app: Edge Split View, or a small extension.</span>
              </span>
              <ChevronRight class="text-muted-foreground size-4 shrink-0" />
            </button>
            <a
              href={brand.repo}
              target="_blank"
              rel="noreferrer"
              class="hover:bg-muted/60 flex w-full items-center gap-3 rounded-b-lg px-4 py-3 transition-colors duration-150"
            >
              <span class="bg-foreground text-background flex size-9 shrink-0 items-center justify-center rounded-md"><GitHubMark class="size-4" /></span>
              <span class="min-w-0 flex-1">
                <span class="block font-medium">Read the code on GitHub</span>
                <span class="text-muted-foreground block text-xs">It’s open source, so anyone can check exactly what it does.</span>
              </span>
              <ChevronRight class="text-muted-foreground size-4 shrink-0" />
            </a>
          </div>
        </div>
      {:else if screen === 'tour'}
        <Tutorial onDone={() => (screen = 'home')} onNavigate={() => (ui.help = false)} />
      {:else}
        <HowItWorks />
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

<StudioTabDialog />
