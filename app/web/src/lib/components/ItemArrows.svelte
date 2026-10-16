<script lang="ts">
  // Up and down arrows in a content pane's header: the previous and next item in the report's
  // list, so you can move through it with the list collapsed. A null handler disables its arrow.
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Button } from '$lib/components/ui/button';

  let { onprev, onnext, noun }: { onprev: (() => void) | null; onnext: (() => void) | null; noun: string } = $props();
</script>

<div class="flex shrink-0 items-center">
  <Button size="icon-sm" variant="ghost" disabled={!onprev} aria-label="Previous {noun}" title="Previous {noun}" onclick={() => onprev?.()}><ChevronUp /></Button>
  <Button size="icon-sm" variant="ghost" disabled={!onnext} aria-label="Next {noun}" title="Next {noun}" onclick={() => onnext?.()}><ChevronDown /></Button>
</div>
