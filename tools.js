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
      "Get full content, settings, and version of a single element by ID. Use this to read file content that fetch only summarizes. Very large content is truncated with a pagination marker — continue with offset.",
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
            "text: content is HTML (<p>, <h2>, <strong>, <math>, etc), not markdown. Don't add a title — the article title is already displayed. settings: { alignment?, columns?, css?, spellCheck? }\n" +
            'code: get_guide("code-and-files") before use. container for file children — don\'t put code in content. settings: { layout: "collapsed" (default — file list, expands on click) | "" (only when the code is part of the contextual reading), isReadOnly: false (editable) | true (read-only) | "hidden" (invisible to readers — use when the page is an app/experience and the code is just plumbing) }\n' +
            'file: get_guide("code-and-files") before use. requires parentId (code element ID) and settings: { filename (required — unique across the whole article, not per container; imports resolve by bare filename), isPulled? }\n' +
            'web-runner: get_guide("frontend") before use. create code+files first. React 19 is in importMap by default — additional imports are merged, not replaced. settings: { target (required, .jsx filename), importMap?, isChromeless?, layout?, height?, autoHeight? }\n' +
            'box-runner: get_guide("backend") before use. settings: { command (required, e.g. "node app.js") }\n' +
            'kernel-runner: get_guide("backend") before use. content is Python code, no parentId needed\n' +
            "images: uses entries not content. entries: [{ filename (required, local filename (upload or pulled) or https URL), caption? }]. settings: { galleryType?, widthMode?, aspectRatio?, alignment?, hasBorder?, fitting? ('cover'|'contain'), fillerColor? }\n" +
            "iframe: settings: { embedUrl (required), widthMode?, aspectRatio?, alignment?, hasBorder? }\n" +
            "excalidraw: content is JSON.stringify of elements array. settings: { maxWidth?, percentWidth?, caption?, alignment?, hasBorder?, hasPadding?, backgroundColor? }",
        },
        content: { type: "string", description: "Initial content" },
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
        expectedVersion: {
          type: "number",
          description: "Expected version for conflict detection",
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
        expectedVersion: {
          type: "number",
          description: "Expected version for conflict detection",
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
      "Update article title, description, context, settings, layout, page width, or requiredArticles (prerequisites). Page-width rule: use normal for prose-led reading; use wide for articles centered on runners, dashboards, maps, diagrams, tables, iframes, side-by-side content, or grid layouts. Set wide when the main value is visual or interactive. requiredArticles changes take effect immediately — no republish needed. Title changes require republishing to update the published title.",
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
        articleContext: {
          type: "string",
          description: "Agent-facing context notes about this article.",
        },
        requiredArticles: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of article IDs that must be completed before this article is unlocked. Pass [] to clear.",
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
          description: "Article page width. normal: prose-led reading. wide: interactive/visual content (web runners, dashboards, maps, diagrams, tables, iframes, side-by-side content, or grid layouts). Prefer wide when the article's main value is visual or interactive.",
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
      "Create and organize workspaces, folders, articles, and sections (createArticle, createFolder, reorder, addSection …). Actions: createArticle, createFolder, createWorkspace, deleteArticle, deleteFolder, move, reorder, addSection, editSection, deleteSection, renameSlug. createArticle returns an editorUrl — share it with the user. createWorkspace is for rare, deliberate use — most content belongs in an existing workspace. Workspace slugs are a global namespace (the public base URL) and accounts have a workspace limit, so always confirm title and slug with the user before creating; takes no path. reorder moves any item (article, folder, or section) within the layout. Section actions manage grouping headers on the index page. To group articles, prefer addSection over createFolder; make a subfolder only when the user explicitly asks. createArticle appends to the end of the folder index — position it (reorder) and group with sections as folders grow. deleteArticle and deleteFolder are irreversible. renameSlug will break existing cross-article imports and published URLs.",
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
        isHidden: { type: "boolean", description: "Hide section on public page" },
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
    name: "element_run",
    description:
      "Run a runner element (web-runner, box-runner, or kernel-runner) in the attached browser tab. " +
      "Requires a browser tab to be attached via the presence indicator. " +
      "Returns the execution result or times out after 10 seconds.",
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
      },
      required: ["articlePath", "id"],
    },
  },
];

module.exports = tools;
