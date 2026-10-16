<script lang="ts">
  // Channels page (#/channels): the YouTube channels this workspace scans. Reads the list and
  // limits from `app.report`; adding or removing a channel calls the API, then reloads the
  // whole report, since a channel's videos and links come and go with it.
  import { toast } from 'svelte-sonner';
  import Trash from '@lucide/svelte/icons/trash-2';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Hint from '$lib/components/Hint.svelte';
  import { api } from '$lib/api';
  import { app, go, loadReport, startScan } from '$lib/store.svelte';

  const report = $derived(app.report!);
  let input = $state('');
  let busy = $state(false);

  const scanning = $derived(report.scan?.status === 'fetching' || report.scan?.status === 'checking');
  const fullLeft = $derived(Math.max(0, report.limits.fullScans - report.usedToday.full));
  // Why the per-channel Scan buttons are disabled, or null when they're usable. Also the tooltip text.
  const scanBlocked = $derived(scanning ? 'A scan is already running.' : !fullLeft ? 'No full scans left today.' : null);

  /** Full-scans just this channel, then shows the Report page, where the scan banner tracks it. */
  async function scanChannel(id: string) {
    await startScan('full', undefined, [id]);
    if (app.report?.scan?.status === 'fetching') go('report');
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const added = await api<{ id: string; title: string }>(`/w/${app.wsId}/channels`, { method: 'POST', body: { input } });
      input = '';
      await loadReport();
      // Adding doesn't scan, so offer to; the longer toast gives time to click the action.
      if (scanBlocked) toast.success(`Added ${added.title}. Scan it from this page when you're ready.`);
      else toast.success(`Added ${added.title}`, { action: { label: 'Scan it now', onClick: () => scanChannel(added.id) }, duration: 10_000 });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function remove(id: string, title: string) {
    if (!confirm(`Remove ${title} from this workspace? Its links leave the report; nothing changes on YouTube.`)) return;
    try {
      await api(`/w/${app.wsId}/channels/${id}`, { method: 'DELETE' });
      await loadReport();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }
</script>

<h1 class="text-2xl font-semibold tracking-tight">Channels</h1>
<p class="text-muted-foreground mt-1 text-sm">
  Public videos on these channels are scanned. This workspace can have up to {report.limits.maxChannels} channels.
</p>

<Card.Root class="mt-6">
  <Card.Content class="divide-y p-0">
    {#each report.channels as c (c.id)}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
        {#if c.thumbnail}
          <img src={c.thumbnail} alt="" class="size-10 shrink-0 rounded-full" />
        {:else}
          <span class="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium">{c.title[0]}</span>
        {/if}
        <div class="min-w-0 flex-1 basis-48">
          <div class="font-medium">{c.title}</div>
          <div class="text-muted-foreground text-xs">
            {c.handle ?? c.id} · {c.videoCount.toLocaleString()} videos
            {c.fetchedAt ? `· fetched ${new Date(c.fetchedAt).toLocaleDateString()}` : '· not scanned yet'}
          </div>
        </div>
        <!-- Phones: the buttons drop below the channel name, lined up with it. -->
        <div class="flex items-center gap-2 max-sm:w-full max-sm:pl-14">
        <Hint text={scanBlocked ?? 'Fetch this channel’s videos and check their links, without rescanning your other channels. Uses one of today’s full scans.'}>
          {#snippet children(props)}
            <!-- A wrapper keeps the tooltip reachable while the button is disabled: a disabled
                 button gets no hover or focus events, so the span is the trigger and takes focus instead. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <span {...props} tabindex={scanBlocked ? 0 : undefined}>
              <Button size="sm" variant={c.fetchedAt ? 'outline' : 'default'} disabled={!!scanBlocked} onclick={() => scanChannel(c.id)}>
                <RefreshCw /> {c.fetchedAt ? 'Rescan' : 'Scan'}
              </Button>
            </span>
          {/snippet}
        </Hint>
        <Button size="sm" variant="outline" href="https://www.youtube.com/channel/{c.id}" target="_blank" rel="noreferrer">
          <span class="hidden sm:inline">View on</span> YouTube <ExternalLink />
        </Button>
        <Button size="icon-sm" variant="ghost" class="max-sm:ml-auto" aria-label="Remove channel" onclick={() => remove(c.id, c.title)}><Trash /></Button>
        </div>
      </div>
    {:else}
      <div class="text-muted-foreground px-5 py-8 text-center text-sm">No channels yet.</div>
    {/each}
  </Card.Content>
  <Card.Footer class="border-t">
    <form class="flex w-full gap-2" onsubmit={add}>
      <Input placeholder="@handle or youtube.com channel link" bind:value={input} disabled={busy} />
      <Button type="submit" disabled={busy || !input.trim() || report.channels.length >= report.limits.maxChannels}>
        {busy ? 'Adding…' : 'Add channel'}
      </Button>
    </form>
  </Card.Footer>
</Card.Root>
