# ⚠ Layout contract — published notes and the canvas

A note's canvas (sticky notes, shapes, arrows, pen strokes, highlights,
markdown blocks) is **pinned to lines of text**, not to pixels. Every element
stores an *anchor* (a quote of its line, with a little context) and an offset
`dy` from that line's top. Wherever the note is shown, the element is placed at
"the top of its line + dy".

That only works if **every place that shows the note puts each line in the same
spot**. Today there are two such places, and they must stay in lock-step:

| | Where the lines come from | Where the canvas is laid out |
|---|---|---|
| **Editor** (the app) | CodeMirror live preview — `client/src/styles/editor.css` (`.obi-editor`, `.cm-lp-*`) | `client/src/canvas/NoteCanvas.jsx` → `resolveLayout` |
| **Published page** (`/p/<slug>`) | `shared/markdown.js` with `sourceLines`, styled by `client/src/publish/publish.css` | `client/src/publish/main.js` → the same `resolveLayout` |

The published page does not approximate the editor: it runs the **same**
`resolveLayout` (`client/src/canvas/layout.js`) and the **same**
`resolveAnchor` (`client/src/canvas/anchors.js`), and answers their two
questions — *where is this line?* and *where is this text?* — from its own DOM.
So the layout logic cannot drift. What *can* drift is the typography, and that
is what this contract guards.

## The rules

1. **One source line = one line box.** Font, size, line-height and the width of
   the text column must match the author's editor. They travel with the link as
   a theme snapshot (`client/src/lib/themesnapshot.js`), including the
   *measured* column width.
2. **A blank source line = one line of space.** The editor gives every blank
   line a full line-height. The renderer marks each block with `data-gap` (the
   number of blank lines above it) and `publish.css` turns that into
   `margin-top: N × line`. Blocks have **no other vertical margins** — a margin
   would collapse into the gap and move every line below it.
3. **Every source line is findable.** Blocks carry `data-line` (their first
   source line); lines inside a paragraph get an `<span class="obi-ln">` marker
   after each line break; fences carry `data-line`/`data-line-end` on the
   `<pre>`. Nothing else may use `data-line` inside `#content`.
4. **Headings, code blocks, quotes, lists, rules and tables mirror live
   preview.** Heading `padding-top`/size/line-height, the code block's padding,
   the quote's border and indent, the bullet/number widths, the hairline rule —
   each rule in `publish.css` names the `.cm-lp-*` class it copies.
5. **x = 0 is the left edge of the text column**, y is measured from the
   column's top. The editor's `.cm-line` has 2px of horizontal padding; so
   does `#content`.
6. **Markdown text blocks use the editor font** — never the hand-drawn font's
   1.25× size boost or its line-height. `ElementView.textStyle`,
   `layout.measureMarkdown` and `boardsvg.textBlock` all follow this.

## Also: lines drawn out of a phrase end where the text ends

An arrow bound to a phrase leaves it through the gap between two lines of text,
runs along the gap only as far as the words it could otherwise cut, and then
turns towards its target (`textEnd` in `shared/boardgeom.js`). So that it ends in
the same place on both sides, `textRect` gives the layout, in world pixels:

- `ga` / `gb` — the middle of the free band above / below the phrase's rows;
- `col` — `[left, right]` of the text column;
- `reach(from, to)` — `[left, right]` of the words on the rows whose middle is
  within a line of height `from` (the rows either side of a gap) and on every
  row down to height `to`, or `null`. Both sides build it with
  `client/src/canvas/wordreach.js` from their own DOM: a word is a run of
  non-space characters, a line is the base line height (`defaultLineHeight` /
  zoom in the editor, `m.line` on the page) and the editor leaves out its remote
  cursors' labels.

Measure `reach` the same way on both sides, or a line ends one place in the
editor and another on the published page.

`reach` reports every word wherever it is, but `textEnd` only counts words
**inside `col`**: what lies beyond the column is not on show (the page scrolls a
long line of code or a wide table inside its block), and a run that went out for
it would shoot across the page and double back. The run along the gap never goes
further than ten past the edge of the column. That is a clamp, not parity: the
editor wraps code at the column where the page keeps one long row, so beside such
a block the two sides can still end a line in slightly different places (and the
lines below it already sit differently).

Two limits of `reach`, kept on purpose (it keeps a line off the words; it is not
a layout engine):

- **Only text counts.** Images, callout and quote boxes, embeds and diagrams are
  not words, so a bent line can still cross them.
- **The editor sees only the lines CodeMirror has rendered** (the ones near the
  screen). On a long note a route that passes far above or below the screen is
  measured on fewer rows than the published page measures (the whole note), so it
  can end in a different place there and shifts a little as you scroll.

## Also: no vertical margins on editor widgets

CodeMirror measures lines and block widgets by their border box. A vertical
`margin` on a widget (properties, tables, images, embeds…) sits outside that
box, so the editor's height map comes up short and **clicks land on the line
below**. Put spacing inside the box (padding, or a transparent border with
`background-clip: padding-box`). See the comments in `editor.css`.

## Before changing any of these files

`client/src/styles/editor.css` (`.obi-editor`, `.cm-lp-*`, widget spacing) ·
`client/src/publish/publish.css` · `client/src/publish/main.js` ·
`shared/markdown.js` (the `sourceLines` parts) · `server/public.js` (page and
routes) · `client/src/canvas/layout.js` (`resolveLayout`, `measureMarkdown`) ·
`client/src/canvas/anchors.js` · `client/src/canvas/wordreach.js` ·
`client/src/canvas/NoteCanvas.jsx` (`env`, `anchorFor`) ·
`client/src/canvas/ElementView.jsx` (`textStyle`) ·
`shared/boardsvg.js` (`textBlock`, `boardToSvg`) · `shared/boardgeom.js`
(`textEnd`) · `client/src/lib/themesnapshot.js`

1. Change the matching rule on the **other** side in the same commit.
2. Verify by eye: publish a note with a sticky next to a line, an arrow to a
   phrase, a highlight, and a shape beside a heading. Open the note and its
   `/p/<slug>` page side by side — every element must sit at the same offset
   from its line, and the text must wrap at the same words.
3. Run the integration suite.
