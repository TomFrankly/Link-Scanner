<script lang="ts">
  // Admin page (#/admin), shown only to app admins. Decides who may create a workspace, shows
  // today's shared YouTube quota, and sets each workspace's daily limits. Unlike the other
  // pages it doesn't use the workspace report: it loads its own overview from /api/admin, and
  // every change returns the updated overview, which replaces the old one.
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import PageHeader from '$lib/components/page/PageHeader.svelte';
  import Section, { tile } from '$lib/components/page/Section.svelte';
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

<PageHeader title="Admin">Only you see this page.</PageHeader>

{#if overview}
  <Section title="YouTube quota today" description="Shared by every workspace. Scans pause at the ceiling until midnight Pacific time, when YouTube resets.">
    <div class="max-w-md space-y-2">
      <div class="text-2xl font-semibold tabular-nums">
        {overview.quota.usedToday.toLocaleString()} <span class="text-muted-foreground text-sm font-normal">/ {overview.quota.limit.toLocaleString()} units</span>
      </div>
      <Progress value={overview.quota.usedToday} max={overview.quota.limit} class="h-1.5" />
    </div>
  </Section>

  <Section title="Who can create a workspace">
    {#snippet description()}
      {#if overview?.ownerDomains.length}Anyone at {overview.ownerDomains.map((d) => `@${d}`).join(' or ')} gets one on first sign-in.{/if} Add other emails here; removing one
      takes away their workspace access (members they invited keep theirs).
    {/snippet}
    <form class="mb-3 flex flex-wrap gap-2" onsubmit={allow}>
      <Input class="min-w-56 flex-1" type="email" placeholder="colleague@example.com" bind:value={email} />
      <Input class="min-w-40 flex-1" placeholder="Note (optional)" bind:value={note} />
      <Button type="submit" disabled={!email.trim()}>Allow</Button>
    </form>
    <div class="-mx-3 space-y-px">
      {#each overview.allowedOwners as entry (entry.email)}
        <div class={tile}>
          <div class="min-w-0 flex-1">
            <div class="text-sm">{entry.email}</div>
            <div class="text-muted-foreground text-xs">{entry.note ? `${entry.note} · ` : ''}added {new Date(entry.addedAt).toLocaleDateString()}</div>
          </div>
          <Button size="icon-xs" variant="ghost" class="text-muted-foreground" aria-label="Remove" onclick={() => run(api(`/admin/owners/${encodeURIComponent(entry.email)}`, { method: 'DELETE' }))}
            ><X /></Button
          >
        </div>
      {:else}
        <p class="text-muted-foreground px-3 py-2 text-sm">No extra emails yet.</p>
      {/each}
    </div>
  </Section>

  <!-- The table spans the page: it needs the width more than it needs a side heading. -->
  <section class="py-7">
    <h2 class="text-sm font-semibold">Workspaces</h2>
    <p class="text-muted-foreground mt-1 text-sm">Daily limits per workspace. Change a number and click Save on its row.</p>
    <Table.Root class="mt-3">
      <Table.Header>
        <Table.Row class="border-0 hover:bg-transparent">
          <Table.Head>Workspace</Table.Head>
          <Table.Head>Members</Table.Head>
          <Table.Head>Channels</Table.Head>
          <Table.Head>Scans today</Table.Head>
          <Table.Head>Full scans/day</Table.Head>
          <Table.Head>Rechecks/day</Table.Head>
          <Table.Head>Max channels</Table.Head>
          <Table.Head></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each overview.workspaces as w (w.id)}
          <Table.Row class="border-0 [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg">
            <Table.Cell>
              <div class="font-medium">{w.name}</div>
              <div class="text-muted-foreground text-xs">{w.owner}</div>
            </Table.Cell>
            <Table.Cell class="tabular-nums">{w.members}</Table.Cell>
            <Table.Cell class="tabular-nums">{w.channels}</Table.Cell>
            <Table.Cell class="tabular-nums">{w.scansToday}</Table.Cell>
            <Table.Cell><Input class="h-7 w-16" type="number" min="0" bind:value={w.dailyFullScans} /></Table.Cell>
            <Table.Cell><Input class="h-7 w-16" type="number" min="0" bind:value={w.dailyRechecks} /></Table.Cell>
            <Table.Cell><Input class="h-7 w-16" type="number" min="0" bind:value={w.maxChannels} /></Table.Cell>
            <Table.Cell class="text-right"><Button size="sm" variant="outline" onclick={() => saveLimits(w)}>Save</Button></Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </section>
{:else}
  <div class="text-muted-foreground py-16 text-center text-sm">Loading…</div>
{/if}
