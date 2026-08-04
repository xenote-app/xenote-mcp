# Element Types

Every element has: { id, type, settings, edits }. Some also have content or entries. `edits` is the element's save counter — pass it as `expectedEdits` on update/patch for conflict detection. (Not to be confused with article versions, which are publish snapshots.)

## text
Rich text as HTML (NOT markdown).
- content: string (HTML)
- Tags: <p>, <h2>, <h3>, <strong>, <em>, <ul>, <li>, <ol>, <a>, <code>, <pre>, <br>, <math>, <table>
- <math> uses KaTeX syntax: `<math>x^2 + y^2 = z^2</math>` renders as inline math. Use standard LaTeX notation inside the tag.
- Every paragraph must be wrapped in <p> tags
- Prose splits like notebook cells — a few paragraphs per element.
- NEVER use markdown syntax (no #, **, -, backticks)
- settings: { alignment?, columns? (null|2|3), css? (""|"gray"), spellCheck? }

### Tables (inside text)
Tables live inside text elements as HTML. Shape:
```
<table>
  <tr><th><p>Header 1</p></th><th><p>Header 2</p></th></tr>
  <tr><td><p>cell</p></td><td><p>cell</p></td></tr>
</table>
```
- Every cell's inner content MUST be wrapped in `<p>` (cell content is `block+`).
- First row uses `<th>` for headers. Do NOT emit `<thead>` or `<tbody>` — the schema is flat.
- Tables span the content width with equal columns by default. To size a column, set `data-colwidth` (px) on its cells — e.g. `<th data-colwidth="200">` — leaving other columns to share the rest. Too-wide tables scroll horizontally.
- Other cell attributes: `colspan`, `rowspan`.
- No `align` attribute on cells. Alignment goes on the inner `<p>` via `class="text-center"` or `class="text-right"`.

## code
Container for file children — don't put code in content. See **xenote://guides/code-and-files** for full details.
- content: leave empty
- settings: { layout? ("collapsed"|""), isReadOnly? (false=editable, true=read-only, "hidden"=hidden on publish), title? (recommended — group label, e.g. "Components", "Utils") }
- layout: default to "collapsed" — shows the file list, expands to a full IDE on click. Use "" only when the code itself is part of the contextual reading (the prose walks through this code). Not a file-size decision.

## file
A file attached to a code or runner element. See **xenote://guides/code-and-files** for full details.
- Requires parentId pointing to a code or box-runner element
- content: string (file contents)
- settings: { filename (required), isPulled?, isBase64?, contentType? }

## web-runner
Browser-based runner for React/JS. See **xenote://guides/frontend** for full details.
- Create code + file elements first, then the runner targeting a .jsx file
- settings: { target (required, .jsx filename), importMap?, isChromeless?, autoHeight?, height?, layout? }

## box-runner
Server-side runner (Node, Python, etc). See **xenote://guides/backend** for full details.
- settings: { command (required, e.g. "node app.js"), autoHeight?, height? }

## kernel-runner
Python kernel runner. See **xenote://guides/backend** for full details.
- content: string (Python code) — no parentId needed
- settings: { tabMode?, hasLineNumbers?, lineWrapping?, maxOutputHeight? }

## images
Image gallery.
- entries: [{ filename (required, local filename (upload or pulled) or https URL), caption? }]
- settings: { galleryType? (null|"classic"), widthMode? ("small"|"medium"|"full"), aspectRatio? ("auto"|"1.7778"|"1.5000"|"1.3333"|"1.0000"), alignment? ("left"|"center"|"right"), hasBorder? }

## iframe
Embed external content.
- settings: { embedUrl (the URL), widthMode? ("small"|"medium"|"full"), aspectRatio? ("1.7778"|"1.6000"|"1.3333"|"1.0000"), alignment?, hasBorder? }

## excalidraw
Drawing/whiteboard canvas. Use this for diagrams, flowcharts, illustrations, and sketches.
- content: string (JSON.stringify of an Excalidraw elements array)
  - Each element has type ("rectangle", "ellipse", "arrow", "text", "line", "diamond", "freedraw"), x, y, width, height, strokeColor, backgroundColor, etc.
  - Example: JSON.stringify([{ type: "rectangle", x: 0, y: 0, width: 200, height: 100, strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "hachure", strokeWidth: 1, roughness: 0, id: "rect1", seed: 1 }])
- settings: { maxWidth? (100-900), percentWidth? (20-100), caption? (HTML string), alignment?, hasBorder?, hasPadding?, backgroundColor? }

## Default Settings
All element types have sensible defaults — you only need to provide settings you want to override. For example, a web-runner with just { target: "app.jsx" } gets all other settings (height, layout, importMap, etc.) filled in automatically.

## Guidelines
- In scroll layout, the article title already renders as h1 — don't add it again in a text element
