<script lang="ts" module>
  /** A click on a link chip. */
  export interface LinkClick {
    url: string;
    /** Where the link sits in the text. */
    from: number;
    to: number;
    /** Screen position of the link's start, for placing the popover. */
    left: number;
    top: number;
    bottom: number;
  }
</script>

<script lang="ts">
  // The plain-text editor in the Fix description drawer, built on CodeMirror 6. Descriptions
  // are plain text, so what you see is exactly what gets copied. On top of the text it draws:
  // - every URL as a chip (still ordinary text you can type in); clicking one calls `onlink`,
  //   which the drawer uses to open the link popover;
  // - highlights on each place the fixes changed (`needles`, found with highlightRanges, so
  //   they survive hand edits), tinted with the `tint` classes.
  // CodeMirror is loaded on first use, so it isn't in the main bundle.
  import { onMount } from 'svelte';
  import type { EditorView as View } from '@codemirror/view';
  import type { StateEffectType, AnnotationType } from '@codemirror/state';
  import { highlightRanges, urlsIn } from '$shared/fixes';

  let {
    value = $bindable(''),
    needles,
    tint,
    oninput,
    onlink,
  }: { value: string; needles: string[]; tint: string; oninput: () => void; onlink: (link: LinkClick) => void } = $props();

  type Marks = { needles: string[]; tint: string };
  let host = $state<HTMLDivElement>();
  let view = $state.raw<View>();
  // Set once CodeMirror has loaded: an effect that swaps the highlights, and a tag for changes
  // made from outside (so they don't count as the user typing).
  let setMarks: StateEffectType<Marks> | undefined;
  let external: AnnotationType<boolean> | undefined;

  onMount(() => {
    let gone = false;
    (async () => {
      const [{ EditorView, Decoration, keymap }, { EditorState, StateField, StateEffect, Annotation }, { history, historyKeymap, defaultKeymap }] =
        await Promise.all([import('@codemirror/view'), import('@codemirror/state'), import('@codemirror/commands')]);
      if (gone || !host) return;
      setMarks = StateEffect.define<Marks>();
      external = Annotation.define<boolean>();
      const marksEffect = setMarks;
      const externalTag = external;

      // Chips for links, then highlights for changes; `true` lets CodeMirror sort the ranges.
      const build = (doc: string, m: Marks) =>
        Decoration.set(
          [
            ...urlsIn(doc).map((u) => Decoration.mark({ class: 'cm-link' }).range(u.start, u.end)),
            ...highlightRanges(doc, m.needles).map((r) => Decoration.mark({ class: m.tint }).range(r.start, r.end)),
          ],
          true,
        );
      const marks = StateField.define<Marks>({
        create: () => ({ needles, tint }),
        update: (v, tr) => tr.effects.find((e) => e.is(marksEffect))?.value ?? v,
      });
      const decorations = StateField.define({
        create: (state) => build(state.doc.toString(), state.field(marks)),
        update: (deco, tr) =>
          tr.docChanged || tr.effects.some((e) => e.is(marksEffect)) ? build(tr.state.doc.toString(), tr.state.field(marks)) : deco,
        provide: (f) => EditorView.decorations.from(f),
      });

      view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: value,
          extensions: [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({ 'aria-label': 'Fixed description', spellcheck: 'false' }),
            marks,
            decorations,
            EditorView.updateListener.of((u) => {
              if (!u.docChanged || u.transactions.some((t) => t.annotation(externalTag))) return;
              value = u.state.doc.toString();
              oninput();
            }),
            EditorView.domEventHandlers({
              click(e, v) {
                if (!(e.target as HTMLElement).closest('.cm-link')) return false;
                const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
                const link = pos === null ? undefined : urlsIn(v.state.doc.toString()).find((u) => pos >= u.start && pos <= u.end);
                const at = link && v.coordsAtPos(link.start);
                if (link && at) onlink({ url: link.url, from: link.start, to: link.end, left: at.left, top: at.top, bottom: at.bottom });
                return false; // the caret still moves there, so the link can be typed in too
              },
            }),
            EditorView.theme({
              '&': { height: '100%', fontSize: '0.75rem' },
              '&.cm-focused': { outline: 'none' },
              '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.625', overflow: 'auto' },
              '.cm-content': { padding: '12px', caretColor: 'var(--foreground)' },
              '.cm-line': { padding: '0' },
              '.cm-link': {
                borderRadius: '4px',
                boxShadow: '0 0 0 1px var(--border)',
                backgroundColor: 'color-mix(in oklab, var(--muted) 80%, transparent)',
                cursor: 'pointer',
              },
              '.cm-link:hover': { boxShadow: '0 0 0 1px var(--ring)' },
            }),
          ],
        }),
      });
    })();
    return () => {
      gone = true;
      view?.destroy();
    };
  });

  // Text set from outside (another tab, a saved fix, Undo my edits) replaces the document.
  $effect(() => {
    const next = value;
    if (view && external && view.state.doc.toString() !== next)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, annotations: external.of(true) });
  });
  $effect(() => {
    const m = { needles, tint };
    if (view && setMarks) view.dispatch({ effects: setMarks.of(m) });
  });
</script>

<div bind:this={host} class="text-foreground absolute inset-0 overflow-hidden"></div>
