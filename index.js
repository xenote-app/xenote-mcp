var express = require("express");
var cors = require("cors");
var { PORT } = require("./config");
var oauth = require("./oauth");
var mcpRoutes = require("./mcp-routes");

var app = express();
app.set("trust proxy", true);
app.use(cors());
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
