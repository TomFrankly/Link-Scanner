<script lang="ts">
  // The drawer under a video in the link pane's "Used in" list: a small, read-only copy of that
  // video's Description tab, scrolled to the link. It shows the description the way the
  // Description tab's "Planned fixes" view does (saved text edits and planned link fixes applied,
  // changes highlighted, unplanned problem links flagged), but from the description saved by the
  // last full scan, so opening it costs no YouTube quota. Fix description opens the real editor.
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { app, data, loadDescriptions } from '$lib/store.svelte';
  import { applyFixes, FIXABLE, reasonFor, type Problem } from '$shared/fixes';
  import { applyTextEdits } from '$shared/textEdits';
  import type { VideoRef } from '$lib/types';
  import DescriptionEditor, { type Flag } from './DescriptionEditor.svelte';

  let { video, url }: { video: VideoRef; url: string } = $props();

  // undefined while loading; null when no full scan has saved this video's description.
  let description = $state<string | null | undefined>(undefined);
  let error = $state<string | null>(null);
  $effect(() => {
    const id = video.id;
    loadDescriptions()
      .then((all) => (description = all.get(id)?.d ?? null))
      .catch((e) => (error = (e as Error).message));
  });

  // The same inputs the Description tab uses (DescriptionPanel), for this one video.
  const links = $derived(
    data.rows.filter((r) => r.videos.some((v) => v.id === video.id) && (FIXABLE.includes(r.cls.category) || data.fixes.for(r.url, video.channelId))),
  );
  const problems = $derived<Problem[]>(
    links.map((r) => ({ url: r.url, category: r.cls.category, finalUrl: r.result?.finalUrl ?? null, detail: r.cls.detail ?? null })),
  );
  const decisions = $derived(
    Object.fromEntries(
      links.flatMap((r) => {
        const fix = data.fixes.for(r.url, video.channelId);
        return fix ? [[r.url, { action: fix.action, replacement: fix.replacement }]] : [];
      }),
    ),
  );
  // Where this link sits now: its replacement if one is planned; nowhere if it's removed.
  const fix = $derived(data.fixes.for(url, video.channelId));
  const target = $derived(fix?.action === 'replace' && fix.replacement ? fix.replacement : url);
  const source = $derived(description == null ? null : applyTextEdits(description, app.report?.textEdits ?? [], video.id, video.channelId));
  const shown = $derived(source ? applyFixes(source.text, problems, decisions) : null);
  const needles = $derived([target, ...(shown?.parts ?? []).filter((p) => p.hl && p.text.trim()).map((p) => p.text), ...(source?.added ?? [])]);
  const flagged = $derived<Flag[]>(
    problems
      .filter((p) => FIXABLE.includes(p.category) && !Object.hasOwn(decisions, p.url))
      .map((p) => ({ url: p.url, reason: reasonFor(p), tone: p.category === 'broken' || p.category === 'parked' ? 'red' : 'amber' })),
  );


  let editor = $state<DescriptionEditor>();
  let ready = $state(false);
  let text = $state('');
  $effect(() => {
    if (shown) text = shown.text;
  });
  // Scroll to the link once the editor is up (and again if a fix changes the text).
  $effect(() => {
    void text;
    if (ready && fix?.action !== 'remove') requestAnimationFrame(() => editor?.reveal([target, url], { quiet: true }));
  });
</script>

<div class="bg-background overflow-hidden rounded-lg border">
  {#if error}
    <p class="text-muted-foreground p-3 text-xs">Couldn’t load the description: {error}</p>
  {:else if description === undefined}
    <div class="space-y-2 p-3"><Skeleton class="h-3 w-3/4" /><Skeleton class="h-3 w-1/2" /><Skeleton class="h-3 w-2/3" /></div>
  {:else if description === null}
    <p class="text-muted-foreground p-3 text-xs">No saved description yet. A full scan saves it; Fix description loads it from YouTube.</p>
  {:else}
    {#if fix?.action === 'remove'}
      <p class="text-muted-foreground border-b px-3 py-1.5 text-xs">Its planned fix removes this link, so it isn’t in the text below.</p>
    {/if}
    <div class="h-56">
      <DescriptionEditor bind:this={editor} bind:ready bind:value={text} readonly {needles} tint="bg-[#fab219]/30" {flagged} />
    </div>
  {/if}
</div>
