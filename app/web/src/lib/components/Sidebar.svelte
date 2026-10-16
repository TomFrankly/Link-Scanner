<script lang="ts">
  // The app's left sidebar: logo, workspace switcher (only with more than one workspace), the
  // pages, Help, and the account menu with the theme picker and sign-out. It collapses to an icon
  // rail; `layout.sidebar` remembers the choice, and 'auto' (the default) is a rail in windows
  // narrower than 1100px, e.g. with YouTube Studio beside it. Resting on the rail for half a
  // second flies the full sidebar out over the page (nothing underneath moves) until the pointer
  // leaves, and shrinks back the same way. The toggle sits in the logo's row, so collapsing or
  // expanding shifts nothing.
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
  // Every item keeps one layout at both widths (icon in a fixed spot, label after it), so
  // collapsing just clips the labels as the sidebar narrows, and nothing jumps.
  const item = (on = false) =>
    `flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
      on ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
    }`;
  const label = $derived(`truncate transition-opacity duration-200 ${full ? 'opacity-100' : 'opacity-0'}`);
</script>

<!-- The outer box holds the rail's (or full sidebar's) place in the layout; the inner one is what
     widens, over the page, when it flies out. -->
<div class="relative h-full shrink-0 {rail ? 'w-12' : 'w-52'}">
<aside
  class="bg-sidebar absolute inset-y-0 left-0 z-40 flex flex-col gap-1 overflow-hidden border-r px-2 py-2 transition-[width,box-shadow] duration-200 ease-out {full
    ? 'w-52'
    : 'w-12'} {flying ? 'shadow-xl' : ''}"
  aria-label="App"
  onpointerenter={enter}
  onpointerleave={leave}
>
  <div class="group/logo relative mb-1 flex h-9 w-full shrink-0 items-center gap-1.5">
    <a href="#/report" class="relative flex min-w-0 items-center gap-1.5 font-semibold whitespace-nowrap" tabindex={rail && !flying ? -1 : undefined}>
      <span class="flex size-8 shrink-0 items-center justify-center"><img src={brand.logo} alt={brand.name || 'Link Checker'} class="size-7 rounded-md transition-opacity duration-150 {rail && !flying ? 'group-hover/logo:opacity-0 group-focus-within/logo:opacity-0' : ''}" /></span>
      <span class={label}>Link Checker</span>
    </a>
    {#if rail && !flying}
      <!-- The rail's logo turns into the expand button on hover, so the button takes no row of its own. -->
      <button
        class="text-muted-foreground absolute top-0.5 left-0 flex size-8 items-center justify-center rounded-md opacity-0 transition-opacity duration-150 outline-none group-hover/logo:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label="Expand sidebar"
        title="Expand sidebar"
        onclick={() => (layout.sidebar.value = 'open')}><PanelLeftOpen class="size-4" /></button
      >
    {/if}
    <button
      class="{item()} ml-auto !w-8 !justify-center !px-0 {label}"
      tabindex={full ? undefined : -1}
      aria-label={rail ? 'Keep the sidebar open' : 'Collapse sidebar'}
      title={rail ? 'Keep the sidebar open' : 'Collapse sidebar'}
      onclick={() => (layout.sidebar.value = rail ? 'open' : 'rail')}
    >
      {#if rail}<PanelLeftOpen class="size-4" />{:else}<PanelLeftClose class="size-4" />{/if}
    </button>
  </div>

  {#if me.workspaces.length > 1}
    <DropdownMenu.Root onOpenChange={menuChange}>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <button {...props} class="{item()} mb-1 !gap-1.5 !px-1" title={!full ? (current?.name ?? 'Workspace') : undefined} aria-label="Workspace: {current?.name ?? 'none'}">
            <span class="bg-muted text-foreground flex size-6 shrink-0 items-center justify-center rounded text-xs font-semibold uppercase">{current?.name[0] ?? '?'}</span>
            <span class="{label} min-w-0 flex-1 text-left">{current?.name ?? 'Workspace'}</span>
            <ChevronsUpDown class="size-3.5 shrink-0 {label}" />
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

  <nav class="flex w-full flex-col gap-0.5">
    {#each nav as [key, text, Icon] (key)}
      <a
        href="#/{key}"
        class={item(app.route === key)}
        aria-current={app.route === key ? 'page' : undefined}
        title={full ? undefined : text}
        onclick={() => go(key)}><Icon class="size-4 shrink-0" /><span class={label}>{text}</span></a
      >
    {/each}
  </nav>

  <div class="flex-1"></div>

  <button class={item()} title={full ? undefined : 'Help'} onclick={() => ((flying = false), (ui.help = true))}>
    <CircleHelp class="size-4 shrink-0" /><span class={label}>Help</span>
  </button>
  <DropdownMenu.Root onOpenChange={menuChange}>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <!-- The email shows only inside the menu, never on screen. -->
        <button {...props} class="{item()} !gap-1.5 !px-1" aria-label="Account and settings" title={full ? undefined : 'Account and settings'}>
          <span class="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase">{me.email[0]}</span>
          <span class={label}>Account</span>
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
