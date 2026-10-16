<script lang="ts">
  // One-line summary of a link's planned fix, with a way to change it.
  import Replace from '@lucide/svelte/icons/replace';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { data, ui } from '$lib/store.svelte';

  let { url }: { url: string } = $props();
  const fix = $derived(data.fixes.get(url));
</script>

{#if fix}
  <button
    type="button"
    class="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed px-1.5 py-0.5 text-left text-xs transition-colors duration-150 hover:border-solid"
    onclick={() => (ui.fixLinkUrl = url)}
    title="Change planned fix"
  >
    {#if fix.action === 'replace'}
      <Replace class="size-3 shrink-0 text-[#0a7d0a] dark:text-[#4fd14f]" />
      <span class="text-muted-foreground shrink-0">Replace with</span>
      <span class="truncate font-mono">{fix.replacement}</span>
    {:else}
      <Trash class="size-3 shrink-0 text-[#b42d2d] dark:text-[#f07070]" />
      <span class="text-muted-foreground">Remove from descriptions</span>
    {/if}
  </button>
{/if}
