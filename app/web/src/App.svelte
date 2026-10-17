<script lang="ts">
  // The app shell: one window-high screen that never scrolls as a whole. The sidebar sits on the
  // left; the scan banner and the current page fill the rest. The Report page splits itself into
  // panes that scroll on their own; the other pages scroll inside their own area. On mount it
  // calls boot() (store.svelte.ts), which loads the signed-in user and their workspace's report;
  // pages read everything from the `app` store, so this file only picks which to show.
  // The admin page works without a workspace; every other page needs one and its report.
  import { onMount } from 'svelte';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from '$lib/components/ui/sonner';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import HelpDialog from '$lib/components/help/HelpDialog.svelte';
  import ArchivePreview from '$lib/components/ArchivePreview.svelte';
  import ScanBanner from '$lib/components/ScanBanner.svelte';
  import NoAccess from '$lib/pages/NoAccess.svelte';
  import Report from '$lib/pages/Report.svelte';
  import Exceptions from '$lib/pages/Exceptions.svelte';
  import Channels from '$lib/pages/Channels.svelte';
  import Members from '$lib/pages/Members.svelte';
  import Admin from '$lib/pages/Admin.svelte';
  import { app, boot } from '$lib/store.svelte';

  onMount(boot);
  const hasWorkspace = $derived(!!app.me?.workspaces.length);
</script>

<ModeWatcher defaultMode="system" />
<Toaster position="bottom-center" />
<!-- Shared hover delay for every tooltip in the app (Hint.svelte, StatusBadge). -->
<Tooltip.Provider delayDuration={300}>

{#if app.bootError}
  <div class="mx-auto max-w-md px-4 py-24 text-center">
    <h1 class="text-lg font-semibold">Couldn't load Link Checker</h1>
    <p class="text-muted-foreground mt-2 text-sm">{app.bootError}</p>
  </div>
{:else if !app.me}
  <div class="text-muted-foreground py-24 text-center text-sm">Loading…</div>
{:else}
  <div class="flex h-dvh overflow-hidden">
    <Sidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      {#if app.route === 'admin' && app.me.isAdmin}
        <main class="min-h-0 flex-1 overflow-y-auto"><div class="mx-auto max-w-6xl px-4 py-8 sm:px-8"><Admin /></div></main>
      {:else if !hasWorkspace}
        <main class="min-h-0 flex-1 overflow-y-auto"><NoAccess /></main>
      {:else}
        <ScanBanner />
        {#if !app.report}
          <div class="text-muted-foreground py-24 text-center text-sm">Loading report…</div>
        {:else if app.route === 'exceptions' || app.route === 'channels' || app.route === 'members'}
          <main class="min-h-0 flex-1 overflow-y-auto">
            <div class="mx-auto max-w-5xl px-4 py-8 sm:px-8">
              {#if app.route === 'exceptions'}<Exceptions />{:else if app.route === 'channels'}<Channels />{:else}<Members />{/if}
            </div>
          </main>
        {:else}
          <main class="min-h-0 flex-1"><Report /></main>
        {/if}
      {/if}
    </div>
  </div>
  <HelpDialog />
  <ArchivePreview />
{/if}
</Tooltip.Provider>
