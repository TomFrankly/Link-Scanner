<script lang="ts">
  // A short explanation on hover or keyboard focus. The trigger keeps its own element:
  // pass a snippet that spreads `props` onto it.
  import type { Snippet } from 'svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';

  let { text, side = 'top', children }: { text: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: Snippet<[Record<string, unknown>]> } =
    $props();
</script>

<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}{@render children(props)}{/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content {side} class="max-w-64 text-xs leading-snug">{text}</Tooltip.Content>
</Tooltip.Root>
