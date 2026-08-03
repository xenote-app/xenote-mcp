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
var { icons } = require("./icons");

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
  elements_create: handlers.elements_create,
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

// Client-agnostic tool inventory for the instructions block. Some MCP clients
// (Claude Code, Codex) defer tool schemas and load them one at a time, so a
// tool the model hasn't loaded yet reads as "missing" even though the server
// exposes it. The instructions block is the one channel every client feeds to
// the model, so listing what exists here fixes the discovery gap portably.
// Built from the tools array so it never drifts.
var toolManifest = tools
  .map(function (t) {
    return t.name + " (" + ((t.annotations && t.annotations.title) || t.name) + ")";
  })
  .join(", ");

function createMCPServer(sessionCtx) {
  var server = new MCPServer(
    { name: "xenote", title: "Xenote", version: "2.0.0", websiteUrl: "https://xenote.com", icons: icons },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Read the relevant guide and every tool description before acting. Skipping guides is the easiest way to waste tokens and frustrate users.\n\n" +
        "Xenote is a platform for interactive articles, built for AI co-authoring. All changes are live — edits appear instantly in the user's browser.\n\n" +
        "Workspace → Folders → Articles → Elements.\n\n" +
        "Workspace updates require the workspace path; never assume a default workspace.\n\n" +
        "Elements: text (HTML prose), code (file containers), web-runner (React in browser), box-runner (shell commands), kernel-runner (Python/Jupyter), images, iframe, excalidraw.\n\n" +
        "Text for prose, runners for interactive content. Code elements hold files; runners execute them.\n\n" +
        "Page width (scroll layout): articles are created wide (~960px usable) for visual/interactive content. Set article_update({ pageWidth: 'normal' }) for prose-led reading.\n\n" +
        "Execution: web-runner runs in the browser (no setup). box-runner and kernel-runner need the user's machine connected via Baklava.\n\n" +
        "Publishing: version({ action: 'create' }) snapshots and publishes. Other articles can import from published articles.\n\n" +
        "Tool responses include tips with critical rules. Guides (get_guide) go deeper: cross-article imports, Gen AI API, Vani messaging, widget APIs, theming details.\n\n" +
        "This server's tools: " + toolManifest + ". " +
        "If your client loads tool schemas lazily, they load one at a time — a tool listed here is available even if you haven't loaded it yet; load it before calling.\n\n" +
        "URLs:\n" +
        "- Editor: https://www.xenote.com/workspaces/{workspace}/{article}\n" +
        "- Published: https://xenote.com/{workspace}/{article}\n\n" +
        "Share editorUrl when you fetch/create, publicUrl when you publish.\n\n" +
        "For working examples, fetch /references. For creative inspiration: /robo-diner (IoT robotics), /casita (edu-tech games and widgets), /logic-lab (sequential course with component reuse).",
    },
  );

  var provider = createProvider(sessionCtx.db, sessionCtx.storage);
  var resolve = createResolve(provider);
  var ctx = {
    uid: sessionCtx.uid,
    provider: provider,
    resolve: resolve,
    functions: sessionCtx.functions,
    user: sessionCtx.user || null,
  };

  server.setRequestHandler(ListToolsRequestSchema, function () {
    return { tools: tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async function (request) {
    var name = request.params.name;
    var args = request.params.arguments || {};

    // Titles are plain text; LLMs often HTML-escape them (e.g. "&amp;").
    // Normalize back to real characters before handling.
    if (typeof args.title === "string") args.title = handlers.decodeEntities(args.title);

    var handler = handlerMap[name];
    if (!handler) {
      return {
        isError: true,
        content: [{ type: "text", text: "Unknown tool: " + name }],
      };
    }

    // Update presence — track where the AI is focused. Events (file edits,
    // publishes) go to the presenceLog subcollection via provider.logEvent.
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
