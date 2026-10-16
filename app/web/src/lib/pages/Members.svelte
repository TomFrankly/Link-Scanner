<script lang="ts">
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { api } from '$lib/api';
  import { app } from '$lib/store.svelte';
  import type { Member } from '$lib/types';

  const report = $derived(app.report!);
  const canManage = $derived(report.workspace.role === 'owner' || report.workspace.role === 'admin');
  let members = $state<Member[]>([]);
  let email = $state('');
  let name = $state('');

  onMount(async () => {
    name = report.workspace.name;
    try {
      members = await api<Member[]>(`/w/${app.wsId}/members`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  async function invite(e: SubmitEvent) {
    e.preventDefault();
    try {
      members = await api<Member[]>(`/w/${app.wsId}/members`, { method: 'POST', body: { email } });
      toast.success(`${email} can now sign in with a code sent to that address.`);
      email = '';
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function remove(m: string) {
    try {
      members = await api<Member[]>(`/w/${app.wsId}/members/${encodeURIComponent(m)}`, { method: 'DELETE' });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function rename(e: SubmitEvent) {
    e.preventDefault();
    try {
      await api(`/w/${app.wsId}`, { method: 'PATCH', body: { name } });
      report.workspace.name = name;
      const w = app.me?.workspaces.find((x) => x.id === app.wsId);
      if (w) w.name = name;
      toast.success('Workspace renamed');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }
</script>

<h1 class="text-2xl font-semibold tracking-tight">Members</h1>
<p class="text-muted-foreground mt-1 text-sm">
  {canManage ? 'People you add can sign in with a one-time code sent to their email.' : `Only the owner (${report.workspace.owner}) can add or remove people.`}
</p>

<div class="mt-6 grid items-start gap-4 lg:grid-cols-3">
  <Card.Root class="lg:col-span-2">
    <Card.Content class="divide-y p-0">
      {#each members as m (m.email)}
        <div class="flex items-center gap-3 px-5 py-3">
          <span class="bg-muted flex size-8 items-center justify-center rounded-full text-xs font-medium uppercase">{m.email[0]}</span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">{m.email}</div>
            <div class="text-muted-foreground text-xs">
              {m.role === 'owner' ? 'Owner' : `Added by ${m.addedBy ?? 'unknown'} · ${new Date(m.addedAt).toLocaleDateString()}`}
            </div>
          </div>
          {#if canManage && m.role !== 'owner'}
            <Button size="icon-sm" variant="ghost" aria-label="Remove {m.email}" onclick={() => remove(m.email)}><X /></Button>
          {/if}
        </div>
      {/each}
    </Card.Content>
    {#if canManage}
      <Card.Footer class="border-t">
        <form class="flex w-full gap-2" onsubmit={invite}>
          <Input type="email" placeholder="name@example.com" bind:value={email} />
          <Button type="submit" disabled={!email.trim()}>Add member</Button>
        </form>
      </Card.Footer>
    {/if}
  </Card.Root>

  {#if canManage}
    <Card.Root>
      <Card.Header><Card.Title>Workspace name</Card.Title></Card.Header>
      <Card.Content>
        <form class="flex gap-2" onsubmit={rename}>
          <Input bind:value={name} />
          <Button type="submit" variant="outline" disabled={!name.trim() || name === report.workspace.name}>Save</Button>
        </form>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
