const http = require("http"),
  express = require("express"),
  cors = require("cors"),
  { randomUUID } = require("crypto"),
  { Server: SocketServer } = require("socket.io"),
  { Server: MCPServer } = require("@modelcontextprotocol/sdk/server/index.js"),
  {
    StreamableHTTPServerTransport,
  } = require("@modelcontextprotocol/sdk/server/streamableHttp.js"),
  {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    isInitializeRequest,
  } = require("@modelcontextprotocol/sdk/types.js");

const PORT = process.env.PORT || 3459;
const CORS_ORIGINS = [
  "http://localhost:3000",
  "https://xenote-app.web.app",
  "https://xenote.com",
];
const TOOL_CALL_TIMEOUT = 30000;

// =============================================================================
// Token-based session store
// =============================================================================
// Each token maps to one relay session:
//   { socket, tools, pendingCalls, transports, servers }

const sessions = {};

function getSession(token) {
  if (!sessions[token]) {
    sessions[token] = {
      socket: null,
      tools: [],
      pendingCalls: {},
      transports: {},
      servers: {},
    };
  }
  return sessions[token];
}

// =============================================================================
// MCP Server factory
// =============================================================================

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

// =============================================================================
// Tool call forwarding
// =============================================================================

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

function rejectAllPending(session, reason) {
  for (var id in session.pendingCalls) {
    clearTimeout(session.pendingCalls[id].timer);
    session.pendingCalls[id].resolve({
      isError: true,
      content: [{ type: "text", text: reason }],
    });
  }
  session.pendingCalls = {};
}

function notifyToolsChanged(session) {
  for (var sid in session.servers) {
    try {
      session.servers[sid].sendToolListChanged();
    } catch (e) {
      console.log("MCP: Failed to notify session", sid.slice(0, 8) + "...");
    }
  }
}

// =============================================================================
// Express app — MCP HTTP endpoint (Claude Code connects here)
// =============================================================================

var app = express();
app.use(cors());
app.use(express.json());

// Extract token from Authorization header
function extractToken(req) {
  var auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

app.post("/mcp", function (req, res) {
  var token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  var session = getSession(token);
  var sessionId = req.headers["mcp-session-id"];

  // Existing session — forward to transport
  if (sessionId && session.transports[sessionId]) {
    session.transports[sessionId].handleRequest(req, res, req.body);
    return;
  }

  // New session — initialize
  if (!sessionId && isInitializeRequest(req.body)) {
    var transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: function () {
        return randomUUID();
      },
      onsessioninitialized: function (sid) {
        session.transports[sid] = transport;
      },
    });

    transport.onclose = function () {
      var sid = transport.sessionId;
      if (sid) {
        delete session.transports[sid];
        delete session.servers[sid];
      }
    };

    var server = createMCPServer(session);
    server.connect(transport).then(function () {
      var sid = transport.sessionId;
      if (sid) session.servers[sid] = server;
      transport.handleRequest(req, res, req.body);
    });
    return;
  }

  res.status(400).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Bad Request: No valid session" },
    id: null,
  });
});

app.get("/mcp", function (req, res) {
  var token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }
  var session = getSession(token);
  var sessionId = req.headers["mcp-session-id"];
  if (sessionId && session.transports[sessionId]) {
    session.transports[sessionId].handleRequest(req, res);
  } else {
    res.status(400).send("Invalid or missing session ID");
  }
});

app.delete("/mcp", function (req, res) {
  var token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }
  var session = getSession(token);
  var sessionId = req.headers["mcp-session-id"];
  if (sessionId && session.transports[sessionId]) {
    session.transports[sessionId].handleRequest(req, res);
  } else {
    res.status(400).send("Invalid or missing session ID");
  }
});

// Health check
app.get("/health", function (req, res) {
  res.json({ status: "ok" });
});

// =============================================================================
// HTTP + Socket.IO server — browser tabs connect here
// =============================================================================

var httpServer = http.createServer(app);

var io = new SocketServer(httpServer, {
  cors: { origin: CORS_ORIGINS, methods: ["GET", "POST"] },
});

io.on("connection", function (socket) {
  var socketToken = null;

  socket.on("mcp", function (message) {
    var topic = message.topic;

    if (topic === "claim") {
      var token = message.token;
      if (!token) {
        socket.emit("mcp", { topic: "error", error: "Token required" });
        return;
      }

      var session = getSession(token);

      // If another tab is connected, kick it
      if (session.socket && session.socket !== socket) {
        session.socket.emit("mcp", {
          topic: "released",
          reason: "Another tab claimed the session",
        });
      }

      session.socket = socket;
      socketToken = token;
      console.log("MCP: Session claimed for token", token.slice(0, 8) + "...");
      socket.emit("mcp", { topic: "claimed" });
    } else if (topic === "release") {
      if (!socketToken) return;
      var session = getSession(socketToken);
      if (session.socket !== socket) return;

      console.log("MCP: Session released for token", socketToken.slice(0, 8) + "...");
      session.socket = null;
      session.tools = [];
      rejectAllPending(session, "MCP session released");
      notifyToolsChanged(session);
      socket.emit("mcp", { topic: "released" });
    } else if (topic === "register") {
      if (!socketToken) {
        socket.emit("mcp", { topic: "error", error: "Not claimed" });
        return;
      }
      var session = getSession(socketToken);
      if (session.socket !== socket) {
        socket.emit("mcp", { topic: "error", error: "Not claimed" });
        return;
      }

      session.tools = message.tools || [];
      console.log("MCP: Registered", session.tools.length, "tools");
      notifyToolsChanged(session);
      socket.emit("mcp", { topic: "registered", count: session.tools.length });
    } else if (topic === "tool_result") {
      if (!socketToken) return;
      var session = getSession(socketToken);
      var pending = session.pendingCalls[message.id];
      if (pending) {
        clearTimeout(pending.timer);
        delete session.pendingCalls[message.id];

        if (message.error) {
          pending.resolve({
            isError: true,
            content: [{ type: "text", text: message.error }],
          });
        } else {
          pending.resolve({
            content: [
              {
                type: "text",
                text:
                  typeof message.result === "string"
                    ? message.result
                    : JSON.stringify(message.result),
              },
            ],
          });
        }
      }
    }
  });

  socket.on("disconnect", function () {
    if (!socketToken) return;
    var session = getSession(socketToken);
    if (session.socket === socket) {
      console.log("MCP: Tab disconnected for token", socketToken.slice(0, 8) + "...");
      session.socket = null;
      session.tools = [];
      rejectAllPending(session, "Browser tab disconnected");
      notifyToolsChanged(session);
    }
  });
});

// =============================================================================
// Start
// =============================================================================

httpServer.listen(PORT, function () {
  console.log("Xenote MCP relay listening on port " + PORT);
});
