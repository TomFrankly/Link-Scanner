<script lang="ts">
  // The lightbox for a Wayback Machine copy: the archived page itself, live in a frame, so you can
  // check it shows what the old link did (say, a photo and its license) before pasting it anywhere.
  // It loads straight from web.archive.org in your browser, so it costs the app nothing. Opened by
  // `ui.archivePreview`: from the thumbnail in the link pane (ArchiveThumb) or the toast after a
  // lookup. It's shown with the page's scripts off (see the frame). The `if_` form of the link is
  // the archive's own frame mode: the page without its toolbar.
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Loader from '@lucide/svelte/icons/loader-circle';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { ui, waybackDate, waybackParts } from '$lib/store.svelte';

  const parts = $derived(ui.archivePreview ? waybackParts(ui.archivePreview) : null);
  const frameUrl = $derived(parts ? `https://web.archive.org/web/${parts.timestamp}if_/${parts.original}` : null);
  let loaded = $state(false);
  $effect(() => {
    void frameUrl;
    loaded = false;
  });
</script>

<Dialog.Root open={!!ui.archivePreview} onOpenChange={(o) => !o && (ui.archivePreview = null)}>
  <Dialog.Content class="flex h-[min(56rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl" onOpenAutoFocus={(e) => e.preventDefault()}>
    <Dialog.Header class="flex-row items-center gap-3 px-4 py-3 pr-12">
      <div class="min-w-0 flex-1">
        <Dialog.Title class="text-base">Wayback Machine copy{parts ? ` from ${waybackDate(parts.timestamp)}` : ''}</Dialog.Title>
        <Dialog.Description class="truncate text-xs"><span class="font-mono">{parts?.original ?? ''}</span> · Shown without its scripts, so some parts may be missing</Dialog.Description>
      </div>
      {#if ui.archivePreview}
        <Button size="sm" variant="outline" href={ui.archivePreview} target="_blank" rel="noreferrer" aria-label="Open in a new tab"><ExternalLink /><span class="hidden sm:inline">Open in a new tab</span></Button>
      {/if}
    </Dialog.Header>
    <div class="bg-muted/40 relative min-h-0 flex-1">
      {#if frameUrl}
        {#key frameUrl}
          <!-- Sandboxed with no scripts: many sites (Flickr among them) refuse to show inside a frame
               using a script, and a page without its scripts still shows its text, like a license. -->
          <iframe title="Archived page" src={frameUrl} sandbox="allow-same-origin" referrerpolicy="no-referrer" class="size-full bg-white" onload={() => (loaded = true)}></iframe>
        {/key}
      {/if}
      {#if !loaded}
        <div class="text-muted-foreground bg-background/80 absolute inset-0 flex items-center justify-center gap-2 text-sm">
          <Loader class="size-4 motion-safe:animate-spin" /> Loading the archived page…
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
