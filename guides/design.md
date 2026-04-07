# Design Guide

## Read this first

Before building any interactive content, read in order:
1. `overview` - hierarchy, element types, execution environments
2. `elements` - what goes in text vs runner vs table
3. `frontend` - runner creation, file splitting, isChromeless
4. This guide - theming, layout, core imports

---

## Article structure

Prose lives in text elements. Interactive content lives in web runners. Code goes at the bottom.

```
[text]              intro and concept explanation
[web-runner]        interactive app
[text]              next concept
[web-runner]        next app
...
── bottom ──────────────────────────────
[code collapsed]    source for app 1
[code collapsed]    source for app 2
```

Never put explanatory prose inside a React component. If you find yourself writing a `<p>` tag inside a runner, it belongs in a text element instead.

---

## Page width

Articles have two width options set at creation or via `article_update`:

- `normal` - 52rem (default, good for prose-heavy articles)
- `wide` - 64rem (better for data-heavy or multi-column layouts)

Prose text elements are automatically capped at 80ch. Runners span the full column width.

---

## Runner settings for embedded apps

Every document-embedded runner:

```js
isChromeless: true   // strips toolbar and console, blends into document
autoHeight: true     // expands to fit content
```

Without `isChromeless`, the runner renders with a toolbar that breaks the document feel.

---

## Core stylesheet imports

Importable from `/core/style/`. Always import `base.css`. Add others as needed.

```js
import '/core/style/base.css';           // always - reset, colors, typography, forms
import '/core/style/utils.css';          // optional - layout and spacing utilities
import '/core/style/components.css';     // optional - buttons, cards, tables, badges
```

Optional background tints (pick one or neither):
```js
import '/core/style/warm.css';           // warm cream tint
import '/core/style/cool.css';           // cool blue-grey tint
```

`base.css` provides reset, color system with dark mode, typography wired to workspace fonts, form styling, and design tokens (spacing, radius). All colors use oklch.

---

## CSS variables

Colors (defined in base.css, dark mode automatic):
```css
--doc-bg              --doc-bg-subtle
--doc-text            --doc-text-secondary    --doc-text-muted
--doc-border          --doc-link
--doc-accent          --doc-accent-h          --doc-accent-c
```

Fonts (injected by host from workspace theme):
```css
--doc-font            --doc-font-header       --doc-font-mono
```

Never hardcode colors or font names. Use `--doc-*` variables.

Derive accent shades in CSS:
```css
background: oklch(0.95 calc(var(--doc-accent-c) * 0.2) var(--doc-accent-h));
```

---

## Backgrounds

Default body uses `var(--doc-bg)`. For seamless blending into the document:
```css
body { background: transparent; }
```

---

## Dark mode

Handled automatically by `base.css`. All `--doc-*` colors swap. Use only these variables and dark mode is free.

For JS: `window.matchMedia('(prefers-color-scheme: dark)').matches`

---

## JS theme access

```js
window.xenote.theme.font         // body font family
window.xenote.theme.fontHeader   // header font family
window.xenote.theme.fontMono     // mono font family
window.xenote.theme.accentH      // accent hue (0-360)
window.xenote.theme.accentC      // accent chroma (0-0.4)
```

Use for canvas rendering where CSS vars don't reach.

---

## Canvas

CSS vars don't reach canvas draw calls. Use the JS theme:

```js
const { accentH, accentC } = window.xenote.theme;
const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
ctx.fillStyle = `oklch(0.55 ${accentC} ${accentH})`;
```

Size the canvas from the container, not from CSS:
```js
const width = canvasRef.current.parentElement.clientWidth;
canvas.width = width;
canvas.height = width * 0.5;
```

---

## Signaling interactivity

`isChromeless` blends the runner into the document - readers need to know it's interactive. Use contextual signals:

- Import `warm.css` or `cool.css` for a subtle tinted background that separates from prose
- Visible controls (slider, button) - communicate interactivity directly
- `cursor: pointer` or `cursor: grab` on interactive elements

Use `transparent` background only for decorative content that should feel like prose.

---

## Pre-flight checklist

- [ ] `isChromeless: true` and `autoHeight: true` on the runner
- [ ] `import '/core/style/base.css'` in app.jsx
- [ ] No hardcoded colors or fonts
- [ ] No `max-width` or centering on root element
- [ ] Canvas uses `window.xenote.theme` for colors
- [ ] Tested dark and light mode
- [ ] Tested with warm and cool accent colors
