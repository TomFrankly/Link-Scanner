<script lang="ts">
  // One-line summary of each planned fix for a link, with a way to change it. Shown under a
  // link wherever it's listed; renders nothing when the link has no plan. A fix limited to one
  // channel names that channel. Reads `data.fixes`; clicking opens FixLinkDialog through
  // `ui.fixLinkUrl` and `ui.fixLinkChannel`.
  import Replace from '@lucide/svelte/icons/replace';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { data, ui } from '$lib/store.svelte';

  let { url }: { url: string } = $props();
  const fixes = $derived(data.fixes.all(url));
</script>

{#each fixes as fix (fix.channelId)}
  <button
    type="button"
    class="mt-1.5 mr-1 inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-md border border-dashed px-1.5 py-0.5 text-left text-xs transition-colors duration-150 hover:border-solid"
    onclick={() => ((ui.fixLinkChannel = fix.channelId), (ui.fixLinkUrl = url))}
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
    {#if fix.channelId}<span class="text-muted-foreground w-full pl-[18px]">{data.channelTitle[fix.channelId] ?? 'One channel'} only</span>{/if}
  </button>
{/each}
