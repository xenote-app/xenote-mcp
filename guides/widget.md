# Widgets

A widget is a web runner that uses the Editor Interface to persist data, manage files, and distinguish between author and reader contexts. Widgets are interactive modules embedded in documents: editors, viewers, dashboards, audio players, forms.

The code is the same as any web runner (React components in .jsx files), but widgets use special APIs for persistence and authoring.

For theming (colors, fonts, dark mode), read the design guide: `get_guide('design')`.

## Recommended Settings
- **isChromeless: true** — strips the toolbar and console so the output blends into the document
- **autoHeight: true** — expand height to fit content (recommended so the widget isn't clipped or scrolling)
- **hideMenuOnPublish: true** — hide the runner menu on published pages for a fully seamless look

## Editor vs. Viewer
Widgets run in two contexts:
- **Editor**: the document author working in the notebook. Has full access to editing controls.
- **Viewer**: anyone viewing the published version. Should see a read-only or limited interface.

Use the `isEditor` flag to show/hide editing controls. For example, show a "Select File" button only to the author, not readers.

## Editor Interface (/core/editor/interface.js)
```js
import { saveEditorData, fetchEditorData, isEditor, selectUploadFile } from '/core/editor/interface.js';
```

- **saveEditorData(data)** - save any JSON-serializable state to the document. This data persists through publish and is tied to the specific widget instance.
- **fetchEditorData()** - retrieve saved state. Returns null if nothing has been saved yet.
- **isEditor** - boolean. True if the current viewer is the document author, false for readers viewing the published version.
- **selectUploadFile({ accept })** - open a file picker for files uploaded to the article. The accept parameter filters by type (e.g. 'image/*', 'audio/*', '.stl'). Articles can have any uploaded files (images, audio, PDFs, 3D models), and widgets can use them to build things like audio players, image galleries, video embeds, or 3D viewers. See /references/uploaded-file for a working audio card example.

### Common Pattern: Save and Load
```js
import { useState, useEffect } from 'react';
import { saveEditorData, fetchEditorData } from '/core/editor/interface.js';

export default function App() {
  const [state, setState] = useState(initialState);

  // Load on mount
  useEffect(() => {
    fetchEditorData().then(data => { if (data) setState(data); });
  }, []);

  // Save on user action
  const save = () => saveEditorData(state);

  return <div>...</div>;
}
```

## File Interface (/core/file/interface.js)
```js
import {
  saveEditorFile, deleteEditorFile,
  fetchEditorFilename, editEditorFilename
} from '/core/file/interface.js';
```

- **editEditorFilename({ extension })** - prompt the user to name the output file. This creates a child file element on the web runner. Must be called before saveEditorFile.
- **saveEditorFile({ isBase64, content, contentType })** - write content to the child file element. Fails with "Missing filename" if editEditorFilename hasn't been called yet.
- **fetchEditorFilename()** - get the current exported filename (null if none set).
- **deleteEditorFile()** - remove the exported file.

Under the hood, the generated file is a child element attached to the web runner (like how code elements have file children). The widget user calls editEditorFilename to create it, then saveEditorFile to write to it.

### Common Pattern: File Generation
```js
const handleSave = async () => {
  await saveEditorData(editorState);
  if (filename) {
    saveEditorFile({
      isBase64: true,
      content: toBase64(editorState),
      contentType: 'image/png'
    });
  }
};
```

The generated file is a regular file element (child of the web runner), so it behaves like any other file in the article. Within the same article, import it with a relative path:
```js
// same article — works immediately, no publishing needed
import sprite from './output.png';
```

Other articles can import it too, using cross-article imports:
```js
// from another article, import the generated file by path
import sprite from '/workspace-slug/article-slug/output.png';
```
**Important**: the source article must be published (version created and published) before other articles can import from it. If you update the source, publish a new version for the changes to propagate.

## Agent Access to Widget Data
The data saved by `saveEditorData` is stored on the element as `editorData`. Agents can read and write this data directly via element_get and element_update without going through the widget UI:
- **Read**: element_get returns editorData in the response
- **Write**: element_update with { data: { editorData: { ... } } } sets the widget state

When the widget next calls `fetchEditorData()`, it receives the agent-written data. This lets agents programmatically set widget state (e.g. configure audio sources, set selections, update structured config).

### Agent File Creation
Agents can create a child file element on a web-runner, the same way they do on code elements:
```
element_create({ type: "file", parentId: "web-runner-id", settings: { filename: "output.png", isBase64: true, contentType: "image/png" }, content: "base64-string" })
```
Once the child file exists, the widget's `saveEditorFile` and `fetchEditorFilename` will see it.

**Limitation**: agents can create the file and set editorData, but cannot trigger the widget's own conversion logic (e.g. canvas rendering, audio processing). That code runs in the browser iframe and is outside agent control. If a widget generates files from its state, the user must run the widget and save from the UI.

### Token Cost Warning
Every byte of editorData written via element_update goes through the agent as a tool call. This is fine for small structured data (URLs, configs, selections) but becomes expensive for large arrays or blobs. Design editorData to be compact:
- Use indices instead of repeated strings (e.g. color index `2` instead of `"#FF0000"` repeated for every pixel)
- Keep arrays small - a 30x30 grid is 900 entries, which costs significant tokens even with indices
- For content-heavy widgets, prefer letting the user interact with the UI directly rather than having agents write raw data
- Agents are best at building widgets and setting small config state, not populating large datasets

## Working Examples
Use public_fetch to read these articles for complete working code:
- /references/custom-editor-basics - save and load with a pixel art editor (saveEditorData, fetchEditorData)
- /references/custom-editor-file - file generation, exporting pixel art as PNG (saveEditorFile, editEditorFilename)
- /references/uploaded-file - file uploads with an audio card widget (selectUploadFile, isEditor)
- /references/editor-example-stl-viewer - 3D STL viewer combining all widget APIs
