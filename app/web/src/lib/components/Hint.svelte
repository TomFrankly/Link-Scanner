<script lang="ts">
  // A short explanation on hover or keyboard focus, with an optional keyboard shortcut shown as
  // keys after it. The trigger keeps its own element: pass a snippet that spreads `props` onto
  // it. Inside a menu trigger's `child` snippet, merge both sets with bits-ui's mergeProps.
  // A disabled button never fires hover or focus events, so to explain why one is disabled,
  // spread `props` onto a focusable wrapper instead (see the Scan button on Channels.svelte).
  import type { Snippet } from 'svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';

  let {
    text,
    kbd,
    side = 'top',
    children,
  }: { text: string; kbd?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: Snippet<[Record<string, unknown>]> } = $props();
</script>

<!-- An empty `text` shows no tooltip (e.g. a sidebar item whose label is already visible). -->
<Tooltip.Root disabled={!text}>
  <Tooltip.Trigger>
    {#snippet child({ props })}{@render children(props)}{/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content {side} class="flex max-w-64 items-center gap-2 text-xs leading-snug">
    <span>{text}</span>
    {#if kbd}
      <span class="flex gap-0.5">
        {#each kbd.split(' ') as k (k)}<kbd data-slot="kbd" class="bg-background/15 inline-flex h-4 min-w-4 items-center justify-center rounded px-1 font-sans text-[10px] font-medium">{k}</kbd>{/each}
      </span>
    {/if}
  </Tooltip.Content>
</Tooltip.Root>
