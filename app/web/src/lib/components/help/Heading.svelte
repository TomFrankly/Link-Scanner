<script lang="ts">
  // A section heading on a Help page.
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<h3 class="mb-2 flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight">{@render children()}</h3>
