# Frontend — Web Runner

Web runner renders React components in an iframe. No backend needed.

## Required Creation Order
1. Create a code element → returns { id }
2. Create file elements with parentId set to code element ID
3. Create a web-runner with settings.target set to the entry filename

## Settings
- target: filename to render (must default-export a React component, .jsx)
- importMap?: { "package": "https://esm.sh/package" } — for external dependencies
- isWidget?: widget mode — strips UI chrome, renders output only
- autorun?: auto-run on published page (default true)

### Height
- autoHeight: true → runner expands to fit content (recommended for most cases)
- height: pixel height, used as starting/fixed height when autoHeight is false (default 320)

## Rules
- Target file must be .jsx with a default-exported React component
- All files use ESM (import/export)
- Extension required on all imports: import X from './utils.js'
- React is auto-available — do NOT import React
- react (for hooks) and react-dom are built-in — do NOT add to importMap
- .css imports work: import './styles.css'
- Cannot use .html files — web-runner is React-only

## Import Map
Add external dependencies the runner doesn't include by default:
settings.importMap: { "three": "https://esm.sh/three" }

## Lucide Icons
import Icon from 'https://unpkg.com/lucide-react@0.356.0/dist/esm/icons/icon-name.js'

## Cross-Article Imports
Import files from other articles that have a published version:
import { Chart } from '/workspace-slug/article-slug/charts.js';
- **IMPORTANT**: The source article MUST be published first (version_create + version_publish). Unpublished articles cannot be imported — imports will fail silently or error at runtime.
- Imports resolve against the published version snapshot, NOT the live working copy
- If you update the source article, you must publish a new version for the changes to be importable
- Without @version pin, resolves to the currently published version
- Pin a specific version: '/workspace-slug/article-slug@1.0.0/file.js'
- To discover importable articles: fetch({ path: "/my-workspace" }) — look for isPublished: true

## Dependency Version Map (Standard Runtime)
Cross-article imports don't require version numbers during development. The Standard Runtime automatically resolves unversioned imports to the current published version at runtime.
- When an article is **published**, its Dependency Version Map (DV Map) is frozen into the snapshot — locking every import to the exact version that was current at publish time
- This works recursively: each level of the dependency tree has its own frozen DV Map
- Two different articles (or depths) can use different versions of the same library with no conflict
- Result: developers never think about versions during development, but published code is fully reproducible and never breaks

## Example (Multi-File — always follow this pattern)
element_create({ type: "code", settings: { layout: "collapsed" } })
→ { id: "abc" }
element_create({ type: "file", parentId: "abc", content: "import './styles.css';\nimport Chart from './Chart.jsx';\nimport { DATA } from './data.js';\nexport default function App() {\n  return <div className=\"app\"><Chart data={DATA} /></div>;\n}", settings: { filename: "app.jsx" } })
element_create({ type: "file", parentId: "abc", content: ".app { padding: 20px; }\n.chart { border: 1px solid #ddd; }", settings: { filename: "styles.css" } })
element_create({ type: "file", parentId: "abc", content: "export const DATA = [\n  { x: 0, y: 10 },\n  { x: 1, y: 20 },\n];", settings: { filename: "data.js" } })
element_create({ type: "file", parentId: "abc", content: "export default function Chart({ data }) {\n  return <svg>...</svg>;\n}", settings: { filename: "Chart.jsx" } })
element_create({ type: "web-runner", settings: { target: "app.jsx", autoHeight: true } })

Always create 3+ files. Split entry (app.jsx), styles (styles.css), data/config (.js), and components (.jsx) into separate files.

## Running After Changes
When it makes sense, run the associated web-runner with element_call({ id, action: "run" }) after modifying files so the user sees the latest output.

## Gen AI API
Web runners can use the reader's AI credits to call supported LLMs — no API keys needed. Import from /core/genai/interface.js:
- fetchModels() — returns available models: [{ id, title, provider, quality, input, output }]
- generateText({ messages, model?, maxTokens? }) — generates text using the reader's credits
- getBestModel(models) — returns model ID with highest quality rating
- getCheapestModel(models) — returns model ID with lowest price
The user is prompted before credits are spent. Models change over time, so always use fetchModels() to get the current list rather than hardcoding model IDs. See /references/genai for a working example.

## Completion API
Web runners can mark articles as complete via /core/completion/interface.js. Two functions: markComplete(true/false) and fetchIsComplete(). Useful for courses and sequential content where articles unlock as readers progress. See /references/mark-complete for a working example.

## Widgets
A web runner becomes a widget when isWidget is set to true. Widgets are interactive apps embedded in documents that can persist data, access uploaded files, generate exportable files, and distinguish between the author and readers.

Set isWidget: true to strip the runner chrome (toolbar, console). The output blends into the document as if it's part of the page — ideal for interactive widgets, visualizations, and embedded tools.

For advanced widget APIs (editor/viewer mode, uploaded files, file generation, agent access), see the "widget" guide.

## Working Examples
Fetch /references/intro-to-web or /references/simple-imports for live tutorials.
