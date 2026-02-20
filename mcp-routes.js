const { randomUUID } = require("crypto");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js");
const { getSession } = require("./sessions");
const { createMCPServer } = require("./mcp-server");

function extractToken(req) {
  var auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ") && auth.slice(7).startsWith("xnt_")) {
    return auth.slice(7);
  }
  return null;
}

function sendUnauthorized(req, res) {
  var baseUrl = getBaseUrl(req);
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      'Bearer resource_metadata="' +
        baseUrl +
        '/.well-known/oauth-protected-resource"',
    )
    .json({ error: "Unauthorized" });
}

function getBaseUrl(req) {
  var host = req.get("host");
  var proto = host.indexOf("localhost") === 0 ? "http" : "https";
  return proto + "://" + host;
}

function register(app) {
  app.post("/mcp", function (req, res) {
    var token = extractToken(req);
    if (!token) {
      sendUnauthorized(req, res);
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
      sendUnauthorized(req, res);
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
      sendUnauthorized(req, res);
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
}

module.exports = { register };
