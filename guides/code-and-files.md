# Code & File Elements

## code element — the IDE container
Create this FIRST before adding any files.
- type: "code"
- settings.layout: "collapsed" — DEFAULT for nearly all cases. Shows the file list, expands to a full IDE on click. Keeps the article compact while the source stays one click away.
- settings.layout: "" — inline editor always visible. Use only when the code itself is part of the contextual reading (e.g. the prose teaches by walking through this code line by line). This is the exception, not the norm.
- Not a file-size decision.
- settings.isReadOnly: false (editable playground) | true (read-only) | "hidden" (not shown on the published page — use when readers don't need to see the code, e.g. app/experience pages)
- Other settings: autoHeight?, hasLineNumbers?, lineWrapping?, title? (group name)

A code element starts empty — add file elements inside it.

## file element — source files inside a code container
- type: "file"
- parentId: REQUIRED — must be the ID of a code element (or box-runner)
- settings.filename: REQUIRED — e.g. "app.jsx", "styles.css", "main.py"
- content: string (the source code)
- Creating a file without parentId will fail

## Relationships
- One code element can hold multiple file elements (tabbed file bar)
- Group related files under the same code element
- Deleting a code element also deletes all its child files

## Step-by-Step Pattern
1. element_create({ type: "code", settings: { layout: "collapsed" } })
   → returns { id: "abc" }
2. element_create({ type: "file", parentId: "abc", content: "...", settings: { filename: "app.jsx" } })
3. element_create({ type: "file", parentId: "abc", content: "...", settings: { filename: "styles.css" } })
4. Create a runner element targeting a file (see "frontend" or "backend" guides)

### Faster: elements_create (batch)
Build the whole scaffold in one call. Use '@<index>' to reference earlier batch items:
```
elements_create({ articlePath, elements: [
  { type: "code", settings: { layout: "collapsed" } },             // @0
  { type: "file", parentId: "@0", content: "...", settings: { filename: "app.jsx" } },
  { type: "file", parentId: "@0", content: "...", settings: { filename: "styles.css" } },
  { type: "web-runner", settings: { target: "app.jsx" } },
]})
```
Fails atomically: on any error, every element created so far is deleted.

## Multi-File Structure (IMPORTANT)
ALWAYS split code into separate files by concern. NEVER put all code in one file.
- Entry component (app.jsx) — 20-50 lines max, imports from other files
- Styles (styles.css) — always a separate CSS file
- Sub-components — separate .jsx file for each distinct UI piece
- Utilities/helpers — separate .js files for data, config, calculations
If a single file would exceed 80 lines, split it.

## Editing Files
- element_patch: exact string replacements (preferred for surgical edits)
- element_update: full content replacement (for settings changes or complete rewrites)

## Using element_patch (IMPORTANT)
Edits use search-and-replace: provide the exact text to find (old_string) and its replacement (new_string).

The edit will FAIL if old_string is not found in the content. If old_string appears more than once, include more surrounding context to make it unique, or set replace_all: true.

ALWAYS call element_get first to see current content before patching.

### Edit format
Replace: { old_string: "const x = 1;", new_string: "const x = 2;" }
Delete: { old_string: "const x = 1;\n", new_string: "" }
Insert after: { old_string: "const x = 1;", new_string: "const x = 1;\nconst y = 2;" }
Rename all: { old_string: "oldName", new_string: "newName", replace_all: true }
