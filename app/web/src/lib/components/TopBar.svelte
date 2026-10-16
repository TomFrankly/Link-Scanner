<script lang="ts">
  // The sticky bar at the top of every page: logo, workspace switcher (only with more than
  // one workspace), page links (a single menu on phones), and the account menu with the theme
  // picker and sign-out. Reads the user, workspace and route from the `app` store.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import LogOut from '@lucide/svelte/icons/log-out';
  import Check from '@lucide/svelte/icons/check';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Monitor from '@lucide/svelte/icons/monitor';
  import { setMode, userPrefersMode } from 'mode-watcher';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { app, go, switchWorkspace, type Route } from '$lib/store.svelte';
  import { brand } from '$lib/brand';

  const me = $derived(app.me!);
  const current = $derived(me.workspaces.find((w) => w.id === app.wsId));
  // Page links; without a workspace only Admin is left (for admins).
  const nav = $derived(
    [
      ['report', 'Report'],
      ['exceptions', 'Exceptions'],
      ['channels', 'Channels'],
      ['members', 'Members'],
      ...(me.isAdmin ? [['admin', 'Admin']] : []),
    ].filter(([k]) => me.workspaces.length || k === 'admin') as [Route, string][],
  );
</script>

<header class="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
  <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
    <a href="#/report" class="flex items-center gap-2 font-semibold">
      <img src={brand.logo} alt={brand.name || 'Link Checker'} class="size-7 rounded-md" />
      <span class="hidden sm:inline">Link Checker</span>
    </a>

    {#if me.workspaces.length > 1}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="sm" class="max-w-36 sm:max-w-48">
              <span class="truncate">{current?.name ?? 'Workspace'}</span>
              <ChevronDown class="text-muted-foreground" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="w-64">
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

    <!-- Phones: the pages fold into one menu that names the current page. -->
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" size="sm" class="sm:hidden">
            {nav.find(([k]) => k === app.route)?.[1] ?? 'Report'}
            <ChevronDown class="text-muted-foreground" />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" class="w-44">
        {#each nav as [key, label] (key)}
          <DropdownMenu.Item onSelect={() => go(key)}>
            <span class="flex-1">{label}</span>
            {#if app.route === key}<Check />{/if}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    <nav class="hidden items-center gap-0.5 sm:flex">
      {#each nav as [key, label] (key)}
        <a
          href="#/{key}"
          class="rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 {app.route === key
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}"
          aria-current={app.route === key ? 'page' : undefined}
          onclick={() => go(key)}>{label}</a
        >
      {/each}
    </nav>

    <div class="ml-auto">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              aria-label="Account and settings"
              class="bg-primary text-primary-foreground ring-offset-background focus-visible:ring-ring flex size-8 items-center justify-center rounded-full text-sm font-semibold uppercase transition-opacity duration-150 outline-none hover:opacity-85 focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              {me.email[0]}
            </button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-56">
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
    </div>
  </div>
</header>
