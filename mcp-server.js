var {
  Server: MCPServer,
} = require("@modelcontextprotocol/sdk/server/index.js");
var {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

var { createProvider } = require("./provider");
var { createResolve } = require("./resolve");
var tools = require("./tools");
var handlers = require("./handlers");
var guides = require("./guides");

// Build resources from guides
var resources = Object.keys(guides).map(function (key) {
  return {
    uri: "xenote://guides/" + key,
    name: key,
    description: "Xenote guide: " + key,
    mimeType: "text/markdown",
    content: guides[key],
  };
});

// Map tool names to handler functions
var handlerMap = {
  get_guide: handlers.get_guide,
  fetch: handlers.fetch,
  public_fetch: handlers.public_fetch,
  element_get: handlers.element_get,
  element_create: handlers.element_create,
  element_update: handlers.element_update,
  element_patch: handlers.element_patch,
  element_delete: handlers.element_delete,
  element_move: handlers.element_move,
  article_update: handlers.article_update,
  workspace_update: handlers.workspace_update,
  version: handlers.version,
  folder: handlers.folder,
  element_run: handlers.element_run,
};

function createMCPServer(sessionCtx) {
  var server = new MCPServer(
    { name: "xenote", version: "2.0.0" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Xenote is a platform for interactive articles. Workspace → Folders → Articles → Elements.\n\n" +
        "Elements: text (HTML prose), code (file containers), web-runner (React in browser), box-runner (shell commands), kernel-runner (Python/Jupyter), images, table, iframe, excalidraw.\n\n" +
        "Text for prose, runners for interactive content. Code elements hold files; runners execute them.\n\n" +
        "Execution environments:\n" +
        "- Frontend (web-runner): React components in the browser, no backend needed\n" +
        "- Backend (box-runner): any shell command (Node, Python, Rust, etc.), needs user's machine connected\n" +
        "- Jupyter (kernel-runner): stateful Python cells, needs user's machine connected\n\n" +
        "Publishing: version({ action: 'create' }) snapshots and publishes. Other articles can import from published articles.\n\n" +
        "Always read the relevant guide before creating elements. Read 'elements' before any element creation. Read 'design' before building interactive content.\n\n" +
        "URLs:\n" +
        "- Editor: https://www.xenote.com/workspaces/{workspace}/{article}\n" +
        "- Published: https://xenote.com/{workspace}/{article}\n\n" +
        "Share editorUrl when you fetch/create, publicUrl when you publish.\n\n" +
        "For working examples, fetch /references.",
    },
  );

  var provider = createProvider(sessionCtx.db);
  var resolve = createResolve(provider);
  var ctx = {
    uid: sessionCtx.uid,
    provider: provider,
    resolve: resolve,
    functions: sessionCtx.functions,
  };

  server.setRequestHandler(ListToolsRequestSchema, function () {
    return { tools: tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async function (request) {
    var name = request.params.name;
    var args = request.params.arguments || {};

    var handler = handlerMap[name];
    if (!handler) {
      return {
        isError: true,
        content: [{ type: "text", text: "Unknown tool: " + name }],
      };
    }

    // Update presence — track where the AI is focused
    var focusPath =
      args.articlePath || (name !== "public_fetch" ? args.path : null) || null;
    if (focusPath) {
      var clientVersion = server.getClientVersion();
      var clientName = clientVersion ? clientVersion.name : null;
      provider
        .setPresence(ctx.uid, {
          toolName: name,
          path: focusPath,
          clientName: clientName,
        })
        .catch(function () {});
    }

    try {
      var result = await handler(args, ctx);
      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result),
          },
        ],
      };
    } catch (e) {
      var message = e.message;
      if (e.code === "permission-denied") {
        message =
          "Access denied. You do not have permission to perform this operation.";
      }
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, function () {
    return {
      resources: resources.map(function (r) {
        return {
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        };
      }),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, function (request) {
    var uri = request.params.uri;
    var resource = null;
    for (var i = 0; i < resources.length; i++) {
      if (resources[i].uri === uri) {
        resource = resources[i];
        break;
      }
    }
    if (!resource) {
      throw new Error("Resource not found: " + uri);
    }
    return {
      contents: [
        {
          uri: uri,
          mimeType: resource.mimeType || "text/markdown",
          text: resource.content,
        },
      ],
    };
  });

  return {
    server: server,
    clearPresence: function () {
      return provider.clearPresence(ctx.uid);
    },
  };
}

module.exports = { createMCPServer };
