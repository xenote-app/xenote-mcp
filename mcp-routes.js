var { randomUUID } = require("crypto");
var {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
var { isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js");
var { httpsCallable } = require("firebase/functions");
var { createMCPServer } = require("./mcp-server");
var { createSessionApp, sharedFunctions } = require("./db");

// In-memory: sessionId → { transport, server, cleanup }
var sessions = {};

// Token → customToken cache (50 min TTL, custom tokens expire at 60 min)
var tokenCache = {};
var TOKEN_CACHE_TTL = 50 * 60 * 1000;

async function resolveToken(token) {
  var cached = tokenCache[token];
  if (cached && Date.now() - cached.ts < TOKEN_CACHE_TTL) {
    console.log("[resolveToken] cache hit");
    return cached.customToken;
  }

  console.log("[resolveToken] calling authenticateMCPTokenCall...");
  var result = await httpsCallable(
    sharedFunctions,
    "authenticateMCPTokenCall",
  )({ token: token });

  var customToken = result.data.customToken;
  tokenCache[token] = { customToken: customToken, ts: Date.now() };
  console.log("[resolveToken] got custom token");
  return customToken;
}

function extractToken(req) {
  var auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

function getBaseUrl(req) {
  var host = req.get("host");
  var proto = host.indexOf("localhost") === 0 ? "http" : "https";
  return proto + "://" + host;
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

function register(app) {
  app.post("/mcp", async function (req, res) {
    console.log(
      "[POST /mcp] headers:",
      JSON.stringify({
        auth: req.headers["authorization"] ? "Bearer ..." : "(none)",
        session: req.headers["mcp-session-id"] || "(none)",
      }),
    );
    console.log("[POST /mcp] body:", JSON.stringify(req.body));

    var token = extractToken(req);
    if (!token) {
      console.log("[POST /mcp] no token → 401");
      sendUnauthorized(req, res);
      return;
    }

    var sessionId = req.headers["mcp-session-id"];

    // Existing session — forward to transport
    if (sessionId && sessions[sessionId]) {
      console.log("[POST /mcp] existing session:", sessionId);
      sessions[sessionId].transport.handleRequest(req, res, req.body);
      return;
    }

    // Stale session — per MCP spec, return 404 so client re-initializes
    if (sessionId && !sessions[sessionId] && !isInitializeRequest(req.body)) {
      console.log("[POST /mcp] stale session, not init → 404");
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found" },
        id: null,
      });
      return;
    }

    // Stale session but client is re-initializing — accept it
    if (sessionId && !sessions[sessionId] && isInitializeRequest(req.body)) {
      console.log("[POST /mcp] stale session, accepting reinitialize");
      sessionId = null;
    }

    // New session — initialize
    if (!sessionId && isInitializeRequest(req.body)) {
      console.log("[POST /mcp] new session — initializing...");
      var customToken;
      try {
        customToken = await resolveToken(token);
      } catch (e) {
        console.log("[POST /mcp] resolveToken failed:", e.message);
        res.status(403).json({ error: "Invalid or expired token" });
        return;
      }

      var appId = randomUUID();
      console.log("[POST /mcp] creating session app:", appId);
      var sessionApp;
      try {
        sessionApp = await createSessionApp(appId, customToken);
      } catch (e) {
        console.log("[POST /mcp] createSessionApp failed:", e.message);
        res.status(500).json({ error: "Failed to authenticate: " + e.message });
        return;
      }
      console.log("[POST /mcp] signed in as uid:", sessionApp.uid);

      var transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: function () {
          return randomUUID();
        },
        onsessioninitialized: function (sid) {
          console.log("[POST /mcp] session initialized:", sid);
          sessions[sid] = {
            transport: transport,
            server: null,
            cleanup: sessionApp.cleanup,
          };
        },
      });

      transport.onclose = function () {
        var sid = transport.sessionId;
        console.log("[transport] closed:", sid);
        if (sid && sessions[sid]) {
          if (sessions[sid].clearPresence) {
            sessions[sid].clearPresence().catch(function () {});
          }
          sessions[sid].cleanup();
          delete sessions[sid];
        }
      };

      var mcp = createMCPServer({
        uid: sessionApp.uid,
        db: sessionApp.db,
        functions: sessionApp.functions,
      });

      mcp.server.connect(transport).then(function () {
        var sid = transport.sessionId;
        console.log("[POST /mcp] server connected, handling init request");
        if (sid && sessions[sid]) {
          sessions[sid].server = mcp.server;
          sessions[sid].clearPresence = mcp.clearPresence;
        }
        transport.handleRequest(req, res, req.body);
      });
      return;
    }

    // No session, not init — bad request
    console.log("[POST /mcp] no session, not init → 400");
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: Missing session or initialize",
      },
      id: null,
    });
  });

  app.get("/mcp", async function (req, res) {
    console.log(
      "[GET /mcp] session:",
      req.headers["mcp-session-id"] || "(none)",
    );
    var token = extractToken(req);
    if (!token) {
      sendUnauthorized(req, res);
      return;
    }
    var sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions[sessionId]) {
      sessions[sessionId].transport.handleRequest(req, res);
    } else {
      console.log("[GET /mcp] session not found → 404");
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found" },
        id: null,
      });
    }
  });

  app.delete("/mcp", async function (req, res) {
    console.log(
      "[DELETE /mcp] session:",
      req.headers["mcp-session-id"] || "(none)",
    );
    var token = extractToken(req);
    if (!token) {
      sendUnauthorized(req, res);
      return;
    }
    var sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions[sessionId]) {
      sessions[sessionId].transport.handleRequest(req, res);
    } else {
      console.log("[DELETE /mcp] session not found → 404");
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found" },
        id: null,
      });
    }
  });
}

module.exports = { register };
