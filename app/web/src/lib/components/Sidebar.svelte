<script lang="ts">
  // The app's left sidebar: logo, workspace switcher (only with more than one workspace), the
  // pages, Help, and the account menu with the theme picker and sign-out. It collapses to an icon
  // rail; `layout.sidebar` remembers the choice, and 'auto' (the default) is a rail in windows
  // narrower than 1100px, e.g. with YouTube Studio beside it. Resting on the rail for half a
  // second flies the full sidebar out over the page (nothing underneath moves) until the pointer
  // leaves. The toggle sits in the logo's row, so collapsing or expanding shifts nothing.
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

  // ---- flying out over the page from the rail ----
  const FLY_DELAY = 500;
  let flying = $state(false);
  let hovering = false;
  let menusOpen = $state(0); // open menus (they render outside the sidebar, so leaving it mustn't close them)
  let timer: ReturnType<typeof setTimeout> | undefined;
  const full = $derived(!rail || flying);
  function enter() {
    hovering = true;
    if (!rail || flying) return;
    clearTimeout(timer);
    timer = setTimeout(() => (flying = true), FLY_DELAY);
  }
  function leave() {
    hovering = false;
    clearTimeout(timer);
    if (!menusOpen) flying = false;
  }
  function menuChange(open: boolean) {
    menusOpen += open ? 1 : -1;
    if (!open && !menusOpen && !hovering) flying = false;
  }
  // Collapsing or expanding by hand ends a fly-out.
  $effect(() => {
    void rail;
    flying = false;
  });
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
      full ? 'w-full px-2' : 'w-8 justify-center'
    } ${on ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`;
</script>

<!-- The outer box holds the rail's (or full sidebar's) place in the layout; the inner one is what
     widens, over the page, when it flies out. -->
<div class="relative h-full shrink-0 {rail ? 'w-12' : 'w-52'}">
<aside
  class="bg-sidebar absolute inset-y-0 left-0 z-40 flex flex-col gap-1 overflow-hidden border-r py-2 transition-[width,box-shadow] duration-150 {full
    ? 'w-52 px-2'
    : 'w-12 items-center'} {flying ? 'shadow-xl' : ''}"
  aria-label="App"
  onpointerenter={enter}
  onpointerleave={leave}
>
  <div class="group/logo mb-1 flex h-9 w-full items-center gap-2 {full ? 'px-1' : 'justify-center'}">
    {#if rail && !flying}
      <!-- The rail's logo turns into the expand button on hover, so the button takes no row of its own. -->
      <button class="relative flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="Expand sidebar" title="Expand sidebar" onclick={() => (layout.sidebar.value = 'open')}>
        <img src={brand.logo} alt="" class="size-7 rounded-md transition-opacity duration-150 group-hover/logo:opacity-0 group-focus-within/logo:opacity-0" />
        <PanelLeftOpen class="text-muted-foreground absolute size-4 opacity-0 transition-opacity duration-150 group-hover/logo:opacity-100 group-focus-within/logo:opacity-100" />
      </button>
    {:else}
      <a href="#/report" class="flex min-w-0 items-center gap-2 font-semibold">
        <img src={brand.logo} alt={brand.name || 'Link Checker'} class="size-7 shrink-0 rounded-md" />
        <span class="truncate">Link Checker</span>
      </a>
      {#if rail}
        <button class="{item()} ml-auto !w-8 !justify-center !px-0" aria-label="Keep the sidebar open" title="Keep the sidebar open" onclick={() => (layout.sidebar.value = 'open')}>
          <PanelLeftOpen class="size-4" />
        </button>
      {:else}
        <button class="{item()} ml-auto !w-8 !justify-center !px-0" aria-label="Collapse sidebar" title="Collapse sidebar" onclick={() => (layout.sidebar.value = 'rail')}>
          <PanelLeftClose class="size-4" />
        </button>
      {/if}
    {/if}
  </div>

  {#if me.workspaces.length > 1}
    <DropdownMenu.Root onOpenChange={menuChange}>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            class="{!full ? item() : 'border-input bg-background hover:bg-muted/60 flex h-8 w-full items-center gap-2 rounded-md border px-2 text-sm transition-colors duration-150'} mb-1"
            title={!full ? (current?.name ?? 'Workspace') : undefined}
            aria-label="Workspace: {current?.name ?? 'none'}"
          >
            {#if !full}
              <span class="bg-muted flex size-6 items-center justify-center rounded text-xs font-semibold uppercase">{current?.name[0] ?? '?'}</span>
            {:else}
              <span class="min-w-0 flex-1 truncate text-left">{current?.name ?? 'Workspace'}</span>
              <ChevronsUpDown class="text-muted-foreground size-3.5 shrink-0" />
            {/if}
          </button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" side="bottom" class="w-64">
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

  <nav class="flex w-full flex-col gap-0.5 {full ? '' : 'items-center'}">
    {#each nav as [key, label, Icon] (key)}
      <a
        href="#/{key}"
        class={item(app.route === key)}
        aria-current={app.route === key ? 'page' : undefined}
        aria-label={full ? undefined : label}
        title={full ? undefined : label}
        onclick={() => go(key)}><Icon class="size-4 shrink-0" />{#if full}{label}{/if}</a
      >
    {/each}
  </nav>

  <div class="flex-1"></div>

  <button class={item()} aria-label={full ? undefined : 'Help'} title={full ? undefined : 'Help'} onclick={() => ((flying = false), (ui.help = true))}>
    <CircleHelp class="size-4 shrink-0" />{#if full}Help{/if}
  </button>
  <DropdownMenu.Root onOpenChange={menuChange}>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <!-- The email shows only inside the menu, never on screen. -->
        <button {...props} class={item()} aria-label="Account and settings" title={full ? undefined : 'Account and settings'}>
          <span class="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase">{me.email[0]}</span>
          {#if full}Account{/if}
        </button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" side={full ? 'top' : 'right'} class="w-56">
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
</div>
