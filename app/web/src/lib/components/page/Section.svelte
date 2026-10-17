<script lang="ts" module>
  /** A row in a Section's list: a rounded tile that tints on hover, with no dividers (like the report's lists). */
  export const tile = 'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150 hover:bg-muted/50';
</script>

<script lang="ts">
  // One section of a settings-style page (Channels, Members, Exceptions, Admin). Sections are
  // set apart by space rather than cards or lines: on wide screens the title and explanation sit
  // in a left column beside the content; on narrow ones, above it.
  import type { Snippet } from 'svelte';
  let { title, description, children }: { title: string; description?: string | Snippet; children: Snippet } = $props();
</script>

<section class="grid gap-x-10 gap-y-3 py-7 lg:grid-cols-[15rem_minmax(0,1fr)]">
  <div>
    <h2 class="text-sm font-semibold">{title}</h2>
    {#if description}
      <p class="text-muted-foreground mt-1 text-sm leading-relaxed">
        {#if typeof description === 'string'}{description}{:else}{@render description()}{/if}
      </p>
    {/if}
  </div>
  <div class="min-w-0">{@render children()}</div>
</section>
