# Cookbook Brainstorm

Ideas for what an agent can build with Xenote, organized by category.

## Education & Learning

1. **Research Paper → Interactive Explainer**
   - User pastes a paper/PDF. Agent creates article with summary text, interactive visualizations of key data, and a quiz widget.
   - Elements: text, code+web-runner (charts/diagrams), widget (quiz with editorData persistence)

2. **Topic → Brilliant-style Lesson**
   - User names a topic ("how RSA works"). Agent builds progressive sections: explanation → interactive simulation → next concept.
   - Elements: multiple text + code+web-runner pairs, each simulation building on the last

3. **Syllabus → Full Course**
   - User gives an outline. Agent creates a folder with multiple articles, shared utility library, cross-article imports, Completion API for progress tracking.
   - Elements: folder, multiple articles, cross-article imports, markComplete/fetchIsComplete

4. **Textbook Chapter → Study Guide**
   - Agent takes dense material and creates a condensed article with key formulas (KaTeX math), worked examples as interactive runners, and a practice problem widget.
   - Elements: text with <math>, web-runner for step-by-step solvers, widget for practice

5. **Concept → Visual Proof / Geometric Intuition**
   - Agent builds an interactive geometric or visual demonstration (e.g., "why does the area of a circle = πr²?") using animated React components.
   - Elements: text, code+web-runner with canvas/SVG animations

6. **Language Learning Lesson**
   - Agent creates vocabulary cards, sentence builders, and pronunciation guides as interactive widgets. Could use Gen AI API for generating example sentences on the fly.
   - Elements: widget (flashcard app), web-runner with Gen AI API

7. **Math Problem Set Generator**
   - Widget that generates random problems of a given type, checks answers, tracks score via editorData.
   - Elements: widget with editorData for config, Gen AI for variation

## Data & Analysis

8. **CSV/Data → Dashboard**
   - User describes a dataset. Agent creates an article with data tables, interactive chart components (bar, line, scatter), and filter controls.
   - Elements: table, code+web-runner (chart components with importMap for chart libraries)

9. **API Explorer**
   - Agent builds a live API playground — form inputs for parameters, fetch calls, formatted response display. Reader can experiment with different endpoints.
   - Elements: web-runner with fetch calls, text explaining each endpoint

10. **Algorithm Visualizer**
    - Agent builds step-by-step visualizations of algorithms (sorting, graph traversal, tree operations). User can control speed, input data.
    - Elements: web-runner with SVG/canvas animations, state stepping controls

11. **Data Story / Scrollytelling**
    - Agent creates a narrative article where each section reveals a new insight with an accompanying visualization. Progressive disclosure through scroll.
    - Elements: alternating text + web-runner pairs, each runner showing a different view of the data

## Tools & Utilities

12. **Color Palette Generator**
    - Widget that generates harmonious color palettes. Author configures base colors via editorData, readers see the palette with copy-to-clipboard.
    - Elements: widget (isWidget, editorData, isEditor for config vs display)

13. **Regex Tester**
    - Interactive regex playground — input pattern, test strings, highlighted matches, explanation of groups.
    - Elements: web-runner with autoHeight

14. **JSON/YAML Formatter**
    - Paste-in formatter and validator with syntax highlighting and error reporting.
    - Elements: web-runner

15. **Code Snippet Library**
    - Agent creates organized collection of code snippets with descriptions, copy buttons, and categorization. Published as a reference.
    - Elements: multiple code elements (expanded), text descriptions, version+publish

16. **Unit Converter**
    - Interactive converter widget covering common units (length, weight, temperature, etc).
    - Elements: widget with autoHeight

## Creative & Design

17. **Diagram / Flowchart Builder**
    - Agent creates Excalidraw diagrams based on user description (system architecture, process flows, org charts).
    - Elements: excalidraw with programmatic element generation

18. **Interactive Story / Choose Your Own Adventure**
    - Widget-based branching narrative. editorData stores the story tree, reader makes choices, state persists.
    - Elements: widget with editorData for story structure, isEditor for author editing

19. **Mood Board / Visual Reference Collection**
    - Agent assembles images, color swatches, and typography samples into a visual reference article.
    - Elements: images (gallery), text, web-runner for color swatches

20. **Presentation / Slide Deck**
    - Agent creates a slide-based presentation as a widget. Each "slide" is a full-screen view with text, images, code examples. Arrow keys navigate.
    - Elements: widget (full presentation app), editorData for slide content

## Documentation & Reference

21. **API Documentation Generator**
    - Agent creates structured API docs with endpoint descriptions, parameter tables, example requests/responses, and a live "try it" runner.
    - Elements: text (descriptions), table (parameters), code elements (examples), web-runner (try-it playground)

22. **Changelog / Release Notes**
    - Agent creates a versioned changelog article. Each update adds new content, creates a version snapshot. Previous versions accessible via public_fetch with @slug.
    - Elements: text, version snapshots, publishing

23. **Architecture Decision Record (ADR)**
    - Structured document with context, decision, consequences. Excalidraw for architecture diagrams. Published for team reference.
    - Elements: text, excalidraw, version+publish

24. **Component Library Showcase**
    - Agent builds a living style guide — each component rendered in a web-runner with props controls, alongside usage documentation.
    - Elements: multiple code+web-runner pairs, text descriptions

## Science & Engineering

25. **Physics Simulation Lab**
    - Interactive simulations (projectile motion, pendulums, wave interference). Sliders control parameters, real-time canvas rendering.
    - Elements: web-runner with canvas, importMap for physics libraries

26. **Circuit Simulator**
    - Visual circuit builder or pre-built circuit with adjustable components. Shows voltage, current, waveforms.
    - Elements: web-runner with SVG components

27. **Chemistry Molecule Viewer**
    - 3D molecule visualization using Three.js. Agent generates molecular geometry from a compound name.
    - Elements: web-runner with importMap for Three.js

28. **Statistical Distribution Explorer**
    - Interactive tool showing different probability distributions. Adjust parameters, see PDF/CDF, sample data.
    - Elements: web-runner with SVG charts

## Productivity & Planning

29. **Meeting Notes → Action Items Dashboard**
    - User pastes meeting notes. Agent extracts action items, creates a structured article with tables (who, what, when) and status tracking widget.
    - Elements: text (summary), table (action items), widget (status tracker with editorData)

30. **Project Kickoff Document**
    - Agent creates a structured project doc: goals, timeline (table), architecture (excalidraw), tech decisions (text), and a prototype (web-runner).
    - Elements: text, table, excalidraw, code+web-runner

## AI-Powered (using Gen AI API)

31. **Interactive Tutor**
    - Widget that acts as a subject-matter tutor. Reader asks questions, gets explanations powered by Gen AI. Context is the article content itself.
    - Elements: widget with Gen AI API (generateText), editorData for conversation history

32. **Writing Assistant / Editor**
    - Widget where reader pastes text, gets AI-powered feedback (grammar, style, clarity). Uses Gen AI API.
    - Elements: widget with Gen AI API

33. **Flashcard Generator with AI**
    - Reader provides a topic or pastes notes. Widget generates flashcards via Gen AI, then presents them in spaced-repetition style. Cards persist in editorData.
    - Elements: widget with Gen AI API, editorData for card deck

## Multi-Article Compositions

34. **Reusable Chart Library**
    - Agent builds a library article with chart components (BarChart, LineChart, PieChart). Publishes it. Other articles import and use them.
    - Elements: code+files, version+publish, cross-article imports from consumer articles

35. **Design System / Token Library**
    - Agent creates a published article with CSS variables, color tokens, typography scales. All other articles in the workspace import from it for consistent styling.
    - Elements: code+files (CSS + JS exports), version+publish, cross-article imports

36. **Multi-Part Tutorial Series**
    - Folder with sequenced articles. Each article imports shared utilities from a "core" article. Completion API tracks which parts the reader has finished.
    - Elements: folder, multiple articles, cross-article imports, Completion API

## Backend-Powered (box-runner / kernel-runner)

37. **Data Analysis Notebook**
    - Jupyter-style data exploration with kernel-runner cells. Load data, compute stats, generate plots.
    - Elements: kernel-runner cells (Python), text explanations

38. **Compile-and-Run Demo (WASM, etc)**
    - box-runner compiles source code (Rust, C, Go) → pulled files capture output → web-runner executes in browser.
    - Elements: code+files, box-runner, pulled files (isPulled), web-runner

39. **CLI Tool Documentation**
    - Interactive terminal showing command examples. box-runner with `bash` for interactive mode. Text explains each command.
    - Elements: text, box-runner (interactive bash)

## Widget Showcase

40. **Poll / Survey Widget**
    - Author configures questions via editorData. Readers vote. Results aggregate (histogrammer).
    - Elements: widget with editorData, isEditor for config

41. **Drawing / Whiteboard Widget**
    - Canvas-based drawing tool. Author can set background image, readers draw on it. Saved via editorData.
    - Elements: widget with canvas, editorData

42. **Audio Player / Podcast Widget**
    - Uses selectUploadFile to pick uploaded audio. Displays waveform, playback controls. isEditor shows file picker, viewers see player only.
    - Elements: widget with selectUploadFile, isEditor

43. **3D Model Viewer**
    - Three.js viewer for STL/OBJ files. Author uploads model via article uploads, widget loads it via selectUploadFile.
    - Elements: widget with Three.js importMap, selectUploadFile

44. **File Export Widget**
    - Widget that generates downloadable files (PDF reports, CSV exports, images). Uses saveEditorFile + editEditorFilename.
    - Elements: widget with file generation API

---

## Raw Capability Inventory (for reference)

### What the agent CAN do without user help:
- Create/delete articles and folders
- Create any element type (text, code, files, runners, images, tables, excalidraw, iframes)
- Edit element content and settings
- Read article content and file contents
- Create version snapshots and publish/unpublish
- Set widget editorData programmatically
- Create child files on web-runners
- Set article context and workspace context

### What REQUIRES user action:
- Connecting a machine (for box-runner / kernel-runner)
- Running box-runner / kernel-runner (needs connected machine)
- Managing env vars and personal keys
- Uploading files to articles
- Triggering widget UI interactions (canvas rendering, etc.)
- Web-runner execution happens in browser — agent can create but not "see" output

### Frontend-only (no machine needed):
- text, images, table, iframe, excalidraw — always work
- code + files — always work (just code storage)
- web-runner — always works (runs in browser)
- widgets — always work
- Gen AI API — works if reader has credits
- Completion API — always works
- Cross-article imports — works if source is published

### Backend (needs machine):
- box-runner — needs Baklava
- kernel-runner — needs Baklava + Jupyter kernel
- Vani — needs both frontend runner + backend runner
