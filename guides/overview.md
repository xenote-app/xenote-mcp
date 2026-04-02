# Xenote Overview

Xenote is a browser-based computational notebook for education and research.

## Hierarchy
Workspace → Folders → Articles → Elements

An article is like a notebook: an ordered list of elements (content blocks).

## Element Model
- **Simple elements**: text, images, table, iframe, excalidraw — standalone content blocks
- **Code elements**: IDE containers that hold file elements (like a mini file explorer)
- **Runner elements**: execute code from file elements and display output

## The Creation Pattern
For anything that runs code:
1. Create a code element (the container)
2. Create file elements inside it (with parentId pointing to the code element)
3. Create a runner element targeting a file

## Two Execution Environments
- **Frontend** (web-runner): Renders React components in the browser. No backend needed. **Read the "frontend" guide before creating or modifying web-runners.**
- **Backend** (box-runner, kernel-runner): Executes shell commands or Python. Requires Baklava (local Node.js server). **Read the "backend" guide before creating or modifying box/kernel-runners.**

## Versions & Publishing
Articles have a **live working copy** (what you edit) and frozen **version snapshots**.

**Concepts:**
- **Version** = immutable snapshot of the article (all elements, files, uploads) at a point in time
- **Publish** = makes one version the live public version at /workspace-slug/article-slug
- An article can have many versions but only ONE published at a time
- Cross-article imports ONLY work against versioned content, not the live working copy
- The **Dependency Version Map** (DV Map) freezes import versions at publish time, so published code never breaks (see "frontend" guide for details)

**Workflow:**
1. version({ action: "create" }) → { versionId: "xyz", slug: "0.0.0-d.0" }  (label and slug auto-generate)
2. version({ action: "publish", versionId: "xyz" })
3. Now accessible at /workspace-slug/article-slug
4. Other articles can import: import { X } from '/workspace-slug/article-slug/file.js'

**Other version actions:**
- version({ action: "list" }) — see all versions of the current article
- version({ action: "revert", versionId: "xyz" }) — restore working copy to a version (destructive)

**Discovering published articles:**
- fetch({ path: "/my-workspace" }) — lists articles with isPublished flag
- public_fetch({ path: "/workspace-slug/article-slug" }) — fetches published article content

## Course Progression
Articles can require other articles to be completed before they unlock. Use `requiredArticles` in `article_update` to set prerequisites, and `markComplete` from `/core/completion/interface.js` in runners to mark articles done. See /references/mark-complete for details.

## Reading Content
- fetch returns **summaries** for file elements (filename + lineCount only)
- Use element_get(id) to read the full content of a specific file
- Use public_fetch to read anyone's published articles

## Running Code
When a browser tab is attached (via the presence indicator), fetching an article navigates the browser to it. Use element_run to execute a runner and get back status, errors, and console logs.

1. fetch the article first (this navigates the browser)
2. element_run({ articlePath, id }) to execute the runner

element_run returns { status, errorMessage, logs }. Use this to verify runners work without needing visual confirmation.

## Path Structure
- Live content: /workspace-slug/article-slug (editable, via fetch)
- Published: /workspace-slug/article-slug (read-only, via public_fetch)
- Imports: /workspace-slug/article-slug/file.js (resolves to published version)
- Pinned: /workspace-slug/article-slug@1.0.0/file.js (specific version)

## Combining Features

The real power of Xenote comes from composing its primitives together. Here are the key composition patterns:

**Compile-and-run**: box-runner compiles code (Rust, C, anything) → pull-back captures the output files → web-runner executes them in the browser.
Example: /references/rust-web-assembly (Rust → WASM → browser benchmark)

**Full-stack app**: web-runner for the UI + box-runner for backend logic + Vani request/response bridges them. The frontend can't do raw sockets or DB queries, but the backend can.
Example: /references/vani-simple-backend (domain availability checker with DNS + WHOIS)

**Hardware control**: web-runner for a control UI + Vani pub/sub + box-runner on a Raspberry Pi or IoT device.
Example: /references/vani-example-rpi-servo (servo motors controlled from the browser)

**Rich widgets**: combine widget APIs (editor data for persistence + file generation for exports + uploaded files for user content + isEditor for viewer/editor modes) to build real apps inside documents.
Example: /references/editor-example-stl-viewer (3D STL viewer with Three.js)

**Data collection widgets**: histogrammer for aggregate data + editor data for config + widget mode for clean UI.
Example: /references/survey (poll widget)

**Cross-article libraries**: publish utility code, then import it from anywhere. The DV Map freezes versions so published code never breaks.
Example: /references/simple-imports (importing isPrime and Graphite across articles)

## Working Examples
Fetch articles from /references for tutorials covering all element types.

If you're unsure what's possible or how to combine features, fetch /references to browse all published tutorials and examples.
