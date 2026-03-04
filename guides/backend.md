# Backend — Box Runner & Kernel Runner

## Machines
A machine is a remote compute environment (local or cloud) running Baklava, a daemon that connects to Xenote via Socket.io. Box-runner and kernel-runner both need a connected machine to execute. Web-runner does not — it runs in the browser.

The user connects machines from the app UI (ENV button in the toolbar). Connection status is managed entirely by the user — agents cannot connect or disconnect machines. If a runner can't execute, the machine is likely not connected.

Machines provide:
- Shell subprocess execution (box-runner)
- Jupyter kernel management (kernel-runner)
- File syncing between browser and remote filesystem
- Vani message routing between frontend and backend

## box-runner — Shell Command Execution
Runs any shell command. Any language, any tool.

### Settings
- command: the shell command (e.g. "node app.js", "python main.py", "gcc -o prog main.c && ./prog")

### How It Works
1. All file elements in the article are synced to the sandbox folder at their article path (workspace-slug/article-slug/filename). Files from different code elements end up in the same directory, so relative imports between them work naturally.
2. The command runs in a shell subprocess
3. stdout/stderr streams back in real-time

### Creation Pattern (same as web-runner)
1. Create a code element → { id }
2. Create file elements with parentId
3. Create box-runner: element_create({ type: "box-runner", settings: { command: "node app.js" } })

### File Pulling
File elements with isPulled: true are fetched back from the backend after execution:
element_create({ type: "file", parentId: "box-id", settings: { filename: "output.csv", isPulled: true } })

### Interactive Mode
command: "bash" or "sh" — becomes an interactive terminal.

## kernel-runner — Python/Jupyter Cells
Jupyter-like Python execution with stateful sessions.

### How It Works
- Content lives directly on the element (NOT in a file element)
- content: string (Python code)
- Each article has one kernel session — variables persist across cells
- Supports rich output: text, HTML, images, LaTeX, error tracebacks

### Creation
element_create({ type: "kernel-runner", content: "import numpy as np\nprint(np.array([1,2,3]))" })
No code element or parentId needed — content is on the element itself.

### Settings
- tabMode?: "2s" or "4s" (default "4s")
- hasLineNumbers?, lineWrapping?, maxOutputHeight?, syncFiles?

## Environment Variables
The ENV panel provides environment variables to all runners in an article.
- **Article env vars**: key-value pairs shared across all runners, visible to all collaborators. Stored on the article.
- **Personal keys**: stored in the user's browser (localStorage), never sent to the server.

To reference a personal key from an env var, prefix the value with `$`. For example, setting `OPENAI_KEY = $MY_API_KEY` will substitute the actual value of `MY_API_KEY` from the user's personal keys at runtime.

Agents cannot read or set env vars or personal keys — the user manages them from the ENV panel.

## Vani — Frontend/Backend Communication
Real-time messaging between web-runner and backend processes:
- Python: from vani.python import vani; vani.send(data)
- Node.js: import VaniNode from '/vani/js/VaniNode.js'
- Browser: import Vani from '/vani/js/Vani.js'

## Working Examples
Fetch /references/baklava or /references/jupyter for live tutorials.
