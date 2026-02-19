const { randomUUID } = require("crypto");
const {
  Server: MCPServer,
} = require("@modelcontextprotocol/sdk/server/index.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { TOOL_CALL_TIMEOUT } = require("./config");

function createMCPServer(session) {
  const server = new MCPServer(
    { name: "xenote", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, function () {
    return { tools: session.tools };
  });

  server.setRequestHandler(CallToolRequestSchema, function (request) {
    var name = request.params.name;
    var args = request.params.arguments || {};

    if (!session.socket) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "No browser tab connected. Open Xenote and claim the MCP session.",
          },
        ],
      };
    }

    var tool = null;
    for (var i = 0; i < session.tools.length; i++) {
      if (session.tools[i].name === name) {
        tool = session.tools[i];
        break;
      }
    }

    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: "Unknown tool: " + name }],
      };
    }

    return forwardToolCall(session, name, args);
  });

  return server;
}

function forwardToolCall(session, name, args) {
  var id = randomUUID();

  return new Promise(function (resolve) {
    var timer = setTimeout(function () {
      delete session.pendingCalls[id];
      resolve({
        isError: true,
        content: [{ type: "text", text: "Tool call timed out after 30s" }],
      });
    }, TOOL_CALL_TIMEOUT);

    session.pendingCalls[id] = { resolve: resolve, timer: timer };

    session.socket.emit("mcp", {
      topic: "tool_call",
      id: id,
      name: name,
      arguments: args,
    });
  });
}

module.exports = { createMCPServer };
