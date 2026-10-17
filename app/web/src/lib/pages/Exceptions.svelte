<script lang="ts">
  // Exceptions page (#/exceptions): this workspace's rules for which redirects are fine and
  // which links to hide, plus the app defaults it can turn off. The rules live in
  // `app.report.rules`; addRule/removeRule (store.svelte.ts) save them through the API and patch
  // that list, and the report reclassifies in the browser at once, with no recheck.
  // It also lists the workspace's saved text edits (from a video's Description tab: Replace… on
  // selected text, or hand-edited lines saved with the save icon), with how many videos each
  // one currently changes. Laid out as Sections (components/page), like the other settings pages.
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import PageHeader from '$lib/components/page/PageHeader.svelte';
  import Section, { tile } from '$lib/components/page/Section.svelte';
  import { Input } from '$lib/components/ui/input';
  import Hint from '$lib/components/Hint.svelte';
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
  const scope = (e: TextEdit) => {
    const every = e.kind === 'text' ? 'every video with this text' : 'every video with these lines';
    return e.videos ? `Chosen videos (${e.videos.length})` : e.channelId ? `${data.channelTitle[e.channelId] ?? 'One channel'}: ${every}` : every[0]!.toUpperCase() + every.slice(1);
  };

  // "alex · 3/14/2026": who added a rule and when, by the email's name part.
  const addedLine = (r: Pick<RuleRow, 'addedBy' | 'addedAt'>) => `${r.addedBy.split('@')[0]} · ${new Date(r.addedAt).toLocaleDateString()}`;
</script>

<!-- A removable list of rules; `fmt` turns a rule into its display text. -->
{#snippet list(rows: RuleRow[], fmt: (r: RuleRow) => string)}
  <div class="-mx-3 space-y-px">
    {#each rows as r (r.id)}
      <div class={tile}>
        <div class="min-w-0 flex-1">
          <div class="font-mono text-xs break-all">{fmt(r)}</div>
          <div class="text-muted-foreground mt-0.5 text-xs">{r.note ? `${r.note} · ` : ''}{addedLine(r)}</div>
        </div>
        <Button size="icon-xs" variant="ghost" class="text-muted-foreground" aria-label="Remove" onclick={() => removeRule(r.id)}><X /></Button>
      </div>
    {:else}
      <p class="text-muted-foreground px-3 py-2 text-sm">None yet.</p>
    {/each}
  </div>
{/snippet}

<PageHeader title="Exceptions">These lists belong to this workspace. Changes apply to the report instantly, without rechecking anything.</PageHeader>

<Section title="Accepted redirects" description="A move from one domain to another that you’re fine with, like a company rebrand.">
  {@render list(own('accepted'), (r) => `${r.value} → ${r.value2}`)}
  <form class="mt-3 flex flex-wrap gap-2" onsubmit={(e) => (e.preventDefault(), add('accepted'))}>
    <Input class="min-w-32 flex-1" placeholder="from.com" bind:value={accFrom} />
    <Input class="min-w-32 flex-1" placeholder="to.com" bind:value={accTo} />
    <Input class="min-w-40 flex-[2]" placeholder="Note (optional)" bind:value={accNote} />
    <Button type="submit" variant="outline" disabled={!accFrom.trim() || !accTo.trim()}>Add</Button>
  </form>
</Section>

<Section title="Redirectors" description="Short-link or redirect domains you control. They’re only flagged if the destination breaks or changes.">
  {@render list(own('redirector'), (r) => r.value)}
  <form class="mt-3 flex flex-wrap gap-2" onsubmit={(e) => (e.preventDefault(), add('redirector'))}>
    <Input class="min-w-40 flex-1" placeholder="go.example.com" bind:value={redirector} />
    <Input class="min-w-40 flex-1" placeholder="Note (optional)" bind:value={redNote} />
    <Button type="submit" variant="outline" disabled={!redirector.trim()}>Add</Button>
  </form>
</Section>

<Section title="Ignored" description="Domains or exact links to leave out of the report.">
  {@render list(own('ignored'), (r) => r.value)}
  <form class="mt-3 flex flex-wrap gap-2" onsubmit={(e) => (e.preventDefault(), add('ignored'))}>
    <Input class="min-w-40 flex-1" placeholder="example.com or a full link" bind:value={ignored} />
    <Input class="min-w-40 flex-1" placeholder="Note (optional)" bind:value={ignNote} />
    <Button type="submit" variant="outline" disabled={!ignored.trim()}>Add</Button>
  </form>
</Section>

<Section title="Marked as working">
  {#snippet description()}
    Links you opened and found working, though the checker couldn’t confirm them (a timeout or bot protection). Mark one from its Could not verify or
    Broken page. A definite error, like a 404, still shows.
  {/snippet}
  {@render list(own('working'), (r) => r.value)}
</Section>

<Section title="Saved text edits">
  {#snippet description()}
    Text changes saved from a video’s Description tab: select text and click Replace, or edit lines by hand and click the save icon. They run before planned
    link fixes, in every video they cover.
  {/snippet}
  <div class="-mx-3 space-y-1">
    {#each report.textEdits as e (e.id)}
      {@const n = editCounts?.get(e.id)}
      <div class="{tile} items-start">
        <div class="min-w-0 flex-1 space-y-1.5">
          <div class="overflow-hidden rounded-md font-mono text-xs leading-relaxed">
            {#each lines(e.find) as l, k (k)}
              <div class="flex bg-[#d03b3b]/10 px-2 dark:bg-[#d03b3b]/20"><span class="text-muted-foreground w-4 shrink-0 select-none">−</span><span class="break-all whitespace-pre-wrap">{l || ' '}</span></div>
            {/each}
            {#each lines(e.replace) as l, k (k)}
              <div class="flex bg-[#0ca30c]/10 px-2 dark:bg-[#0ca30c]/20"><span class="text-muted-foreground w-4 shrink-0 select-none">+</span><span class="break-all whitespace-pre-wrap">{l || ' '}</span></div>
            {:else}
              <div class="bg-muted/60 text-muted-foreground px-2 italic">{e.kind === 'text' ? 'Text deleted' : 'Lines deleted'}</div>
            {/each}
          </div>
          <div class="text-muted-foreground text-xs">
            {[scope(e), n === undefined ? '' : n === 0 ? 'not found in any saved description' : `changes ${n} video${n === 1 ? '' : 's'}`, addedLine(e)]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <Button size="icon-xs" variant="ghost" class="text-muted-foreground" aria-label="Remove" onclick={() => removeTextEdit(e.id)}><X /></Button>
      </div>
    {:else}
      <p class="text-muted-foreground px-3 py-2 text-sm">None yet.</p>
    {/each}
  </div>
</Section>

<Section title="App defaults" description="Every workspace starts with these. Turn one off if it doesn’t fit your channel.">
  <div class="space-y-6">
    <div>
      <h3 class="text-muted-foreground mb-1 text-xs font-medium">Accepted redirects</h3>
      <div class="-mx-3 space-y-px">
        {#each report.defaults.accepted as pair (acceptedKey(pair))}
          {@const off = disabledRule('accepted', acceptedKey(pair))}
          <div class="{tile} py-1">
            <span class="flex-1 font-mono text-xs {off ? 'text-muted-foreground line-through' : ''}">{pair[0]} → {pair[1]}</span>
            <Button size="xs" variant="ghost" class="text-muted-foreground" onclick={() => (off ? removeRule(off.id) : addRule('disabled', 'accepted', acceptedKey(pair)))}
              >{off ? 'Turn on' : 'Turn off'}</Button
            >
          </div>
        {/each}
      </div>
    </div>
    <div>
      <h3 class="text-muted-foreground mb-2 text-xs font-medium">Redirectors <span class="font-normal">· click one to turn it off</span></h3>
      <div class="flex flex-wrap gap-1.5">
        {#each report.defaults.redirectors as d (d)}
          {@const off = disabledRule('redirector', d)}
          <Hint text={off ? 'Turned off for this workspace. Click to turn it on.' : 'Click to turn off for this workspace'}>
            {#snippet children(tip)}
              <button
                {...tip}
                class="rounded-full px-2.5 py-0.5 font-mono text-xs transition-colors duration-150 {off
                  ? 'text-muted-foreground hover:bg-muted/50 line-through'
                  : 'bg-muted hover:bg-muted/70'}"
                onclick={() => (off ? removeRule(off.id) : addRule('disabled', 'redirector', d))}>{d}</button
              >
            {/snippet}
          </Hint>
        {/each}
      </div>
    </div>
  </div>
</Section>
