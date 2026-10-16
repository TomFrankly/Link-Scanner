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
  // The plain-text editor in a video's Description tab (DescriptionPanel), built on CodeMirror 6. Descriptions
  // are plain text, so what you see is exactly what gets copied. On top of the text it draws:
  // - every URL as a chip (still ordinary text you can type in); clicking one calls `onlink`,
  //   which the panel uses to open the link popover (Cmd/Ctrl-click opens the link instead);
  // - highlights on each place the fixes changed (`needles`, found with highlightRanges, so
  //   they survive hand edits), tinted with the `tint` classes.
  // `reveal` scrolls to a piece of text and briefly highlights its line (the locate
  // buttons). CodeMirror is loaded on first use, so it isn't in the main bundle.
  import { onMount } from 'svelte';
  import type { EditorView as View } from '@codemirror/view';
  import type { StateEffectType, AnnotationType } from '@codemirror/state';
  import { highlightRanges, urlsIn } from '$shared/fixes';

  let {
    value = $bindable(''),
    ready = $bindable(false),
    needles,
    tint,
    oninput,
    onlink,
  }: { value: string; ready?: boolean; needles: string[]; tint: string; oninput: () => void; onlink: (link: LinkClick) => void } = $props();

  type Marks = { needles: string[]; tint: string };
  let host = $state<HTMLDivElement>();
  let view = $state.raw<View>();
  // Set once CodeMirror has loaded: an effect that swaps the highlights, and a tag for changes
  // made from outside (so they don't count as the user typing).
  let setMarks: StateEffectType<Marks> | undefined;
  let external: AnnotationType<boolean> | undefined;
  // Set once loaded: scrolls to and flashes the line at a position.
  let flashAt: ((pos: number) => void) | undefined;

  /** Scrolls to the first of `texts` found in the editor and flashes its line. Returns whether one was found. */
  export function reveal(texts: string[]): boolean {
    if (!view || !flashAt) return false;
    const doc = view.state.doc.toString();
    for (const t of texts) {
      const at = t ? doc.indexOf(t) : -1;
      if (at === -1) continue;
      flashAt(at);
      return true;
    }
    return false;
  }

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

      // A short-lived highlight on one line; null clears it.
      const flash = StateEffect.define<number | null>();
      const flashed = StateField.define({
        create: () => Decoration.none,
        update(deco, tr) {
          for (const e of tr.effects)
            if (e.is(flash)) return e.value === null ? Decoration.none : Decoration.set([Decoration.line({ class: 'cm-flash' }).range(e.value)]);
          return deco.map(tr.changes);
        },
        provide: (f) => EditorView.decorations.from(f),
      });
      let flashTimer: ReturnType<typeof setTimeout> | undefined;
      flashAt = (pos) => {
        if (!view) return;
        const line = view.state.doc.lineAt(pos);
        view.dispatch({ effects: [flash.of(line.from), EditorView.scrollIntoView(pos, { y: 'center' })], selection: { anchor: pos } });
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => view?.dispatch({ effects: flash.of(null) }), 1600);
      };

      // Chips for links, then highlights for changes; `true` lets CodeMirror sort the ranges.
      const build = (doc: string, m: Marks) =>
        Decoration.set(
          [
            ...urlsIn(doc).map((u) => Decoration.mark({ class: 'cm-link', attributes: { title: 'Click to change · ⌘/Ctrl-click to open' } }).range(u.start, u.end)),
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
            flashed,
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
                if (link && (e.metaKey || e.ctrlKey)) {
                  window.open(link.url, '_blank', 'noopener,noreferrer');
                  return true;
                }
                const at = link && v.coordsAtPos(link.start);
                if (link && at) onlink({ url: link.url, from: link.start, to: link.end, left: at.left, top: at.top, bottom: at.bottom });
                return false; // the caret still moves there, so the link can be typed in too
              },
            }),
            EditorView.theme({
              // Fills its box and scrolls inside it, so the links list beside it stays put.
              '&': { fontSize: '0.75rem', height: '100%' },
              '&.cm-focused': { outline: 'none' },
              '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.625', overflow: 'auto', overscrollBehavior: 'contain' },
              '.cm-content': { padding: '12px', minHeight: '6rem', caretColor: 'var(--foreground)' },
              '.cm-line': { padding: '0' },
              '.cm-link': {
                borderRadius: '4px',
                boxShadow: '0 0 0 1px var(--border)',
                backgroundColor: 'color-mix(in oklab, var(--muted) 80%, transparent)',
                cursor: 'pointer',
              },
              '.cm-link:hover': { boxShadow: '0 0 0 1px var(--ring)' },
              '.cm-flash': { animation: 'cm-flash 1.6s ease-out' },
              '@keyframes cm-flash': {
                from: { backgroundColor: 'color-mix(in oklab, var(--ring) 45%, transparent)' },
                to: { backgroundColor: 'transparent' },
              },
            }),
          ],
        }),
      });
      ready = true;
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

<div bind:this={host} class="text-foreground h-full"></div>
