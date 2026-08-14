/**
 * Tool Definitions
 *
 * Static tool list for the MCP server.
 * Paths use /workspace-slug/article-slug format (no /workspaces/ prefix).
 */

var ARTICLE_PATH_PROP = {
  articlePath: {
    type: "string",
    description:
      "Article path, e.g. '/my-workspace/my-article'. Required for all article/element operations.",
  },
};

var tools = [
  {
    name: "get_guide",
    description:
      "Read a Xenote guide for detailed patterns and APIs. Guides cover: cross-article imports, Gen AI API, Vani messaging, widget APIs, theming/design tokens, debug loop. Available: overview, elements, code-and-files, frontend, backend, widget, layout.",
    annotations: {
      title: "Read Guide",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        guide: {
          type: "string",
          enum: [
            "overview",
            "elements",
            "code-and-files",
            "frontend",
            "backend",
            "widget",
            "layout",
          ],
          description: "Guide name to read",
        },
      },
      required: ["guide"],
    },
  },
  {
    name: "fetch",
    description:
      "Read your live workspaces, folders, and articles by path — start here to see what exists. '/' lists workspaces, '/workspace' lists folder contents, '/workspace/article' returns article metadata + element summaries. Articles include an editorUrl — share it with the user so they can view the article.",
    annotations: {
      title: "Fetch Content",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path to fetch, e.g. '/', '/my-workspace', '/my-workspace/my-article'",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "public_fetch",
    description:
      "Fetch published content (yours or anyone's) — works like fetch but against the published version. '/workspace' lists the index, '/workspace/article' returns metadata + element summaries. Pass elementId for one element's full content (like element_get), or filename for a file's interface (import/export lines — ideal before importing); filename + offset/limit reads a range of the file. '@slug' suffix pins a specific version. Returns a publicUrl — share it with the user.",
    annotations: {
      title: "Fetch Published Content",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Published article or version path, e.g. '/workspace/article' or '/workspace/article@1.0.0'. Never include a filename here — use the filename argument.",
        },
        elementId: {
          type: "string",
          description:
            "Element ID (from the article's element summaries) — returns that element's full content",
        },
        filename: {
          type: "string",
          description:
            "Filename in the published article — returns its interface (import/export lines), or content when offset/limit is given",
        },
        offset: {
          type: "number",
          description: "Line offset for reading content (with elementId or filename)",
        },
        limit: {
          type: "number",
          description: "Max lines to return (with elementId or filename)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "element_get",
    description:
      "Get full content, settings, and edit count of a single element by ID. Use this to read file content that fetch only summarizes. Very large content is truncated with a pagination marker — continue with offset.",
    annotations: {
      title: "Get Element",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        id: { type: "string", description: "Element ID" },
        offset: {
          type: "number",
          description: "Line offset for paged reads of large content",
        },
        limit: { type: "number", description: "Max lines to return" },
      },
      required: ["articlePath", "id"],
    },
  },
  {
    name: "element_create",
    description:
      "Create one element of any type (text, code, file, runners, images, iframe, excalidraw); for several at once, use elements_create. Response includes tips with critical rules for complex types.",
    annotations: {
      title: "Create Element",
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        type: {
          type: "string",
          enum: [
            "text",
            "code",
            "file",
            "web-runner",
            "box-runner",
            "kernel-runner",
            "images",
            "iframe",
            "excalidraw",
          ],
          description:
            "Element type. Per-type requirements:\n" +
            'text: content is HTML (<p>, <h2>, <strong>, <table>, <math>, etc), not markdown; a few paragraphs per element. Don\'t add a title — the article title is already displayed. settings: { alignment?, columns?, css?, spellCheck? }\n' +
            'code: get_guide("code-and-files") before use. container for file children — don\'t put code in content. settings: { layout: "collapsed" (default — file list, expands on click) | "" (only when the code is part of the contextual reading), isReadOnly: false (editable) | true (read-only) | "hidden" (invisible to readers — use when the page is an app/experience and the code is just plumbing), title? (recommended group label) }\n' +
            'file: get_guide("code-and-files") before use. requires parentId (code element ID) and settings: { filename (required — unique across the whole article, not per container; imports resolve by bare filename), isPulled? }\n' +
            'web-runner: get_guide("frontend") before use. create code+files first. React 19 is in importMap by default — additional imports are merged, not replaced. settings: { target (required, .jsx filename), importMap?, isChromeless?, layout?, height?, autoHeight? }\n' +
            'box-runner: get_guide("backend") before use. settings: { command (required, e.g. "node app.js") }\n' +
            'kernel-runner: get_guide("backend") before use. content is Python code, no parentId needed\n' +
            "images: uses entries not content. entries: [{ filename (required — an article_upload/pulled filename, or https URL), caption? }]. settings: { galleryType? (null|'classic'), widthMode? ('small' 400px|'medium' 600px|'full' article width), aspectRatio? ('auto'|'1.7778' 16:9|'1.5000' 3:2|'1.3333' 4:3|'1.0000' 1:1|'0.5625' 9:16), alignment? ('left'|'center'|'right'; ignored for full), hasBorder?, fitting? ('cover'|'contain'), fillerColor? }. fitting and fillerColor apply only when aspectRatio is not 'auto'.\n" +
            "iframe: settings: { embedUrl (required), widthMode?, aspectRatio?, alignment?, hasBorder? }\n" +
            "excalidraw: content is JSON.stringify of elements array. settings: { maxWidth?, percentWidth?, caption?, alignment?, hasBorder?, hasPadding?, backgroundColor? }",
        },
        content: { type: "string", description: "Initial content" },
        entries: {
          type: "array",
          description:
            "Image gallery entries: [{ filename, caption? }]. Only for images elements.",
          items: { type: "object" },
        },
        settings: {
          type: "object",
          description:
            "Element settings (see type description for per-type fields)",
        },
        parentId: {
          type: "string",
          description: "Parent element ID (required for file elements)",
        },
        afterId: {
          type: "string",
          description: "Insert after this element ID",
        },
      },
      required: ["articlePath", "type"],
    },
  },
  {
    name: "elements_create",
    description:
      "Create multiple elements in one call — useful for scaffolding a code container with several files and a runner. " +
      "Use '@<index>' in parentId/afterId to reference earlier elements in the batch (e.g. parentId: '@0' = first created). " +
      "Fails atomically: on any error, every element created so far is deleted and the layout is reverted.",
    annotations: {
      title: "Create Multiple Elements",
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        elements: {
          type: "array",
          description:
            "Array of element specs (same shape as element_create args, minus articlePath). Created in order. " +
            "Reference earlier batch items in parentId/afterId via '@<index>'.",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              content: { type: "string" },
              entries: { type: "array", items: { type: "object" } },
              settings: { type: "object" },
              parentId: { type: "string" },
              afterId: { type: "string" },
            },
            required: ["type"],
          },
        },
      },
      required: ["articlePath", "elements"],
    },
  },
  {
    name: "element_update",
    description:
      "Replace an element's content or settings entirely; for small edits to large files, use element_patch. Use for settings changes, small elements, or full rewrites. For files over ~50 lines, prefer element_patch to avoid accidental data loss. To reparent (e.g. move a file from one code element to another) pass data.parentId — no delete/recreate needed.",
    annotations: {
      title: "Update Element",
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        id: { type: "string", description: "Element ID" },
        data: {
          type: "object",
          description: "Data to update",
          properties: {
            content: { type: "string" },
            settings: { type: "object" },
            entries: { type: "array", items: { type: "object" } },
            parentId: {
              type: "string",
              description:
                "New parent element ID (reparent, e.g. move a file to a different code element). Must be a valid element ID — null/empty is rejected.",
            },
          },
        },
        expectedEdits: {
          type: "number",
          description:
            "Expected edit count for conflict detection (from the element's `edits`)",
        },
      },
      required: ["articlePath", "id"],
    },
  },
  {
    name: "element_patch",
    description:
      "Replace exact strings in element content — prefer over element_update for small edits to large files (over ~50 lines). The edit will FAIL if old_string is not found or is not unique.",
    annotations: {
      title: "Patch Element",
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        id: { type: "string", description: "Element ID" },
        edits: {
          type: "array",
          description: "String replacements to apply",
          items: {
            type: "object",
            properties: {
              old_string: { type: "string", description: "Text to find" },
              new_string: { type: "string", description: "Replacement text" },
              replace_all: {
                type: "boolean",
                description: "Replace all occurrences (default false)",
              },
            },
            required: ["old_string", "new_string"],
          },
        },
        expectedEdits: {
          type: "number",
          description:
            "Expected edit count for conflict detection (from the element's `edits`)",
        },
      },
      required: ["articlePath", "id", "edits"],
    },
  },
  {
    name: "element_delete",
    description:
      "Delete an element and all its children. Deleting a code element also removes its file elements. This is irreversible.",
    annotations: {
      title: "Delete Element",
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        id: { type: "string", description: "Element ID to delete" },
      },
      required: ["articlePath", "id"],
    },
  },
  {
    name: "element_move",
    description:
      "Move an element to a new position in the article layout. Use index for absolute positioning (0 = first), or afterId to place after a specific element. Set afterId to null to move to the start.",
    annotations: {
      title: "Move Element",
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        id: { type: "string", description: "Element ID to move" },
        index: {
          type: "number",
          description:
            "Target position index (0-based). Takes priority over afterId.",
        },
        afterId: {
          type: "string",
          description: "Move after this element ID (null = move to start)",
        },
      },
      required: ["articlePath", "id"],
    },
  },
  {
    name: "article_update",
    description:
      "Update article title, description, settings, layout, page width, or requiredArticles (course prerequisites). Page-width rule: articles are created wide (visual/interactive content); set normal for prose-led reading. requiredArticles changes take effect immediately — no republish needed. Title changes require republishing to update the published title.",
    annotations: {
      title: "Update Article",
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        title: { type: "string", description: "Article title" },
        description: { type: "string", description: "Article description" },
        requiredArticles: {
          type: "array",
          items: { type: "string" },
          description:
            "Article IDs that must be completed before this article unlocks. Completion is set by JS in the prerequisite (quiz, test — see /core/completion). Pass [] to clear.",
        },
        isUnlisted: {
          type: "boolean",
          description:
            "Hide from the published folder listing; still reachable by URL and imports",
        },
        settings: { type: "object", description: "Article settings" },
        layoutType: {
          type: "string",
          enum: ["scroll", "grid"],
          description: "Layout type",
        },
        pageWidth: {
          type: "string",
          enum: ["normal", "wide"],
          description: "Article page width, scroll layout only. wide (~960px usable): visual/interactive content. normal (~704px): prose-led reading. Prose text caps at 640px on both.",
        },
        hideTitle: {
          type: "boolean",
          description: "Hide the article title on the page (default false, scroll layout only)",
        },
        layoutConfig: {
          type: "object",
          description: "Layout configuration",
        },
      },
      required: ["articlePath"],
    },
  },
  {
    name: "workspace_update",
    description:
      "Update a workspace's title, description, or theme. path must be the workspace path. Theme applies to all its articles.",
    annotations: {
      title: "Update Workspace",
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace path, e.g. '/my-workspace' (not an article or subfolder path)",
        },
        title: { type: "string", description: "Workspace title" },
        description: { type: "string", description: "Workspace description" },
        theme: {
          type: "object",
          description: "Workspace theme settings",
          properties: {
            coverPageLayout: {
              type: "string",
              enum: ["standard", "journal", "tactile"],
              description: "Homepage layout: standard (text-focused), journal (chapters), tactile (card grid)",
            },
            typography: {
              type: "string",
              enum: ["editorial", "elegant", "technical", "journal", "system"],
              description: "Typography preset: editorial (serif), elegant (classic), technical (mono), journal (warm), system (native)",
            },
            linkColor: {
              type: "string",
              enum: ["blue", "indigo", "violet", "teal", "amber", "rose", "neutral"],
              description: "Brand accent color",
            },
          },
        },
      },
      required: ["path"],
    },
  },
  {
    name: "version",
    description:
      "Publish an article (create a snapshot), and list, revert, or delete versions. Actions: create, list, update, delete, revert. create with isPublic: true (default) auto-publishes. To publish/unpublish later, use update with isPublished: true/false. list returns all versions with isPublic and isPublished flags. delete and revert are irreversible.",
    annotations: {
      title: "Manage Versions",
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        action: {
          type: "string",
          enum: [
            "create",
            "list",
            "update",
            "delete",
            "revert",
          ],
          description: "The version operation to perform",
        },
        versionId: {
          type: "string",
          description: "Version ID (for update/delete/revert)",
        },
        label: { type: "string", description: "Display label" },
        slug: { type: "string", description: "Semver version ID" },
        notes: { type: "string", description: "Version notes" },
        isPublic: { type: "boolean", description: "Whether version is publicly accessible via @slug URL (default true)" },
        isPublished: { type: "boolean", description: "For update: set true to publish this version as the live article, false to unpublish" },
      },
      required: ["articlePath", "action"],
    },
  },
  {
    name: "folder",
    description:
      "Create and organize workspaces, folders, articles, and sections (createArticle, createFolder, reorder, addSection …). Actions: createArticle, createFolder, createWorkspace, deleteArticle, deleteFolder, move, reorder, addSection, editSection, deleteSection, renameSlug. createArticle returns an editorUrl — share it with the user. createWorkspace is for rare, deliberate use — most content belongs in an existing workspace. Workspace slugs are a global namespace (the public base URL) and accounts have a workspace limit, so always confirm title and slug with the user before creating; takes no path. reorder moves any item (article, folder, or section) within the layout. Section actions manage grouping headers on the index page. To group articles, prefer addSection over createFolder; make a subfolder only when the user explicitly asks. createArticle appends to the end of the folder index — position it (reorder) and group with sections as folders grow. deleteArticle doesn't delete — it returns instructions for the user (deletion is a user action). deleteFolder is irreversible. renameSlug renames article slugs only (requires articleId) and breaks existing cross-article imports and published URLs; folder/workspace slugs are user-only.",
    annotations: {
      title: "Manage Folders",
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Workspace or folder path, e.g. '/my-workspace' or '/my-workspace/my-folder'. " +
            "For createArticle/createFolder this is the parent the new item is created in. Always pass a path, never a workspace id. Not used by createWorkspace.",
        },
        action: {
          type: "string",
          enum: [
            "createArticle",
            "createFolder",
            "createWorkspace",
            "deleteArticle",
            "deleteFolder",
            "move",
            "reorder",
            "addSection",
            "editSection",
            "deleteSection",
            "renameSlug",
          ],
          description: "The folder operation to perform",
        },
        title: {
          type: "string",
          description:
            "Title for createArticle/createFolder/createWorkspace. Required for createArticle and createWorkspace.",
        },
        slug: {
          type: "string",
          description:
            "URL slug (lowercase letters/numbers/hyphens). Optional for createArticle/createFolder — auto-derived from the title if omitted. Required for createWorkspace (5-64 chars, user-confirmed — it becomes the workspace's public base URL).",
        },
        description: { type: "string" },
        layoutType: { type: "string", enum: ["scroll", "grid"] },
        pageWidth: {
          type: "string",
          enum: ["normal", "wide"],
          description:
            "For createArticle, scroll layout only. Default wide (~960px usable); use normal (~704px) for prose-led reading. Prose text caps at 640px on both.",
        },
        articleId: { type: "string" },
        folderId: { type: "string" },
        itemId: { type: "string" },
        itemType: { type: "string", enum: ["article", "folder"] },
        newParentId: { type: "string" },
        sectionId: {
          type: "string",
          description: "Section ID (for editSection/deleteSection)",
        },
        displayMode: {
          type: "string",
          enum: ["list", "gallery"],
          description: "Section display mode on public page",
        },
        showDesc: { type: "boolean", description: "Show article descriptions in section" },
        showThumb: { type: "boolean", description: "Show article thumbnails in section" },
        isUnlisted: { type: "boolean", description: "Hide section on public page" },
        insertAt: { type: "number", description: "For addSection: position index to insert at" },
        afterItemId: {
          type: "string",
          description: "For reorder: place item after this ID in the layout",
        },
        index: {
          type: "number",
          description: "For reorder: target position index (0-based)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "article_upload",
    description:
      "Upload a binary file (image, audio, 3D model...) to an article. Fetch the article first to see its active uploads; filenames must be unique, and duplicate uploads are denied. Prefer url (server fetches it). base64 is for small files only (~500 tokens/KB, 200KB cap). With shell access, use requestUploadUrl + size and follow the returned curl command — no tokens. Reference the filename in images entries or element settings afterward.",
    annotations: {
      title: "Upload File",
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        filename: { type: "string", description: "Filename for the upload, e.g. 'hero.png'" },
        url: { type: "string", description: "https URL to fetch server-side (preferred)" },
        base64: { type: "string", description: "Base64 file content (small files only)" },
        contentType: { type: "string", description: "MIME type (inferred from url response if omitted)" },
        requestUploadUrl: { type: "boolean", description: "Return a signed PUT URL instead of uploading" },
        size: { type: "number", description: "File size in bytes (required with requestUploadUrl)" },
      },
      required: ["articlePath", "filename"],
    },
  },
  {
    name: "element_run",
    description:
      "Run a runner element in the user's attached browser tab (requires attachment — the switch on " +
      "the agent's presence panel; navigates the tab to the article). Web-runner: waits for the build " +
      "(~8s max), returns status ('settled' | 'error' | 'still-loading'), errorMessage, consoleErrors, " +
      "logs, and rendered (body text + DOM stats). Runtime errors don't fail builds — check " +
      "consoleErrors/logs even when settled. Empty rendered.text + low elementCount = blank render.",
    annotations: {
      title: "Run Element",
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        id: { type: "string", description: "Element ID of the runner to execute" },
        eval: {
          type: "string",
          description:
            "Web-runner only. JS expression evaluated in the app's iframe after it settles — probe " +
            "your own app. Returns eval.value or eval.error, capped at 2KB (truncation marked). " +
            "Query narrowly: \"document.querySelectorAll('.card').length\", \"window.app?.state.score\", " +
            "\"document.querySelector('#chart')?.outerHTML\"",
        },
        reload: {
          type: "boolean",
          description:
            "Web-runner only, default true (rebuild and rerun fresh). Pass false to keep the running " +
            "instance — state survives, so eval can interact (click, set values) and later calls " +
            "observe the result.",
        },
      },
      required: ["articlePath", "id"],
    },
  },
];

module.exports = tools;
