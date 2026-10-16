<script lang="ts">
  // Up and down arrows in a content pane's header: the previous and next item in the report's
  // list, so you can move through it with the list collapsed (or press K and J). A null handler
  // disables its arrow.
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Button } from '$lib/components/ui/button';
  import Hint from './Hint.svelte';

  let { onprev, onnext, noun }: { onprev: (() => void) | null; onnext: (() => void) | null; noun: string } = $props();
</script>

<div class="flex shrink-0 items-center">
  <Hint text="Previous {noun}" kbd="K" side="bottom">
    {#snippet children(tip)}<Button {...tip} size="icon-sm" variant="ghost" disabled={!onprev} aria-label="Previous {noun}" onclick={() => onprev?.()}><ChevronUp /></Button>{/snippet}
  </Hint>
  <Hint text="Next {noun}" kbd="J" side="bottom">
    {#snippet children(tip)}<Button {...tip} size="icon-sm" variant="ghost" disabled={!onnext} aria-label="Next {noun}" onclick={() => onnext?.()}><ChevronDown /></Button>{/snippet}
  </Hint>
</div>
