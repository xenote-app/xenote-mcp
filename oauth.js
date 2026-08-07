const {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} = require("crypto");
const { doc, getDoc } = require("firebase/firestore");
const { httpsCallable } = require("firebase/functions");
const {
  XENOTE_AUTH_URL,
  PUBLIC_BASE_URL,
  OAUTH_SIGNING_SECRET,
} = require("./config");
const { sharedDb, sharedFunctions } = require("./db");

// This service runs on Cloud Run with autoscaling, so no OAuth state may live
// in process memory: a client_id registered on one instance would be unknown
// to every other instance and would vanish on restart. Instead each opaque
// value we hand out (client_id, request_id, code) carries its own state,
// sealed with AES-256-GCM. Any instance can unseal and validate it.
//
// GCM's auth tag makes the values tamper-proof, and encrypting rather than
// merely signing keeps the Xenote token inside an authorization code out of
// browser history, referrers and proxy logs.
const KEY = createHash("sha256").update(OAUTH_SIGNING_SECRET).digest();
const AUTH_TTL_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;

// Distinct `k` values stop one kind of sealed value being replayed as another
// (e.g. presenting an authorization code where a request_id is expected).
//
// Only the two short-lived values are sealed. They live seconds, nothing
// caches them, and a rotated key at worst interrupts a login in flight.
const KIND_PENDING = "p";
const KIND_CODE = "a";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Client registrations live in Firestore, not in this process and not sealed
// into the client_id itself. Clients cache a client_id indefinitely and have
// no way to discover it has gone stale, so a registration must outlive every
// restart, deploy and key rotation. Reads are unauthenticated: the registry is
// public by design and gated by rules to single-document gets.
async function lookupClient(clientId) {
  // Validate before building a document path — a client_id arrives straight
  // from the query string, and a slash or empty value makes doc() throw,
  // turning a malformed request into a 500.
  if (!UUID_RE.test(clientId)) return null;
  var snap = await getDoc(doc(sharedDb, "mcpClients", clientId));
  if (!snap.exists()) return null;
  var data = snap.data();
  return { n: data.clientName, r: data.redirectUris || [] };
}

function seal(kind, payload, ttlMs) {
  var body = Object.assign({ k: kind }, payload);
  if (ttlMs) body.exp = Date.now() + ttlMs;
  var iv = randomBytes(12);
  var cipher = createCipheriv("aes-256-gcm", KEY, iv);
  var ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(body), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext].map(Buffer.from))
    .toString("base64url");
}

function unseal(kind, value) {
  if (typeof value !== "string" || !value) return null;
  try {
    var raw = Buffer.from(value, "base64url");
    if (raw.length < 28) return null;
    var decipher = createDecipheriv("aes-256-gcm", KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    var json = Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
    var body = JSON.parse(json);
    if (body.k !== kind) return null;
    if (body.exp && body.exp < Date.now()) return null;
    return body;
  } catch (_) {
    // Tampered, truncated, or sealed under a rotated secret.
    return null;
  }
}

// Authorization codes are single-use by spec. Statelessness means we cannot
// enforce that globally, so this is a per-instance best effort layered on the
// protections that do hold everywhere: a 2-minute lifetime and PKCE, which
// makes a replayed code useless without the client's code_verifier.
const usedCodes = new Map(); // sealed code → expiry

function consumeCode(code) {
  var now = Date.now();
  usedCodes.forEach(function (expiresAt, key) {
    if (expiresAt < now) usedCodes.delete(key);
  });
  if (usedCodes.has(code)) return false;
  usedCodes.set(code, now + CODE_TTL_MS);
  return true;
}

function getBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, "");
  var host = req.get("host");
  var proto = host.indexOf("localhost") === 0 ? "http" : "https";
  return proto + "://" + host;
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
  app.post("/register", async function (req, res) {
    var clientName = req.body.client_name || "unknown";
    var redirectUris = req.body.redirect_uris || [];

    if (!Array.isArray(redirectUris) || redirectUris.length === 0 ||
        redirectUris.some(function (uri) { return typeof uri !== "string" || !validRedirectUri(uri); })) {
      res.status(400).json({ error: "invalid_redirect_uri" });
      return;
    }

    // Writing the registry needs admin rights this server deliberately does
    // not have, so registration goes through a Cloud Function — the same
    // split as authenticateMCPTokenCall.
    try {
      var result = await httpsCallable(sharedFunctions, "registerMcpClientCall")({
        client_name: clientName,
        redirect_uris: redirectUris,
      });
      res.status(201).json({
        client_id: result.data.client_id,
        client_name: clientName,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
      });
    } catch (err) {
      console.error("oauth: client registration failed", err);
      res.status(500).json({
        error: "invalid_client_metadata",
        error_description: "Registration failed. Please try again.",
      });
    }
  });

  app.get("/authorize", async function (req, res) {
    var clientId = req.query.client_id || "";
    var redirectUri = req.query.redirect_uri || "";
    var state = req.query.state || "";
    var codeChallenge = req.query.code_challenge || "";
    var codeChallengeMethod = req.query.code_challenge_method || "";

    var client;
    try {
      client = await lookupClient(clientId);
      // A well-formed id with no registration is a client whose cached
      // registration this backend doesn't have (lost data, environment
      // switch) — rejecting it strands that client forever. Ids are random
      // UUIDs and /register is open, so adopting an unclaimed id grants
      // nothing self-registration wouldn't; the cloud function creates the
      // doc only if absent, so existing registrations keep their
      // redirect_uri binding.
      if (!client && UUID_RE.test(clientId) && validRedirectUri(redirectUri)) {
        var adopted = await httpsCallable(sharedFunctions, "registerMcpClientCall")({
          client_id: clientId,
          client_name: "Unregistered client",
          redirect_uris: [redirectUri],
        });
        client = { n: adopted.data.client_name, r: adopted.data.redirect_uris };
      }
    } catch (err) {
      console.error("oauth: client lookup failed", err);
      res.status(503).json({
        error: "temporarily_unavailable",
        error_description: "Could not verify the client registration. Please try again.",
      });
      return;
    }
    if (!client) {
      res.status(400).json({
        error: "invalid_client",
        error_description: "Unknown client registration.",
      });
      return;
    }
    // Never redirect on a redirect_uri we did not issue — that would turn this
    // endpoint into an open redirector.
    if (client.r.indexOf(redirectUri) === -1) {
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

    var requestId = seal(
      KIND_PENDING,
      {
        ci: clientId,
        ru: redirectUri,
        s: state,
        cc: codeChallenge,
      },
      AUTH_TTL_MS,
    );

    // The callback already carries a query string, so the auth page must merge
    // its own parameters into it rather than appending "?".
    var callbackBase =
      getBaseUrl(req) + "/authorize/callback?request_id=" + encodeURIComponent(requestId);
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

  // Consent-screen support: resolve a pending authorization to display
  // fields — the client's registered name and where the flow returns to.
  // request_id is a capability for the pending auth; return nothing else.
  app.get("/authorize/client", async function (req, res) {
    var authorization = unseal(KIND_PENDING, req.query.request_id || "");
    if (!authorization) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    var client;
    try {
      client = await lookupClient(authorization.ci);
    } catch (err) {
      console.error("oauth: client lookup failed", err);
      res.status(503).json({ error: "temporarily_unavailable" });
      return;
    }
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }
    var redirectHost = null;
    try {
      redirectHost = new URL(authorization.ru).host;
    } catch (_) {}
    res.json({ clientName: client.n || null, redirectHost: redirectHost });
  });

  app.get("/authorize/callback", function (req, res) {
    var token = req.query.token;
    var authorization = unseal(KIND_PENDING, req.query.request_id || "");

    if (!authorization || !token || !token.startsWith("xnt_")) {
      res.status(400).send("Missing or invalid token");
      return;
    }

    var code = seal(
      KIND_CODE,
      {
        t: token,
        cc: authorization.cc,
        ru: authorization.ru,
        ci: authorization.ci,
      },
      CODE_TTL_MS,
    );

    var url =
      authorization.ru +
      (authorization.ru.indexOf("?") >= 0 ? "&" : "?") +
      "code=" +
      encodeURIComponent(code);
    if (authorization.s) url += "&state=" + encodeURIComponent(authorization.s);
    res.redirect(url);
  });

  app.post("/token", async function (req, res) {
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
      // The token must still exist, not merely look like one. Echoing back
      // whatever was presented tells a client its stale token is good, so it
      // keeps using a credential the MCP endpoint rejects and never falls
      // back to a fresh authorization — an unrecoverable loop for the user.
      try {
        await httpsCallable(sharedFunctions, "authenticateMCPTokenCall")({
          token: refreshToken,
        });
      } catch (err) {
        // invalid_grant is the client's cue to discard it and re-authorize.
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Refresh token is no longer valid. Re-authorize to continue.",
        });
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

    var authCode = unseal(KIND_CODE, code);
    if (!authCode || !consumeCode(code)) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    // PKCE verification
    if (authCode.cc) {
      var expected = createHash("sha256")
        .update(codeVerifier || "")
        .digest("base64url");
      if (expected !== authCode.cc) {
        res.status(400).json({
          error: "invalid_grant",
          error_description: "PKCE verification failed",
        });
        return;
      }
    }

    if (authCode.ru && redirectUri !== authCode.ru) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    if (req.body.client_id && req.body.client_id !== authCode.ci) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    res.json({
      access_token: authCode.t,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: authCode.t,
    });
  });
}

module.exports = { register };
