<script lang="ts">
  // The title and one-line explanation at the top of a settings-style page.
  import type { Snippet } from 'svelte';
  let { title, children }: { title: string; children?: Snippet } = $props();
</script>

<header class="pb-1">
  <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
  {#if children}<p class="text-muted-foreground mt-1 text-sm">{@render children()}</p>{/if}
</header>
