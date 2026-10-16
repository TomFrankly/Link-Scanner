<script lang="ts">
  // A drag handle between two side-by-side panes. Dragging (or arrow keys while focused) changes
  // `size`, the width in px of the pane on its left; double-click puts back `initial`. It sits on
  // the dividing line, so it adds no width of its own.
  let {
    size = $bindable(),
    min,
    max,
    initial,
    label,
  }: { size: number; min: number; max: number; initial: number; label: string } = $props();

  const clamp = (n: number) => Math.round(Math.min(Math.max(n, min), Math.max(min, max)));
  let dragging = $state(false);

  function down(e: PointerEvent) {
    e.preventDefault();
    const start = e.clientX;
    const from = size;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    dragging = true;
    const move = (ev: PointerEvent) => (size = clamp(from + ev.clientX - start));
    const up = () => {
      dragging = false;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') size = clamp(size - step);
    else if (e.key === 'ArrowRight') size = clamp(size + step);
    else return;
    e.preventDefault();
  }
</script>

<!-- While dragging, a full-window layer keeps the cursor and stops text getting selected. -->
{#if dragging}<div class="fixed inset-0 z-50 cursor-col-resize select-none"></div>{/if}
<!-- A focusable separator is the ARIA "window splitter" pattern, which Svelte's checks don't know. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  aria-valuenow={size}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  title="Drag to resize · double-click to reset"
  class="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none"
  onpointerdown={down}
  ondblclick={() => (size = clamp(initial))}
  onkeydown={key}
>
  <div
    class="mx-auto h-full w-px transition-colors duration-150 group-hover:bg-ring group-focus-visible:bg-ring {dragging ? 'bg-ring' : 'bg-border'}"
  ></div>
</div>
