<script lang="ts">
  // Offers the optional Studio tab extension (app/extension): what it does, exactly what it can
  // access, a download built for this site (extensionZip.ts), install steps, and a link to its
  // code. Opened by `ui.studioTab`, from the Help menu or the button beside "Copy & open Studio".
  import Download from '@lucide/svelte/icons/download';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { brand } from '$lib/brand';
  import { ui } from '$lib/store.svelte';
  import { hasStudioTab } from '$lib/studio';
  import { extensionFiles, zip } from '$lib/extensionZip';
  import GitHubMark from './GitHubMark.svelte';

  let installed = $state(false);
  $effect(() => {
    if (ui.studioTab) installed = hasStudioTab();
  });
  const name = brand.name || 'Link Checker';
  const code = `${brand.repo.replace(/\/$/, '')}/tree/main/app/extension`;

  function download() {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zip('link-checker-studio-tab', extensionFiles(name)));
    link.download = 'link-checker-studio-tab.zip';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  const ACCESS = [
    ['This site only', 'It runs a tiny script on this Link Checker site, which tells the app it’s installed and passes on “open this Studio link”. Your browser will describe this as reading and changing your data on this site.'],
    ['One tab', 'It opens one tab and later changes that tab’s address, only ever to a YouTube Studio video page, and only when you click a Studio button in this app. Studio links elsewhere and Studio tabs you open yourself are left alone. It can’t see your other tabs or read any page.'],
    ['Nothing else', 'It remembers that tab until you close the browser. It makes no network requests and sends nothing anywhere.'],
  ];
</script>

<Dialog.Root bind:open={ui.studioTab}>
  <Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Reuse one Studio tab</Dialog.Title>
      <Dialog.Description>
        YouTube Studio doesn’t let other websites reuse its tabs, so each Studio link opens a new one. This small, optional browser extension sends every
        Studio link to the same tab instead, handy with Studio side by side in a split view.
      </Dialog.Description>
    </Dialog.Header>

    <div class="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6 text-sm">
      {#if installed}
        <div class="flex items-center gap-2 rounded-md border px-3 py-2"><CircleCheck class="size-4 text-[#0a7d0a] dark:text-[#4fd14f]" /> Installed and working on this page.</div>
      {/if}

      <section>
        <h3 class="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">What it can access</h3>
        <dl class="space-y-2">
          {#each ACCESS as [title, text] (title)}
            <div>
              <dt class="font-medium">{title}</dt>
              <dd class="text-muted-foreground">{text}</dd>
            </div>
          {/each}
        </dl>
      </section>

      <section>
        <h3 class="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Install (Chrome, Arc, Edge, Brave)</h3>
        <ol class="text-muted-foreground list-decimal space-y-1.5 pl-5">
          <li><span class="text-foreground">Download it</span>, made for this site’s address, and unzip it.</li>
          <li>Open <code class="text-foreground text-xs">chrome://extensions</code> (paste it in the address bar) and turn on <span class="text-foreground">Developer mode</span>.</li>
          <li>Click <span class="text-foreground">Load unpacked</span> and choose the unzipped <code class="text-foreground text-xs">link-checker-studio-tab</code> folder.</li>
          <li>Reload this page. Keep the folder: the browser loads the extension from it.</li>
        </ol>
        <p class="text-muted-foreground mt-2 text-xs">Safari and Firefox aren’t supported; there, Studio links keep opening a new tab.</p>
      </section>

      <a href={code} target="_blank" rel="noreferrer" class="hover:bg-muted/60 flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150">
        <span class="bg-foreground text-background flex size-8 shrink-0 items-center justify-center rounded-md"><GitHubMark class="size-4" /></span>
        <span class="min-w-0 flex-1">
          <span class="block font-medium">Read its code on GitHub</span>
          <span class="text-muted-foreground block text-xs">About 60 lines across two small files.</span>
        </span>
      </a>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (ui.studioTab = false)}>Close</Button>
      <Button onclick={download}><Download /> Download</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
