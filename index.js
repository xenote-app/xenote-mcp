var express = require("express");
var cors = require("cors");
var { PORT, CORS_ORIGINS } = require("./config");
var oauth = require("./oauth");
var mcpRoutes = require("./mcp-routes");

var app = express();
app.set("trust proxy", true);
app.use(
  cors({
    origin: function (origin, callback) {
      // Non-browser MCP clients do not send Origin and should remain usable.
      if (!origin || CORS_ORIGINS.indexOf(origin) !== -1)
        return callback(null, true);
      return callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: true,
    exposedHeaders: ["MCP-Session-Id"],
    allowedHeaders: ["Content-Type", "Authorization", "MCP-Session-Id"],
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// OAuth endpoints
oauth.register(app);

// MCP HTTP endpoints
mcpRoutes.register(app);

// Health check
app.get("/health", function (req, res) {
  res.json({ status: "ok" });
});

app.listen(PORT, function () {
  console.log("Xenote MCP server listening on port " + PORT);
});
