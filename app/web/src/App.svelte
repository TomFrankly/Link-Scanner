<script lang="ts">
  // The app shell: top bar, scan banner, the current page and the Help button. On mount it
  // calls boot() (store.svelte.ts), which loads the signed-in user and their workspace's
  // report; pages read everything from the `app` store, so this file only picks which to show.
  // The admin page works without a workspace; every other page needs one and its report.
  import { onMount } from 'svelte';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from '$lib/components/ui/sonner';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import TopBar from '$lib/components/TopBar.svelte';
  import HelpButton from '$lib/components/help/HelpButton.svelte';
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
  <TopBar />
  {#if app.route === 'admin' && app.me.isAdmin}
    <main class="mx-auto max-w-6xl px-4 py-6 sm:px-6"><Admin /></main>
  {:else if !hasWorkspace}
    <NoAccess />
  {:else}
    <ScanBanner />
    <main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {#if !app.report}
        <div class="text-muted-foreground py-24 text-center text-sm">Loading report…</div>
      {:else if app.route === 'exceptions'}
        <Exceptions />
      {:else if app.route === 'channels'}
        <Channels />
      {:else if app.route === 'members'}
        <Members />
      {:else}
        <Report />
      {/if}
    </main>
  {/if}
  <HelpButton />
{/if}
</Tooltip.Provider>
