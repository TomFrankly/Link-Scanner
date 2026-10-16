<script lang="ts">
  // Exceptions page (#/exceptions): this workspace's rules for which redirects are fine and
  // which links to hide, plus the app defaults it can turn off. The rules live in
  // `app.report.rules`; addRule/removeRule (store.svelte.ts) save them through the API and patch
  // that list, and the report reclassifies in the browser at once, with no recheck.
  // It also lists the workspace's saved text edits (hand edits saved from the Fix description
  // Description tab), with how many videos each one currently changes.
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { acceptedKey, type RuleRow, type RuleType } from '$shared/rules';
  import { addRule, app, data, loadDescriptions, removeRule, removeTextEdit } from '$lib/store.svelte';
  import { applyTextEdits, type TextEdit } from '$shared/textEdits';

  const report = $derived(app.report!);
  // The workspace's own rules of one type (the defaults are listed separately below).
  const own = (type: RuleType) => report.rules.filter((r) => r.type === type);
  // Turning a default off saves a `disabled` rule naming it; this finds that rule, if any.
  const disabledRule = (kind: string, key: string) => report.rules.find((r) => r.type === 'disabled' && r.value === kind && r.value2 === key);

  let accFrom = $state('');
  let accTo = $state('');
  let accNote = $state('');
  let redirector = $state('');
  let redNote = $state('');
  let ignored = $state('');
  let ignNote = $state('');

  /** Saves one of the three forms; each form clears only when its rule saved. */
  async function add(type: RuleType) {
    if (type === 'accepted' && (await addRule('accepted', accFrom, accTo, accNote))) accFrom = accTo = accNote = '';
    if (type === 'redirector' && (await addRule('redirector', redirector, undefined, redNote))) redirector = redNote = '';
    if (type === 'ignored' && (await addRule('ignored', ignored, undefined, ignNote))) ignored = ignNote = '';
  }
  // How many videos each saved text edit changes now, by edit id. Worked out from the saved
  // descriptions, so an edit whose lines have since changed on YouTube shows 0. Null while loading.
  let editCounts = $state<Map<number, number> | null>(null);
  $effect(() => {
    const edits = report.textEdits;
    if (!edits.length) return;
    loadDescriptions()
      .then((all) => {
        const counts = new Map<number, number>(edits.map((e) => [e.id, 0]));
        for (const [id, x] of all) {
          if (x.d == null) continue;
          for (const i of applyTextEdits(x.d, edits, id, data.channelOf.get(id) ?? '').used) counts.set(edits[i]!.id, counts.get(edits[i]!.id)! + 1);
        }
        editCounts = counts;
      })
      .catch(() => (editCounts = null));
  });
  const lines = (s: string) => (s === '' ? [] : s.split('\n'));
  const scope = (e: TextEdit) =>
    e.videos ? `Chosen videos (${e.videos.length})` : e.channelId ? `${data.channelTitle[e.channelId] ?? 'One channel'}: every video with these lines` : 'Every video with these lines';

  // "alex · 3/14/2026": who added a rule and when, by the email's name part.
  const addedLine = (r: Pick<RuleRow, 'addedBy' | 'addedAt'>) => `${r.addedBy.split('@')[0]} · ${new Date(r.addedAt).toLocaleDateString()}`;
</script>

<!-- A removable list of rules; `fmt` turns a rule into its display text. -->
{#snippet list(rows: RuleRow[], fmt: (r: RuleRow) => string)}
  <div class="divide-y rounded-lg border">
    {#each rows as r (r.id)}
      <div class="flex items-start gap-2 px-3 py-2">
        <div class="min-w-0 flex-1">
          <div class="font-mono text-xs break-all">{fmt(r)}</div>
          <div class="text-muted-foreground mt-0.5 text-xs">{r.note ? `${r.note} · ` : ''}{addedLine(r)}</div>
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
    <Card.Title>Saved text edits</Card.Title>
    <Card.Description>
      Hand edits saved from the Fix description panel. Each replaces whole lines wherever they appear in the videos it covers, before planned link fixes
      run. Edit a description and click Save edit to add one.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <div class="divide-y rounded-lg border">
      {#each report.textEdits as e (e.id)}
        {@const n = editCounts?.get(e.id)}
        <div class="flex items-start gap-2 px-3 py-2">
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="overflow-hidden rounded-md border font-mono text-xs leading-relaxed">
              {#each lines(e.find) as l, k (k)}
                <div class="flex bg-[#d03b3b]/10 px-2 dark:bg-[#d03b3b]/20"><span class="text-muted-foreground w-4 shrink-0 select-none">−</span><span class="break-all whitespace-pre-wrap">{l || ' '}</span></div>
              {/each}
              {#each lines(e.replace) as l, k (k)}
                <div class="flex bg-[#0ca30c]/10 px-2 dark:bg-[#0ca30c]/20"><span class="text-muted-foreground w-4 shrink-0 select-none">+</span><span class="break-all whitespace-pre-wrap">{l || ' '}</span></div>
              {:else}
                <div class="text-muted-foreground px-2 italic">Lines deleted</div>
              {/each}
            </div>
            <div class="text-muted-foreground text-xs">
              {[scope(e), n === undefined ? '' : n === 0 ? 'not found in any saved description' : `changes ${n} video${n === 1 ? '' : 's'}`, addedLine(e)]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <Button size="icon-xs" variant="ghost" aria-label="Remove" onclick={() => removeTextEdit(e.id)}><X /></Button>
        </div>
      {:else}
        <div class="text-muted-foreground px-3 py-4 text-center text-xs">None yet</div>
      {/each}
    </div>
  </Card.Content>
</Card.Root>

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
