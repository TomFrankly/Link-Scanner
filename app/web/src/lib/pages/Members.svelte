<script lang="ts">
  // Members page (#/members): who can open this workspace, and its name. Owners (and the app
  // admin) can add and remove people and rename it; members only see the list. The member
  // list isn't part of the report, so it's fetched here; each change returns the new list.
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import PageHeader from '$lib/components/page/PageHeader.svelte';
  import Section, { tile } from '$lib/components/page/Section.svelte';
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

  async function remove(memberEmail: string) {
    try {
      members = await api<Member[]>(`/w/${app.wsId}/members/${encodeURIComponent(memberEmail)}`, { method: 'DELETE' });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function rename(e: SubmitEvent) {
    e.preventDefault();
    try {
      await api(`/w/${app.wsId}`, { method: 'PATCH', body: { name } });
      // Update both copies of the name: the report's and the sidebar's workspace switcher.
      report.workspace.name = name;
      const workspace = app.me?.workspaces.find((x) => x.id === app.wsId);
      if (workspace) workspace.name = name;
      toast.success('Workspace renamed');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }
</script>

<PageHeader title="Members">
  {canManage ? 'People you add can sign in with a one-time code sent to their email.' : `Only the owner (${report.workspace.owner}) can add or remove people.`}
</PageHeader>

<Section title="People" description="Everyone here sees the same channels, results, rules and planned fixes.">
  {#if canManage}
    <form class="mb-3 flex gap-2" onsubmit={invite}>
      <Input type="email" placeholder="name@example.com" bind:value={email} />
      <Button type="submit" disabled={!email.trim()}>Add member</Button>
    </form>
  {/if}
  <div class="-mx-3 space-y-px">
    {#each members as m (m.email)}
      <div class={tile}>
        <span class="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium uppercase">{m.email[0]}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{m.email}</div>
          <div class="text-muted-foreground text-xs">
            {m.role === 'owner' ? 'Owner' : `Added by ${m.addedBy ?? 'unknown'} · ${new Date(m.addedAt).toLocaleDateString()}`}
          </div>
        </div>
        {#if canManage && m.role !== 'owner'}
          <Button size="icon-sm" variant="ghost" class="text-muted-foreground" aria-label="Remove {m.email}" onclick={() => remove(m.email)}><X /></Button>
        {/if}
      </div>
    {/each}
  </div>
</Section>

{#if canManage}
  <Section title="Workspace name" description="Shown in the workspace menu, for you and your members.">
    <form class="flex max-w-md gap-2" onsubmit={rename}>
      <Input bind:value={name} />
      <Button type="submit" variant="outline" disabled={!name.trim() || name === report.workspace.name}>Save</Button>
    </form>
  </Section>
{/if}
