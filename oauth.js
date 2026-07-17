const { randomUUID, createHash } = require("crypto");
const { XENOTE_AUTH_URL, PUBLIC_BASE_URL } = require("./config");

// In-memory stores
const authCodes = {}; // code → { token, codeChallenge, redirectUri, expiresAt }
const clients = {}; // client_id → { client_name, redirect_uris, ... }
const pendingAuthorizations = {}; // request ID → validated authorization request
const AUTH_TTL_MS = 5 * 60 * 1000;

function getBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, "");
  var host = req.get("host");
  var proto = host.indexOf("localhost") === 0 ? "http" : "https";
  return proto + "://" + host;
}

function purgeExpired() {
  var now = Date.now();
  [authCodes, pendingAuthorizations].forEach(function (store) {
    Object.keys(store).forEach(function (key) {
      if (store[key].expiresAt < now) delete store[key];
    });
  });
}

function validRedirectUri(value) {
  try {
    var url = new URL(value);
    return !!url.protocol && !url.hash;
  } catch (_) {
    return false;
  }
}

function register(app) {
  // Protected Resource Metadata (RFC 9728)
  app.get("/.well-known/oauth-protected-resource", function (req, res) {
    var baseUrl = getBaseUrl(req);
    res.json({
      resource: baseUrl,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
    });
  });

  // Authorization Server Metadata (RFC 8414)
  app.get("/.well-known/oauth-authorization-server", function (req, res) {
    var baseUrl = getBaseUrl(req);
    res.json({
      issuer: baseUrl,
      authorization_endpoint: baseUrl + "/authorize",
      token_endpoint: baseUrl + "/token",
      registration_endpoint: baseUrl + "/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  // Dynamic Client Registration (RFC 7591)
  app.post("/register", function (req, res) {
    purgeExpired();
    var clientId = randomUUID();
    var clientName = req.body.client_name || "unknown";
    var redirectUris = req.body.redirect_uris || [];

    if (!Array.isArray(redirectUris) || redirectUris.length === 0 ||
        redirectUris.some(function (uri) { return typeof uri !== "string" || !validRedirectUri(uri); })) {
      res.status(400).json({ error: "invalid_redirect_uri" });
      return;
    }

    clients[clientId] = {
      client_name: clientName,
      redirect_uris: redirectUris,
    };

    res.status(201).json({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
    });
  });

  app.get("/authorize", function (req, res) {
    purgeExpired();
    var clientId = req.query.client_id || "";
    var redirectUri = req.query.redirect_uri || "";
    var state = req.query.state || "";
    var codeChallenge = req.query.code_challenge || "";
    var codeChallengeMethod = req.query.code_challenge_method || "";

    var client = clients[clientId];
    if (!client || client.redirect_uris.indexOf(redirectUri) === -1) {
      res.status(400).json({ error: "invalid_request", error_description: "Unknown client or redirect URI" });
      return;
    }
    if (req.query.response_type !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }
    if (!codeChallenge || codeChallengeMethod !== "S256") {
      res.status(400).json({ error: "invalid_request", error_description: "PKCE S256 is required" });
      return;
    }

    var requestId = randomUUID();
    pendingAuthorizations[requestId] = {
      clientId: clientId,
      redirectUri: redirectUri,
      state: state,
      codeChallenge: codeChallenge,
      expiresAt: Date.now() + AUTH_TTL_MS,
    };
    var callbackBase = getBaseUrl(req) + "/authorize/callback?request_id=" + encodeURIComponent(requestId);
    var params = [
      "client_id=" + encodeURIComponent(clientId),
      "redirect_uri=" + encodeURIComponent(redirectUri),
      "state=" + encodeURIComponent(state),
      "code_challenge=" + encodeURIComponent(codeChallenge),
      "code_challenge_method=" + encodeURIComponent(codeChallengeMethod),
    ];

    res.redirect(
      XENOTE_AUTH_URL +
        "?callback=" +
        encodeURIComponent(callbackBase) +
        "&" +
        params.join("&"),
    );
  });

  app.get("/authorize/callback", function (req, res) {
    purgeExpired();
    var token = req.query.token;
    var requestId = req.query.request_id || "";
    var authorization = pendingAuthorizations[requestId];

    if (!authorization || !token || !token.startsWith("xnt_")) {
      res.status(400).send("Missing or invalid token");
      return;
    }
    delete pendingAuthorizations[requestId];

    var code = randomUUID();
    authCodes[code] = {
      token: token,
      codeChallenge: authorization.codeChallenge,
      redirectUri: authorization.redirectUri,
      clientId: authorization.clientId,
      expiresAt: Date.now() + AUTH_TTL_MS,
    };

    var url =
      authorization.redirectUri +
      (authorization.redirectUri.indexOf("?") >= 0 ? "&" : "?") +
      "code=" +
      encodeURIComponent(code);
    if (authorization.state) url += "&state=" + encodeURIComponent(authorization.state);
    res.redirect(url);
  });

  app.post("/token", function (req, res) {
    purgeExpired();
    var grantType = req.body.grant_type;
    var code = req.body.code;
    var codeVerifier = req.body.code_verifier;
    var redirectUri = req.body.redirect_uri;

    if (grantType === "refresh_token") {
      var refreshToken = req.body.refresh_token;
      if (!refreshToken || !refreshToken.startsWith("xnt_")) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      res.json({
        access_token: refreshToken,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refreshToken,
      });
      return;
    }

    if (grantType !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    var authCode = authCodes[code];
    if (!authCode || authCode.expiresAt < Date.now()) {
      delete authCodes[code];
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    // PKCE verification
    if (authCode.codeChallenge) {
      var expected = createHash("sha256")
        .update(codeVerifier || "")
        .digest("base64url");
      if (expected !== authCode.codeChallenge) {
        delete authCodes[code];
        res.status(400).json({
          error: "invalid_grant",
          error_description: "PKCE verification failed",
        });
        return;
      }
    }

    if (authCode.redirectUri && redirectUri !== authCode.redirectUri) {
      delete authCodes[code];
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    if (req.body.client_id && req.body.client_id !== authCode.clientId) {
      delete authCodes[code];
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    var token = authCode.token;
    delete authCodes[code];

    res.json({
      access_token: token,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: token,
    });
  });
}

module.exports = { register };
