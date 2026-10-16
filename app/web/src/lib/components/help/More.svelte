<script lang="ts">
  // A "Learn more" disclosure under a topic on a Help page: closed by default, so the page stays
  // short for people who only want the gist. A native <details>, so it works with the keyboard
  // and in-page search can open it.
  import type { Snippet } from 'svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<details class="group mt-2">
  <summary
    class="text-foreground/80 hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-medium select-none [&::-webkit-details-marker]:hidden"
  >
    <ChevronRight class="size-3.5 transition-transform duration-150 group-open:rotate-90" />
    {label}
  </summary>
  <div class="text-muted-foreground mt-2 space-y-2 border-l-2 pl-4">{@render children()}</div>
</details>
