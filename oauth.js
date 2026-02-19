const { randomUUID, createHash } = require("crypto");
const { XENOTE_AUTH_URL } = require("./config");

// In-memory auth code store: code → { token, codeChallenge, redirectUri, expiresAt }
const authCodes = {};

function register(app) {
  app.get("/.well-known/oauth-authorization-server", function (req, res) {
    var baseUrl = req.protocol + "://" + req.get("host");
    res.json({
      issuer: baseUrl,
      authorization_endpoint: baseUrl + "/authorize",
      token_endpoint: baseUrl + "/token",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  app.get("/authorize", function (req, res) {
    var redirectUri = req.query.redirect_uri || "";
    var state = req.query.state || "";
    var codeChallenge = req.query.code_challenge || "";
    var codeChallengeMethod = req.query.code_challenge_method || "";

    var callbackBase =
      req.protocol + "://" + req.get("host") + "/authorize/callback";
    var params = [
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
    var token = req.query.token;
    var redirectUri = req.query.redirect_uri || "";
    var state = req.query.state || "";
    var codeChallenge = req.query.code_challenge || "";

    if (!token || !token.startsWith("xnt_")) {
      res.status(400).send("Missing or invalid token");
      return;
    }

    var code = randomUUID();
    authCodes[code] = {
      token: token,
      codeChallenge: codeChallenge,
      redirectUri: redirectUri,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };

    var url =
      redirectUri +
      (redirectUri.indexOf("?") >= 0 ? "&" : "?") +
      "code=" +
      encodeURIComponent(code);
    if (state) url += "&state=" + encodeURIComponent(state);
    res.redirect(url);
  });

  app.post("/token", function (req, res) {
    var grantType = req.body.grant_type;
    var code = req.body.code;
    var codeVerifier = req.body.code_verifier;
    var redirectUri = req.body.redirect_uri;

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

    var token = authCode.token;
    delete authCodes[code];

    res.json({
      access_token: token,
      token_type: "Bearer",
    });
  });
}

module.exports = { register };
