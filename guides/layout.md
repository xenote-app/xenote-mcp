# Article Layouts

Articles have two layout types: **scroll** (default) and **grid**.

Set layout when creating an article:
```
folder({ action: "createArticle", path: "/workspace", title: "My Article", slug: "my-article", layoutType: "scroll" })
```

Or change an existing article:
```
article_update({ articlePath: "/workspace/my-article", layoutType: "grid" })
```

## Scroll layout

Elements stack vertically in order. Use `element_create` with `afterId` to control position, or `element_move` to reorder. This is the default and works for most articles.

## Grid layout

Positions elements on a 12-column grid. Use for spatial arrangements (dashboards, side-by-side comparisons, etc).

### Positioning elements

Each element's position is stored in `layout.grid.elements` as `{ x, y, w, h }`:
- **x**: column (0-based, 0–11)
- **y**: row (0-based, no max)
- **w**: width in columns (1–12)
- **h**: height in rows

Set positions via `article_update` with `layoutConfig.grid.elements`:
```
article_update({
  articlePath: "/workspace/my-grid",
  layoutConfig: {
    grid: {
      elements: {
        "element-id-1": { id: "element-id-1", x: 0, y: 0, w: 6, h: 4 },
        "element-id-2": { id: "element-id-2", x: 6, y: 0, w: 6, h: 4 }
      }
    }
  }
})
```

Positions are **merged** — updating one element's position won't affect others.

### Grid config

Default cell sizing works for most cases. To customize:
```
article_update({
  articlePath: "/workspace/my-grid",
  layoutConfig: {
    grid: {
      config: { cellSize: { width: 16, height: 14 }, cellGap: { x: 4, y: 4 } }
    }
  }
})
```

### Workflow

1. Create elements normally (`element_create`) — you'll get a warning to set position
2. Position them with `article_update({ layoutConfig: { grid: { elements: { ... } } } })`
3. Elements without a grid position will be invisible — always position new elements

### Common grid layouts

**Two columns**: x=0 w=6 and x=6 w=6
**Three columns**: x=0 w=4, x=4 w=4, x=8 w=4
**Full width**: x=0 w=12
**Sidebar**: x=0 w=8 (main) and x=8 w=4 (sidebar)
