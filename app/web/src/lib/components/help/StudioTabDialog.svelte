<script lang="ts">
  // How to keep YouTube Studio in one place beside the app. First Microsoft Edge's Split View,
  // which can open links from the left pane in the right one (nothing to install); then, for
  // other browsers or if that doesn't work, the optional Studio tab extension (app/extension):
  // what it can access, a download built for this site (extensionZip.ts), install steps, and a
  // link to its code. Opened by `ui.studioTab`, from Help or the button beside "Copy & open Studio".
  import Download from '@lucide/svelte/icons/download';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Link2 from '@lucide/svelte/icons/link-2';
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
    ['Studio tabs', 'It can tell which of your tabs are on YouTube Studio, so it can reuse one that’s already open in this window, like the other side of a split view. Otherwise it opens one. It then changes that tab’s address, only ever to a Studio video page, and only when you click a Studio button in this app. Your browser will describe this as reading and changing your data on studio.youtube.com, but it never reads or changes a page, and it can’t see the address of any tab that isn’t on Studio.'],
    ['Nothing else', 'It remembers that tab until you close the browser. It makes no network requests and sends nothing anywhere.'],
  ];
</script>

<Dialog.Root bind:open={ui.studioTab}>
  <!-- No autofocus: the first focusable item is far down, and focusing it would scroll past the Edge steps. -->
  <Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
    <Dialog.Header>
      <Dialog.Title>Reuse one Studio tab</Dialog.Title>
      <Dialog.Description>
        YouTube Studio doesn’t let other websites reuse its tabs, so each Studio link opens a new one. Here are two ways to keep Studio in one place, beside this app.
      </Dialog.Description>
    </Dialog.Header>

    <div class="-mx-6 min-h-0 flex-1 space-y-6 overflow-y-auto px-6 text-sm">
      {#if installed}
        <div class="flex items-center gap-2 rounded-md border px-3 py-2"><CircleCheck class="size-4 text-[#0a7d0a] dark:text-[#4fd14f]" /> The extension is installed and working on this page.</div>
      {/if}

      <section>
        <h3 class="mb-1 flex flex-wrap items-center gap-2 font-medium">
          Microsoft Edge Split View
          <span class="text-muted-foreground rounded-full border px-1.5 text-xs font-normal">Nothing to install</span>
        </h3>
        <p class="text-muted-foreground mb-2">Edge can send links from the left side of a split view to the right side, so Studio always opens in the same pane.</p>
        <ol class="text-muted-foreground list-decimal space-y-1.5 pl-5">
          <li>Open this app in Edge, then open <span class="text-foreground">Split View</span> with this app on the left and YouTube Studio on the right.</li>
          <li>
            Click the <span class="text-foreground">link icon</span>
            <span class="bg-muted text-foreground mx-0.5 inline-flex size-5 items-center justify-center rounded-full align-middle"><Link2 class="size-3" /></span>
            in the address bar, between the two addresses.
          </li>
          <li>Now <span class="text-foreground">Studio</span> and <span class="text-foreground">Copy & open Studio</span> open the video in the right pane, every time.</li>
        </ol>
      </section>

      <section class="border-t pt-5">
        <h3 class="mb-1 font-medium">Other browsers, or if that doesn’t work: the Studio tab extension</h3>
        <p class="text-muted-foreground mb-3">
          A small, optional extension that sends every Studio link from this app to the same tab: a Studio tab already open in this window (such as the
          other side of a split view), or one it opens. Installed an earlier copy? Download it again, replace the folder, and click Reload on the extension.
        </p>

        <h4 class="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Install (Chrome, Arc, Edge, Brave)</h4>
        <ol class="text-muted-foreground list-decimal space-y-1.5 pl-5">
          <li><span class="text-foreground">Download it</span>, made for this site’s address, and unzip it.</li>
          <li>Open <code class="text-foreground text-xs">chrome://extensions</code> (<code class="text-foreground text-xs">edge://extensions</code> in Edge; paste it in the address bar) and turn on <span class="text-foreground">Developer mode</span>.</li>
          <li>Click <span class="text-foreground">Load unpacked</span> and choose the unzipped <code class="text-foreground text-xs">link-checker-studio-tab</code> folder.</li>
          <li>Reload this page. Keep the folder: the browser loads the extension from it.</li>
        </ol>
        <p class="text-muted-foreground mt-2 text-xs">Safari and Firefox aren’t supported; there, Studio links keep opening a new tab.</p>

        <h4 class="text-muted-foreground mt-4 mb-2 text-xs font-medium tracking-wide uppercase">What it can access</h4>
        <dl class="space-y-2">
          {#each ACCESS as [title, text] (title)}
            <div>
              <dt class="font-medium">{title}</dt>
              <dd class="text-muted-foreground">{text}</dd>
            </div>
          {/each}
        </dl>

        <a href={code} target="_blank" rel="noreferrer" class="hover:bg-muted/60 mt-4 flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150">
          <span class="bg-foreground text-background flex size-8 shrink-0 items-center justify-center rounded-md"><GitHubMark class="size-4" /></span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium">Read its code on GitHub</span>
            <span class="text-muted-foreground block text-xs">About 60 lines across two small files.</span>
          </span>
        </a>
      </section>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (ui.studioTab = false)}>Close</Button>
      <Button variant="outline" onclick={download}><Download /> Download extension</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
