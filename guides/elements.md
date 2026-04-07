# Element Types

Every element has: { id, type, settings, version }. Some also have content or entries.

## text
Rich text as HTML (NOT markdown).
- content: string (HTML)
- Tags: <p>, <h2>, <h3>, <strong>, <em>, <ul>, <li>, <ol>, <a>, <code>, <pre>, <br>, <math>
- <math> uses KaTeX syntax: `<math>x^2 + y^2 = z^2</math>` renders as inline math. Use standard LaTeX notation inside the tag.
- Every paragraph must be wrapped in <p> tags
- NEVER use markdown syntax (no #, **, -, backticks)
- settings: { alignment?, columns? (null|2|3), css? (""|"gray"), spellCheck? }

## code
Container for file children — don't put code in content. See **xenote://guides/code-and-files** for full details.
- content: leave empty
- settings: { layout? ("collapsed"|""), isReadOnly? (false=editable, true=read-only, "hidden"=hidden on publish) }

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

## table
Editable data table.
- entries: { columns: [{ value, width, type ("text"|"number"), alignment, prefix?, suffix? }], rows: { 0: [{ value }, ...], 1: [...], ... } }
- settings: { styling? ("plain"|"striped"), filename? }

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
