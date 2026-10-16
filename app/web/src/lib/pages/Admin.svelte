<script lang="ts">
  // Admin page (#/admin), shown only to app admins. Decides who may create a workspace, shows
  // today's shared YouTube quota, and sets each workspace's daily limits. Unlike the other
  // pages it doesn't use the workspace report: it loads its own overview from /api/admin, and
  // every change returns the updated overview, which replaces the old one.
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import { Input } from '$lib/components/ui/input';
  import { Progress } from '$lib/components/ui/progress';
  import { api } from '$lib/api';

  interface Overview {
    allowedOwners: { email: string; note: string | null; addedAt: string }[];
    ownerDomains: string[];
    workspaces: {
      id: string;
      name: string;
      owner: string;
      dailyFullScans: number;
      dailyRechecks: number;
      maxChannels: number;
      members: number;
      channels: number;
      scansToday: number;
    }[];
    quota: { usedToday: number; limit: number };
  }

  let overview = $state<Overview | null>(null);
  let email = $state('');
  let note = $state('');

  /** Awaits an admin API call that returns the overview, and shows it; errors become a toast.
   *  Resolves true on success, so callers only confirm or clear fields when it worked. */
  const run = async (request: Promise<Overview>): Promise<boolean> => {
    try {
      overview = await request;
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };
  onMount(() => run(api('/admin')));

  async function allow(e: SubmitEvent) {
    e.preventDefault();
    if (await run(api('/admin/owners', { method: 'POST', body: { email, note } }))) email = note = '';
  }
  // The number inputs bind straight to the overview's rows, so Save sends what's typed.
  const saveLimits = (w: Overview['workspaces'][number]) =>
    run(
      api(`/admin/workspaces/${w.id}`, {
        method: 'PATCH',
        body: { dailyFullScans: Number(w.dailyFullScans), dailyRechecks: Number(w.dailyRechecks), maxChannels: Number(w.maxChannels) },
      }),
    ).then((ok) => ok && toast.success('Limits saved'));
</script>

<h1 class="text-2xl font-semibold tracking-tight">Admin</h1>
<p class="text-muted-foreground mt-1 text-sm">Only you see this page.</p>

{#if overview}
  <div class="mt-6 grid items-start gap-4 lg:grid-cols-3">
    <Card.Root class="lg:col-span-2">
      <Card.Header>
        <Card.Title>Who can create a workspace</Card.Title>
        <Card.Description>
          {#if overview.ownerDomains.length}Anyone at {overview.ownerDomains.map((d) => `@${d}`).join(' or ')} gets one on first sign-in.{/if} Add other emails here; removing one takes away their
          workspace access (members they invited keep theirs).
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-3">
        <div class="divide-y rounded-lg border">
          {#each overview.allowedOwners as entry (entry.email)}
            <div class="flex items-center gap-2 px-3 py-2">
              <div class="min-w-0 flex-1">
                <div class="text-sm">{entry.email}</div>
                <div class="text-muted-foreground text-xs">{entry.note ? `${entry.note} · ` : ''}added {new Date(entry.addedAt).toLocaleDateString()}</div>
              </div>
              <Button size="icon-xs" variant="ghost" aria-label="Remove" onclick={() => run(api(`/admin/owners/${encodeURIComponent(entry.email)}`, { method: 'DELETE' }))}><X /></Button>
            </div>
          {:else}
            <div class="text-muted-foreground px-3 py-4 text-center text-xs">No extra emails yet</div>
          {/each}
        </div>
        <form class="flex flex-wrap gap-2" onsubmit={allow}>
          <Input class="min-w-56 flex-1" type="email" placeholder="colleague@example.com" bind:value={email} />
          <Input class="min-w-40 flex-1" placeholder="Note (optional)" bind:value={note} />
          <Button type="submit" disabled={!email.trim()}>Allow</Button>
        </form>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>YouTube quota today</Card.Title>
        <Card.Description>Shared by every workspace. Scans pause at the ceiling until midnight UTC.</Card.Description>
      </Card.Header>
      <Card.Content class="space-y-2">
        <div class="text-2xl font-semibold tabular-nums">
          {overview.quota.usedToday.toLocaleString()} <span class="text-muted-foreground text-sm font-normal">/ {overview.quota.limit.toLocaleString()} units</span>
        </div>
        <Progress value={overview.quota.usedToday} max={overview.quota.limit} class="h-1.5" />
      </Card.Content>
    </Card.Root>
  </div>

  <Card.Root class="mt-4">
    <Card.Header><Card.Title>Workspaces</Card.Title></Card.Header>
    <Card.Content class="p-0">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head class="pl-6">Workspace</Table.Head>
            <Table.Head>Members</Table.Head>
            <Table.Head>Channels</Table.Head>
            <Table.Head>Scans today</Table.Head>
            <Table.Head>Full scans/day</Table.Head>
            <Table.Head>Rechecks/day</Table.Head>
            <Table.Head>Max channels</Table.Head>
            <Table.Head class="pr-6"></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each overview.workspaces as w (w.id)}
            <Table.Row>
              <Table.Cell class="pl-6">
                <div class="font-medium">{w.name}</div>
                <div class="text-muted-foreground text-xs">{w.owner}</div>
              </Table.Cell>
              <Table.Cell class="tabular-nums">{w.members}</Table.Cell>
              <Table.Cell class="tabular-nums">{w.channels}</Table.Cell>
              <Table.Cell class="tabular-nums">{w.scansToday}</Table.Cell>
              <Table.Cell><Input class="h-7 w-16" type="number" min="0" bind:value={w.dailyFullScans} /></Table.Cell>
              <Table.Cell><Input class="h-7 w-16" type="number" min="0" bind:value={w.dailyRechecks} /></Table.Cell>
              <Table.Cell><Input class="h-7 w-16" type="number" min="0" bind:value={w.maxChannels} /></Table.Cell>
              <Table.Cell class="pr-6 text-right"><Button size="sm" variant="outline" onclick={() => saveLimits(w)}>Save</Button></Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>
{:else}
  <div class="text-muted-foreground py-16 text-center text-sm">Loading…</div>
{/if}
