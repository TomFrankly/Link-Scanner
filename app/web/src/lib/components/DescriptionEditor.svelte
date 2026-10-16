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
  /** Selected text, for the quick edit bar; screen positions of its start and end. */
  export interface TextSelection {
    text: string;
    from: number;
    to: number;
    left: number;
    top: number;
    bottom: number;
  }
  /** A problem link without a planned fix: drawn with a colored outline and a tag naming the problem. */
  export interface Flag {
    url: string;
    reason: string;
    tone: 'red' | 'amber';
  }
</script>

<script lang="ts">
  // The plain-text editor in a video's Description tab (DescriptionPanel), built on CodeMirror 6. Descriptions
  // are plain text, so what you see is exactly what gets copied. On top of the text it draws:
  // - every URL as a chip (still ordinary text you can type in); clicking one calls `onlink`,
  //   which the panel uses to open the link popover (Cmd/Ctrl-click opens the link instead);
  // - highlights on each place the fixes changed (`needles`, found with highlightRanges, so
  //   they survive hand edits), tinted with the `tint` classes;
  // - problem links nobody has planned a fix for (`flagged`): an outlined chip plus a tag after
  //   it ("broken", "redirects to …"). The tag isn't part of the text, so it's never copied.
  // Selecting text calls `onselect` (once the mouse is released), for the quick edit bar.
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
    flagged = [],
    oninput,
    onlink,
    onselect,
  }: {
    value: string;
    ready?: boolean;
    needles: string[];
    tint: string;
    flagged?: Flag[];
    oninput: () => void;
    onlink: (link: LinkClick) => void;
    onselect?: (sel: TextSelection | null) => void;
  } = $props();

  type Marks = { needles: string[]; tint: string; flagged: Flag[] };
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
      const [{ EditorView, Decoration, WidgetType, keymap }, { EditorState, StateField, StateEffect, Annotation }, { history, historyKeymap, defaultKeymap }] =
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

      // The tag after a flagged link. Clicking it opens the link's popover, like the chip.
      // Declared here because WidgetType only exists once CodeMirror has loaded (once per editor).
      // svelte-ignore perf_avoid_nested_class
      class FlagTag extends WidgetType {
        flag: Flag;
        at: number;
        constructor(flag: Flag, at: number) {
          super();
          this.flag = flag;
          this.at = at;
        }
        eq(other: FlagTag) {
          return other.flag.reason === this.flag.reason && other.flag.tone === this.flag.tone && other.at === this.at;
        }
        toDOM() {
          const tag = document.createElement('span');
          tag.className = `cm-flagtag cm-flagtag-${this.flag.tone}`;
          tag.dataset.at = String(this.at);
          tag.textContent = this.flag.reason;
          tag.title = 'No fix planned. Click to fix it.';
          return tag;
        }
        ignoreEvent() {
          return false;
        }
      }
      // Chips for links (flagged ones outlined, with a tag), then highlights for changes; `true`
      // lets CodeMirror sort the ranges.
      const build = (doc: string, m: Marks) => {
        const flags = new Map(m.flagged.map((f) => [f.url, f]));
        return Decoration.set(
          [
            ...urlsIn(doc).flatMap((u) => {
              const f = flags.get(u.url);
              if (!f) return [Decoration.mark({ class: 'cm-link', attributes: { title: 'Click to change · ⌘/Ctrl-click to open' } }).range(u.start, u.end)];
              return [
                Decoration.mark({ class: `cm-link cm-link-${f.tone}`, attributes: { title: `No fix planned: ${f.reason}. Click to fix it.` } }).range(u.start, u.end),
                Decoration.widget({ widget: new FlagTag(f, u.start), side: 1 }).range(u.end),
              ];
            }),
            ...highlightRanges(doc, m.needles).map((r) => Decoration.mark({ class: m.tint }).range(r.start, r.end)),
          ],
          true,
        );
      };
      const marks = StateField.define<Marks>({
        create: () => ({ needles, tint, flagged }),
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
              if (u.selectionSet || u.docChanged) reportSelection(u.view);
              if (!u.docChanged || u.transactions.some((t) => t.annotation(externalTag))) return;
              value = u.state.doc.toString();
              oninput();
            }),
            EditorView.domEventHandlers({
              mousedown() {
                selecting = true;
                onselect?.(null);
                return false;
              },
              click(e, v) {
                const target = e.target as HTMLElement;
                const tag = target.closest<HTMLElement>('.cm-flagtag');
                if (!tag && !target.closest('.cm-link')) return false;
                const pos = tag ? Number(tag.dataset.at) : v.posAtCoords({ x: e.clientX, y: e.clientY });
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
              // Flagged links: outlined in the status color, with a small tag after them.
              '.cm-link-red, .cm-link-red:hover': { boxShadow: '0 0 0 1.5px #d03b3b' },
              '.cm-link-amber, .cm-link-amber:hover': { boxShadow: '0 0 0 1.5px #e09b00' },
              '.cm-flagtag': {
                display: 'inline-block',
                marginLeft: '6px',
                padding: '0 6px',
                borderRadius: '9999px',
                fontFamily: 'var(--font-sans)',
                fontSize: '0.6875rem',
                lineHeight: '1.25rem',
                verticalAlign: 'baseline',
                cursor: 'pointer',
                userSelect: 'none',
              },
              '.cm-flagtag-red': { color: '#b42d2d', backgroundColor: 'color-mix(in oklab, #d03b3b 14%, transparent)' },
              '.cm-flagtag-amber': { color: '#8a5a00', backgroundColor: 'color-mix(in oklab, #fab219 24%, transparent)' },
              ':root.dark & .cm-flagtag-red': { color: '#f07070' },
              ':root.dark & .cm-flagtag-amber': { color: '#fac34d' },
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
    // A drag-select reports its selection once the mouse is released.
    const up = () => {
      if (!selecting) return;
      selecting = false;
      if (view) reportSelection(view);
    };
    window.addEventListener('mouseup', up);
    return () => {
      gone = true;
      window.removeEventListener('mouseup', up);
      view?.destroy();
    };
  });

  // ---- selection, for the quick edit bar ----
  let selecting = false; // mouse held down in the editor
  const MAX_SELECTION = 1000;
  function reportSelection(v: View) {
    if (!onselect || selecting) return;
    const r = v.state.selection.main;
    const text = v.state.sliceDoc(r.from, r.to);
    if (r.empty || !text.trim() || text.length > MAX_SELECTION) return onselect(null);
    const a = v.coordsAtPos(r.from);
    const b = v.coordsAtPos(r.to, -1);
    if (!a || !b) return onselect(null);
    onselect({ text, from: r.from, to: r.to, left: a.left, top: a.top, bottom: b.bottom });
  }

  // Text set from outside (another tab, a saved fix, Undo my edits) replaces the document.
  $effect(() => {
    const next = value;
    if (view && external && view.state.doc.toString() !== next)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, annotations: external.of(true) });
  });
  $effect(() => {
    const m = { needles, tint, flagged };
    if (view && setMarks) view.dispatch({ effects: setMarks.of(m) });
  });
</script>

<div bind:this={host} class="text-foreground h-full"></div>
