<script lang="ts">
  // The choices for a problem link, used inside any dropdown menu. A planned fix belongs to
  // the link, so it applies in every video that uses it.
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { baseDomain, hostOf } from '$shared/core';
  import { FIXABLE, REDIRECTS } from '$shared/fixes';
  import { addRule, data, setFix, ui } from '$lib/store.svelte';
  import type { Row } from '$lib/types';

  let { row }: { row: Row } = $props();

  const fix = $derived(data.fixes.get(row.url));
  const finalUrl = $derived(row.result?.finalUrl ?? '');
  // A redirect's destination is a sensible replacement; a broken link's last hop isn't.
  const redirectTarget = $derived(REDIRECTS.includes(row.cls.category) && finalUrl && finalUrl !== row.url ? finalUrl : '');
  const startBase = $derived(baseDomain(row.host));
  const finalBase = $derived(finalUrl ? baseDomain(hostOf(finalUrl)) : '');
</script>

{#if FIXABLE.includes(row.cls.category)}
  <DropdownMenu.Label class="text-muted-foreground text-xs font-normal">Fix in descriptions (all videos)</DropdownMenu.Label>
  {#if redirectTarget}
    <DropdownMenu.Item onSelect={() => setFix(row.url, 'replace', redirectTarget)}>
      <div class="min-w-0">
        <div>Replace with where it redirects now</div>
        <div class="text-muted-foreground truncate font-mono text-xs">{redirectTarget}</div>
      </div>
    </DropdownMenu.Item>
  {/if}
  <DropdownMenu.Item onSelect={() => (ui.fixLinkUrl = row.url)}>Replace with a different link…</DropdownMenu.Item>
  <DropdownMenu.Item onSelect={() => setFix(row.url, 'remove')}>Remove from descriptions</DropdownMenu.Item>
  {#if fix}<DropdownMenu.Item onSelect={() => setFix(row.url, 'clear')}>Clear planned fix</DropdownMenu.Item>{/if}
  <DropdownMenu.Separator />
  <DropdownMenu.Label class="text-muted-foreground text-xs font-normal">Or mark it as fine</DropdownMenu.Label>
{/if}
{#if row.cls.category === 'domain-changed' && finalBase}
  <DropdownMenu.Item onSelect={() => addRule('accepted', startBase, finalBase)}>Accept {startBase} → {finalBase}</DropdownMenu.Item>
  <DropdownMenu.Item onSelect={() => addRule('redirector', row.host)}>Treat {row.host} as a redirector</DropdownMenu.Item>
{/if}
{#if row.cls.category !== 'ignored'}
  <DropdownMenu.Item onSelect={() => addRule('ignored', row.url)}>Ignore this link</DropdownMenu.Item>
  <DropdownMenu.Item onSelect={() => addRule('ignored', row.host)}>Ignore all of {row.host}</DropdownMenu.Item>
{/if}
