<script lang="ts">
  import type { Category } from '$shared/core';
  import { CATEGORY } from '$lib/categories';
  import Hint from './Hint.svelte';

  // `tooltip={false}` where the badge would steal focus (e.g. first element in a dialog).
  let { category, tooltip = true }: { category: Category; tooltip?: boolean } = $props();
  const meta = $derived(CATEGORY[category]);
  const cls = $derived(`inline-flex h-5 cursor-default items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap ${meta.cls}`);
</script>

{#if tooltip}
  <Hint text={meta.help} side="right">
    {#snippet children(props)}
      <button {...props} type="button" class={cls}>{meta.label}</button>
    {/snippet}
  </Hint>
{:else}
  <span class={cls} title={meta.help}>{meta.label}</span>
{/if}
