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
    name: "fetch",
    description:
      "Fetch your live content. '/' lists workspaces, '/workspace' lists folder contents, '/workspace/article' returns article metadata + element summaries.",
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
      "Fetch published content (yours or anyone's). Returns the currently published version, or a specific version with @slug suffix.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Published path, e.g. '/workspace/article' or '/workspace/article@1.0.0'",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "element_get",
    description:
      "Get full content, settings, and version of a single element by ID. Use this to read file content that fetch only summarizes.",
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        id: { type: "string", description: "Element ID" },
      },
      required: ["articlePath", "id"],
    },
  },
  {
    name: "element_create",
    description:
      "Create a new element in the article. File elements MUST have a parentId pointing to a code element — create the parent first. Read the 'elements' guide for type details.",
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
            "table",
            "excalidraw",
          ],
          description: "Element type",
        },
        content: { type: "string", description: "Initial content" },
        settings: { type: "object", description: "Element settings" },
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
    name: "element_update",
    description:
      "Replace element content or settings entirely. Use for settings changes, small elements, or full rewrites. For surgical code edits, prefer element_patch.",
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
      "Performs exact string replacements in element content. Use for surgical code edits. The edit will FAIL if old_string is not found or is not unique.",
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
      "Delete an element and all its children. Deleting a code element also removes its file elements.",
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
      "Move an element to a new position in the article layout. Set afterId to null to move to the start.",
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        id: { type: "string", description: "Element ID to move" },
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
      "Update article title, description, context, settings, or layout.",
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
        settings: { type: "object", description: "Article settings" },
        layoutType: {
          type: "string",
          enum: ["scroll", "grid"],
          description: "Layout type",
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
    name: "workspace_updateContext",
    description:
      "Update the workspace's project context — a persistent note visible to agents across all articles.",
    inputSchema: {
      type: "object",
      properties: {
        articlePath: ARTICLE_PATH_PROP.articlePath,
        projectContext: {
          type: "string",
          description: "Project context text. Overwrites the previous value.",
        },
      },
      required: ["projectContext"],
    },
  },
  {
    name: "version",
    description:
      "Manage article version snapshots. Actions: create, list, update, delete, revert, publish, unpublish.",
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
            "publish",
            "unpublish",
          ],
          description: "The version operation to perform",
        },
        versionId: {
          type: "string",
          description: "Version ID (for update/delete/revert/publish)",
        },
        label: { type: "string", description: "Display label" },
        slug: { type: "string", description: "Semver version ID" },
        notes: { type: "string", description: "Version notes" },
        isPublic: { type: "boolean", description: "Whether version is public" },
      },
      required: ["articlePath", "action"],
    },
  },
  {
    name: "folder",
    description:
      "Manage folders and articles. Actions: createArticle, createFolder, deleteArticle, deleteFolder, move, renameSlug.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Workspace or folder path, e.g. '/my-workspace' or '/my-workspace/my-folder'.",
        },
        action: {
          type: "string",
          enum: [
            "createArticle",
            "createFolder",
            "deleteArticle",
            "deleteFolder",
            "move",
            "renameSlug",
          ],
          description: "The folder operation to perform",
        },
        title: { type: "string" },
        slug: { type: "string" },
        parentId: { type: "string" },
        description: { type: "string" },
        layoutType: { type: "string", enum: ["scroll", "grid"] },
        articleId: { type: "string" },
        folderId: { type: "string" },
        itemId: { type: "string" },
        itemType: { type: "string", enum: ["article", "folder"] },
        newParentId: { type: "string" },
      },
      required: ["action"],
    },
  },
];

module.exports = tools;
