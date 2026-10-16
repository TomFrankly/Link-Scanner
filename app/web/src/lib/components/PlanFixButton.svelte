<script lang="ts">
  // The "Plan fix" / "Change fix" button beside a link in the videos view and the description
  // drawer ("Change" on a link that works). It opens the same choices as the report's "…" menu (FixMenuItems).
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import FixMenuItems from './FixMenuItems.svelte';
  import { FIXABLE } from '$shared/fixes';
  import { data } from '$lib/store.svelte';
  import type { Row } from '$lib/types';

  let { row }: { row: Row } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} size="xs" variant="ghost" class="shrink-0">
        <Pencil />{data.fixes.has(row.url) ? 'Change fix' : FIXABLE.includes(row.cls.category) ? 'Plan fix' : 'Change'}<ChevronDown class="opacity-60" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-80">
    <FixMenuItems {row} />
  </DropdownMenu.Content>
</DropdownMenu.Root>
