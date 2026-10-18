<script lang="ts">
  // The "Plan fix" / "Change fix" button beside a link in the Videos view ("Change" on a link
  // that works). It opens the same choices as the report's "…" menu (FixMenuItems).
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import FixMenuItems from './FixMenuItems.svelte';
  import { FIXABLE } from '$shared/fixes';
  import { data } from '$lib/store.svelte';
  import type { Row } from '$lib/types';

  let { row, video = null }: { row: Row; /** In one video's view, judge that video alone. */ video?: { id: string; channelId: string } | null } = $props();
  // Saved edits took the link out of the drafts (all its videos, or this one), with no planned fix.
  const edited = $derived.by(() => {
    if (data.fixes.has(row.url)) return false;
    const out = data.editedOut.get(row.url);
    return !!out && (video ? out.has(video.id) : row.videos.every((v) => out.has(v.id)));
  });
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} size="xs" variant="ghost" class="shrink-0" title={edited ? 'Your saved edits took this link out of the description. Plan a fix only if you want one anyway.' : undefined}>
        <Pencil />{data.fixes.has(row.url) ? 'Change fix' : edited ? 'Removed by edits' : FIXABLE.includes(row.cls.category) ? 'Plan fix' : 'Change'}<ChevronDown class="opacity-60" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-80">
    <FixMenuItems {row} />
  </DropdownMenu.Content>
</DropdownMenu.Root>
