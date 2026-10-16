<script lang="ts">
  // One-line summary of each planned fix for a link, with a way to change it. Shown under a
  // link wherever it's listed; renders nothing when the link has no plan. A fix limited to one
  // channel names that channel. Reads `data.fixes`; clicking opens FixLinkDialog through
  // `ui.fixLinkUrl` and `ui.fixLinkChannel`. A replacement has an open-link icon beside it, to
  // check the new link works before pasting it anywhere.
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Replace from '@lucide/svelte/icons/replace';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { data, ui } from '$lib/store.svelte';
  import Hint from './Hint.svelte';

  let { url }: { url: string } = $props();
  const fixes = $derived(data.fixes.all(url));
</script>

{#each fixes as fix (fix.channelId)}
  <span class="mt-1.5 mr-1 inline-flex max-w-full items-start gap-0.5 align-top">
    <Hint text="Change planned fix">
      {#snippet children(tip)}
        <button
          {...tip}
          type="button"
          class="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 rounded-md border border-dashed px-1.5 py-0.5 text-left text-xs transition-colors duration-150 hover:border-solid"
          onclick={() => ((ui.fixLinkChannel = fix.channelId), (ui.fixLinkUrl = url))}
        >
          {#if fix.action === 'replace'}
            <Replace class="size-3 shrink-0 text-[#0a7d0a] dark:text-[#4fd14f]" />
            <span class="text-muted-foreground shrink-0">Replace with</span>
            <span class="min-w-0 truncate font-mono">{fix.replacement}</span>
          {:else}
            <Trash class="size-3 shrink-0 text-[#b42d2d] dark:text-[#f07070]" />
            <span class="text-muted-foreground">Remove from descriptions</span>
          {/if}
          {#if fix.channelId}<span class="text-muted-foreground w-full pl-[18px]">{data.channelTitle[fix.channelId] ?? 'One channel'} only</span>{/if}
        </button>
      {/snippet}
    </Hint>
    {#if fix.action === 'replace' && fix.replacement}
      <Hint text="Open the new link to check it">
        {#snippet children(tip)}
          <a
            {...tip}
            href={fix.replacement}
            target="_blank"
            rel="noreferrer"
            class="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150"
            aria-label="Open {fix.replacement}"><ExternalLink class="size-3.5" /></a
          >
        {/snippet}
      </Hint>
    {/if}
  </span>
{/each}
