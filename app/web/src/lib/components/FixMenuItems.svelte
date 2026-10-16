<script lang="ts">
  // The choices for a link, used inside any dropdown menu. Any link can be replaced or removed
  // (a problem link, or a working one you want to swap, like an old affiliate link). A planned
  // fix belongs to the link, so it applies in every video that uses it. Problem links also get
  // ways to mark them as fine.
  // Used in the Report page's per-link "…" menu and in PlanFixButton (videos view and drawer).
  // Fixes go through setFix and "mark it as fine" choices through addRule (store.svelte.ts);
  // both update the store, so every list showing this link updates too.
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { baseDomain, hostOf } from '$shared/core';
  import { FIXABLE, REDIRECTS } from '$shared/fixes';
  import { addRule, data, setFix, ui } from '$lib/store.svelte';
  import type { Row } from '$lib/types';

  let { row }: { row: Row } = $props();

  const fixes = $derived(data.fixes.all(row.url));
  const finalUrl = $derived(row.result?.finalUrl ?? '');
  // A redirect's destination is a sensible replacement; a broken link's last hop isn't.
  const redirectTarget = $derived(REDIRECTS.includes(row.cls.category) && finalUrl && finalUrl !== row.url ? finalUrl : '');
  const startBase = $derived(baseDomain(row.host));
  const finalBase = $derived(finalUrl ? baseDomain(hostOf(finalUrl)) : '');
</script>

<DropdownMenu.Label class="text-muted-foreground text-xs font-normal">
  {FIXABLE.includes(row.cls.category) ? 'Fix' : 'Change'} in descriptions (all videos)
</DropdownMenu.Label>
{#if redirectTarget}
  <DropdownMenu.Item onSelect={() => setFix(row.url, 'replace', redirectTarget)}>
    <div class="min-w-0">
      <div>Replace with where it redirects now</div>
      <div class="text-muted-foreground truncate font-mono text-xs">{redirectTarget}</div>
    </div>
  </DropdownMenu.Item>
{/if}
<DropdownMenu.Item onSelect={() => ((ui.fixLinkChannel = ''), (ui.fixLinkUrl = row.url))}>Replace with a different link…</DropdownMenu.Item>
<DropdownMenu.Item onSelect={() => setFix(row.url, 'remove')}>Remove from descriptions</DropdownMenu.Item>
{#each fixes as f (f.channelId)}
  <DropdownMenu.Item onSelect={() => setFix(row.url, 'clear', undefined, { channelId: f.channelId })}>
    Clear planned fix{f.channelId ? ` (${data.channelTitle[f.channelId] ?? 'one channel'})` : fixes.length > 1 ? ' (all channels)' : ''}
  </DropdownMenu.Item>
{/each}
{#if FIXABLE.includes(row.cls.category)}
  <DropdownMenu.Separator />
  <DropdownMenu.Label class="text-muted-foreground text-xs font-normal">Or mark it as fine</DropdownMenu.Label>
{:else if row.cls.category !== 'ignored'}
  <DropdownMenu.Separator />
{/if}
{#if row.cls.category === 'domain-changed' && finalBase}
  <DropdownMenu.Item onSelect={() => addRule('accepted', startBase, finalBase)}>Accept {startBase} → {finalBase}</DropdownMenu.Item>
  <DropdownMenu.Item onSelect={() => addRule('redirector', row.host)}>Treat {row.host} as a redirector</DropdownMenu.Item>
{/if}
{#if row.cls.category !== 'ignored'}
  <DropdownMenu.Item onSelect={() => addRule('ignored', row.url)}>Ignore this link</DropdownMenu.Item>
  <DropdownMenu.Item onSelect={() => addRule('ignored', row.host)}>Ignore all of {row.host}</DropdownMenu.Item>
{/if}
