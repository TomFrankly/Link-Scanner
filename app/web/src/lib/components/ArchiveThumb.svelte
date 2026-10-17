<script lang="ts">
  // A small live preview of a Wayback Machine copy, shown in the link pane when its planned fix
  // is one. It's the archived page itself in a frame, drawn at desktop width and scaled down, so
  // it needs no screenshot service. Clicking it opens the lightbox (ArchivePreview).
  import Loader from '@lucide/svelte/icons/loader-circle';
  import Maximize from '@lucide/svelte/icons/maximize-2';
  import { ui, waybackDate, waybackParts } from '$lib/store.svelte';

  let { url }: { url: string } = $props();
  const parts = $derived(waybackParts(url));
  const frameUrl = $derived(parts ? `https://web.archive.org/web/${parts.timestamp}if_/${parts.original}` : null);
  // The page is laid out at 1280×800 and shown at a quarter of that.
  const W = 1280;
  const SCALE = 0.25;
  let loaded = $state(false);
</script>

{#if parts && frameUrl}
  <button
    type="button"
    class="group focus-visible:ring-ring/50 mt-3 block w-80 max-w-full overflow-hidden rounded-lg border text-left outline-none focus-visible:ring-2"
    onclick={() => (ui.archivePreview = url)}
    aria-label="Preview the archived page"
  >
    <div class="bg-muted/40 relative aspect-[16/10] overflow-hidden">
      {#key frameUrl}
        <iframe
          title="Archived page preview"
          src={frameUrl}
          loading="lazy"
          tabindex="-1"
          sandbox="allow-same-origin"
          referrerpolicy="no-referrer"
          class="pointer-events-none absolute top-0 left-0 origin-top-left bg-white"
          style="width: {W}px; height: {W / 1.6}px; transform: scale({SCALE});"
          onload={() => (loaded = true)}
        ></iframe>
      {/key}
      {#if !loaded}
        <div class="text-muted-foreground absolute inset-0 flex items-center justify-center"><Loader class="size-4 motion-safe:animate-spin" /></div>
      {/if}
      <div class="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-150 group-hover:bg-black/25">
        <Maximize class="size-5 text-white opacity-0 drop-shadow transition-opacity duration-150 group-hover:opacity-100" />
      </div>
    </div>
    <div class="text-muted-foreground px-2.5 py-1.5 text-xs">Wayback Machine copy from {waybackDate(parts.timestamp)}</div>
  </button>
{/if}
