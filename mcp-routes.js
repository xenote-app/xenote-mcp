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
    return { customToken: cached.customToken, user: cached.user };
  }

  var result = await httpsCallable(
    sharedFunctions,
    "authenticateMCPTokenCall",
  )({ token: token });

  var customToken = result.data.customToken;
  var user = { email: result.data.email || null, name: result.data.name || null };
  tokenCache[token] = { customToken: customToken, user: user, ts: Date.now() };
  return { customToken: customToken, user: user };
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
    var token = extractToken(req);
    if (!token) {
      sendUnauthorized(req, res);
      return;
    }

    var sessionId = req.headers["mcp-session-id"];

    // Existing session — refresh auth if needed, then forward to transport
    if (sessionId && sessions[sessionId]) {
      var session = sessions[sessionId];
      if (Date.now() - session.authTs > TOKEN_CACHE_TTL) {
        delete tokenCache[session.token];
        resolveToken(session.token)
          .then(function (resolved) {
            return session.refresh(resolved.customToken);
          })
          .then(function () {
            session.authTs = Date.now();
            session.transport.handleRequest(req, res, req.body);
          })
          .catch(function (e) {
            console.log("[POST /mcp] auth refresh failed:", e.message);
            res.status(403).json({ error: "Auth refresh failed" });
          });
      } else {
        session.transport.handleRequest(req, res, req.body);
      }
      return;
    }

    // Stale session — per MCP spec, return 404 so client re-initializes
    if (sessionId && !sessions[sessionId] && !isInitializeRequest(req.body)) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found" },
        id: null,
      });
      return;
    }

    // Stale session but client is re-initializing — accept it
    if (sessionId && !sessions[sessionId] && isInitializeRequest(req.body)) {
      sessionId = null;
    }

    // New session — initialize
    if (!sessionId && isInitializeRequest(req.body)) {
      var resolved;
      try {
        resolved = await resolveToken(token);
      } catch (e) {
        console.log("[POST /mcp] resolveToken failed:", e.message);
        res.status(403).json({ error: "Invalid or expired token" });
        return;
      }

      var appId = randomUUID();
      var sessionApp;
      try {
        sessionApp = await createSessionApp(appId, resolved.customToken);
      } catch (e) {
        console.log("[POST /mcp] createSessionApp failed:", e.message);
        res.status(500).json({ error: "Failed to authenticate: " + e.message });
        return;
      }

      var transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: function () {
          return randomUUID();
        },
        onsessioninitialized: function (sid) {
          sessions[sid] = {
            transport: transport,
            server: null,
            cleanup: sessionApp.cleanup,
            token: token,
            refresh: sessionApp.refresh,
            authTs: Date.now(),
          };
        },
      });

      transport.onclose = function () {
        var sid = transport.sessionId;
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
        user: resolved.user,
      });

      mcp.server.connect(transport).then(function () {
        var sid = transport.sessionId;
        if (sid && sessions[sid]) {
          sessions[sid].server = mcp.server;
          sessions[sid].clearPresence = mcp.clearPresence;
        }
        transport.handleRequest(req, res, req.body);
      });
      return;
    }

    // No session, not init — bad request
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
    var token = extractToken(req);
    if (!token) {
      sendUnauthorized(req, res);
      return;
    }
    var sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions[sessionId]) {
      sessions[sessionId].transport.handleRequest(req, res);
    } else {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found" },
        id: null,
      });
    }
  });

  app.delete("/mcp", async function (req, res) {
    var token = extractToken(req);
    if (!token) {
      sendUnauthorized(req, res);
      return;
    }
    var sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions[sessionId]) {
      sessions[sessionId].transport.handleRequest(req, res);
    } else {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found" },
        id: null,
      });
    }
  });
}

module.exports = { register };
