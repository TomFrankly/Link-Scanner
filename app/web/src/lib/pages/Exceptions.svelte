<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { acceptedKey, type RuleRow, type RuleType } from '$shared/rules';
  import { addRule, app, removeRule } from '$lib/store.svelte';

  const report = $derived(app.report!);
  const own = (t: RuleType) => report.rules.filter((r) => r.type === t);
  const disabledRule = (kind: string, key: string) => report.rules.find((r) => r.type === 'disabled' && r.value === kind && r.value2 === key);

  let accFrom = $state('');
  let accTo = $state('');
  let accNote = $state('');
  let redirector = $state('');
  let redNote = $state('');
  let ignored = $state('');
  let ignNote = $state('');

  async function add(type: RuleType) {
    if (type === 'accepted' && (await addRule('accepted', accFrom, accTo, accNote))) accFrom = accTo = accNote = '';
    if (type === 'redirector' && (await addRule('redirector', redirector, undefined, redNote))) redirector = redNote = '';
    if (type === 'ignored' && (await addRule('ignored', ignored, undefined, ignNote))) ignored = ignNote = '';
  }
  const by = (r: RuleRow) => `${r.addedBy.split('@')[0]} · ${new Date(r.addedAt).toLocaleDateString()}`;
</script>

{#snippet list(rows: RuleRow[], fmt: (r: RuleRow) => string)}
  <div class="divide-y rounded-lg border">
    {#each rows as r (r.id)}
      <div class="flex items-start gap-2 px-3 py-2">
        <div class="min-w-0 flex-1">
          <div class="font-mono text-xs break-all">{fmt(r)}</div>
          <div class="text-muted-foreground mt-0.5 text-xs">{r.note ? `${r.note} · ` : ''}{by(r)}</div>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="Remove" onclick={() => removeRule(r.id)}><X /></Button>
      </div>
    {:else}
      <div class="text-muted-foreground px-3 py-4 text-center text-xs">None yet</div>
    {/each}
  </div>
{/snippet}

<h1 class="text-2xl font-semibold tracking-tight">Exceptions</h1>
<p class="text-muted-foreground mt-1 text-sm">These lists belong to this workspace. Changes apply to the report instantly, without rechecking anything.</p>

<div class="mt-6 grid items-start gap-4 lg:grid-cols-3">
  <Card.Root>
    <Card.Header>
      <Card.Title>Accepted redirects</Card.Title>
      <Card.Description>A move from one domain to another that you're fine with, like a company rebrand.</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-3">
      {@render list(own('accepted'), (r) => `${r.value} → ${r.value2}`)}
      <form class="space-y-2" onsubmit={(e) => (e.preventDefault(), add('accepted'))}>
        <div class="flex gap-2"><Input placeholder="from.com" bind:value={accFrom} /><Input placeholder="to.com" bind:value={accTo} /></div>
        <div class="flex gap-2"><Input placeholder="Note (optional)" bind:value={accNote} /><Button type="submit" variant="outline">Add</Button></div>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Redirectors</Card.Title>
      <Card.Description>Short-link or redirect domains you control. They're only flagged if the destination breaks or changes.</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-3">
      {@render list(own('redirector'), (r) => r.value)}
      <form class="space-y-2" onsubmit={(e) => (e.preventDefault(), add('redirector'))}>
        <Input placeholder="go.example.com" bind:value={redirector} />
        <div class="flex gap-2"><Input placeholder="Note (optional)" bind:value={redNote} /><Button type="submit" variant="outline">Add</Button></div>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Ignored</Card.Title>
      <Card.Description>Domains or exact links to leave out of the report.</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-3">
      {@render list(own('ignored'), (r) => r.value)}
      <form class="space-y-2" onsubmit={(e) => (e.preventDefault(), add('ignored'))}>
        <Input placeholder="example.com or a full link" bind:value={ignored} />
        <div class="flex gap-2"><Input placeholder="Note (optional)" bind:value={ignNote} /><Button type="submit" variant="outline">Add</Button></div>
      </form>
    </Card.Content>
  </Card.Root>
</div>

<Card.Root class="mt-4">
  <Card.Header>
    <Card.Title>App defaults</Card.Title>
    <Card.Description>Every workspace starts with these. Turn one off if it doesn't fit your channel.</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-6 md:grid-cols-2">
    <div>
      <div class="mb-2 text-sm font-medium">Accepted redirects</div>
      <div class="divide-y rounded-lg border">
        {#each report.defaults.accepted as pair (acceptedKey(pair))}
          {@const off = disabledRule('accepted', acceptedKey(pair))}
          <div class="flex items-center gap-2 px-3 py-1.5">
            <span class="flex-1 font-mono text-xs {off ? 'text-muted-foreground line-through' : ''}">{pair[0]} → {pair[1]}</span>
            <Button size="xs" variant="ghost" onclick={() => (off ? removeRule(off.id) : addRule('disabled', 'accepted', acceptedKey(pair)))}>{off ? 'Turn on' : 'Turn off'}</Button>
          </div>
        {/each}
      </div>
    </div>
    <div>
      <div class="mb-2 text-sm font-medium">Redirectors</div>
      <div class="flex flex-wrap gap-1.5">
        {#each report.defaults.redirectors as d (d)}
          {@const off = disabledRule('redirector', d)}
          <button
            class="rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors {off ? 'text-muted-foreground line-through' : 'hover:bg-muted'}"
            title={off ? 'Turned off for this workspace. Click to turn on.' : 'Click to turn off for this workspace'}
            onclick={() => (off ? removeRule(off.id) : addRule('disabled', 'redirector', d))}>{d}</button
          >
        {/each}
      </div>
    </div>
  </Card.Content>
</Card.Root>
