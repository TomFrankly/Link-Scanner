<script lang="ts">
  // The app's left sidebar: logo, workspace switcher (only with more than one workspace), the
  // pages, Help, and the account menu with the theme picker and sign-out. It collapses to an icon
  // rail with the toggle at the top; `layout.sidebar` remembers the choice, and 'auto' (the
  // default) is a rail in windows narrower than 1100px, e.g. with YouTube Studio beside it.
  // Reads the user, workspace and route from the `app` store.
  import { MediaQuery } from 'svelte/reactivity';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import LogOut from '@lucide/svelte/icons/log-out';
  import Check from '@lucide/svelte/icons/check';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Monitor from '@lucide/svelte/icons/monitor';
  import ChartColumn from '@lucide/svelte/icons/chart-column';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Tv from '@lucide/svelte/icons/tv';
  import Users from '@lucide/svelte/icons/users';
  import Wrench from '@lucide/svelte/icons/wrench';
  import CircleHelp from '@lucide/svelte/icons/circle-question-mark';
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
  import { setMode, userPrefersMode } from 'mode-watcher';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { app, go, layout, switchWorkspace, ui, type Route } from '$lib/store.svelte';
  import { brand } from '$lib/brand';

  const me = $derived(app.me!);
  const current = $derived(me.workspaces.find((w) => w.id === app.wsId));
  const wide = new MediaQuery('min-width: 1100px');
  const rail = $derived(layout.sidebar.value === 'rail' || (layout.sidebar.value === 'auto' && !wide.current));
  // Page links; without a workspace only Admin is left (for admins).
  const nav = $derived(
    [
      ['report', 'Report', ChartColumn],
      ['exceptions', 'Exceptions', ShieldCheck],
      ['channels', 'Channels', Tv],
      ['members', 'Members', Users],
      ...(me.isAdmin ? [['admin', 'Admin', Wrench]] : []),
    ].filter(([k]) => me.workspaces.length || k === 'admin') as [Route, string, typeof Tv][],
  );
  const item = (on = false) =>
    `flex h-8 items-center gap-2.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
      rail ? 'w-8 justify-center' : 'w-full px-2'
    } ${on ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`;
</script>

<aside class="bg-sidebar flex h-full shrink-0 flex-col gap-1 border-r py-2 {rail ? 'w-12 items-center' : 'w-52 px-2'}" aria-label="App">
  <div class="mb-1 flex h-9 items-center gap-2 {rail ? 'flex-col justify-center' : 'px-1'}">
    <a href="#/report" class="flex min-w-0 items-center gap-2 font-semibold" title={rail ? 'Link Checker' : undefined}>
      <img src={brand.logo} alt={brand.name || 'Link Checker'} class="size-7 shrink-0 rounded-md" />
      {#if !rail}<span class="truncate">Link Checker</span>{/if}
    </a>
    {#if !rail}
      <button class="{item()} ml-auto !w-8 !justify-center !px-0" aria-label="Collapse sidebar" title="Collapse sidebar" onclick={() => (layout.sidebar.value = 'rail')}>
        <PanelLeftClose class="size-4" />
      </button>
    {/if}
  </div>
  {#if rail}
    <button class={item()} aria-label="Expand sidebar" title="Expand sidebar" onclick={() => (layout.sidebar.value = 'open')}>
      <PanelLeftOpen class="size-4" />
    </button>
  {/if}

  {#if me.workspaces.length > 1}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            class="{rail ? item() : 'border-input bg-background hover:bg-muted/60 flex h-8 w-full items-center gap-2 rounded-md border px-2 text-sm transition-colors duration-150'} mb-1"
            title={rail ? (current?.name ?? 'Workspace') : undefined}
            aria-label="Workspace: {current?.name ?? 'none'}"
          >
            {#if rail}
              <span class="bg-muted flex size-6 items-center justify-center rounded text-xs font-semibold uppercase">{current?.name[0] ?? '?'}</span>
            {:else}
              <span class="min-w-0 flex-1 truncate text-left">{current?.name ?? 'Workspace'}</span>
              <ChevronsUpDown class="text-muted-foreground size-3.5 shrink-0" />
            {/if}
          </button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" side={rail ? 'right' : 'bottom'} class="w-64">
        <DropdownMenu.Label>Workspaces</DropdownMenu.Label>
        {#each me.workspaces as w (w.id)}
          <DropdownMenu.Item onSelect={() => switchWorkspace(w.id)}>
            <span class="flex-1 truncate">{w.name}</span>
            {#if w.role === 'owner'}<span class="text-muted-foreground text-xs">Owner</span>{/if}
            {#if w.id === app.wsId}<Check />{/if}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}

  <nav class="flex flex-col gap-0.5 {rail ? 'items-center' : ''}">
    {#each nav as [key, label, Icon] (key)}
      <a
        href="#/{key}"
        class={item(app.route === key)}
        aria-current={app.route === key ? 'page' : undefined}
        aria-label={rail ? label : undefined}
        title={rail ? label : undefined}
        onclick={() => go(key)}><Icon class="size-4 shrink-0" />{#if !rail}{label}{/if}</a
      >
    {/each}
  </nav>

  <div class="flex-1"></div>

  <button class={item()} aria-label={rail ? 'Help' : undefined} title={rail ? 'Help' : undefined} onclick={() => (ui.help = true)}>
    <CircleHelp class="size-4 shrink-0" />{#if !rail}Help{/if}
  </button>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <!-- The email shows only inside the menu, never on screen. -->
        <button {...props} class={item()} aria-label="Account and settings" title={rail ? 'Account and settings' : undefined}>
          <span class="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase">{me.email[0]}</span>
          {#if !rail}Account{/if}
        </button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" side={rail ? 'right' : 'top'} class="w-56">
      <DropdownMenu.Label class="truncate font-normal">
        <div class="text-foreground truncate text-sm font-medium">{me.email}</div>
        <div class="text-muted-foreground text-xs">{me.isAdmin ? 'Admin' : current?.role === 'owner' ? 'Workspace owner' : 'Member'}</div>
      </DropdownMenu.Label>
      <DropdownMenu.Separator />
      <div class="flex items-center justify-between gap-2 px-2 py-1.5">
        <span class="text-sm">Theme</span>
        <div class="bg-muted inline-flex rounded-md p-0.5" role="radiogroup" aria-label="Theme">
          {#each [['light', Sun, 'Light'], ['dark', Moon, 'Dark'], ['system', Monitor, 'Match system']] as const as [value, Icon, label] (value)}
            <button
              role="radio"
              aria-checked={userPrefersMode.current === value}
              aria-label={label}
              title={label}
              class="flex size-6 items-center justify-center rounded-[5px] transition-colors duration-150 {userPrefersMode.current === value
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => setMode(value)}
            >
              <Icon class="size-3.5" />
            </button>
          {/each}
        </div>
      </div>
      <DropdownMenu.Separator />
      <!-- Cloudflare Access handles sign-in, so signing out goes through its logout URL. -->
      <DropdownMenu.Item onSelect={() => (location.href = '/cdn-cgi/access/logout')}>
        <LogOut /> Sign out
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</aside>
