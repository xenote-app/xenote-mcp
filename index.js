const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server: SocketServer } = require("socket.io");
const { PORT, CORS_ORIGINS } = require("./config");
const oauth = require("./oauth");
const mcpRoutes = require("./mcp-routes");
const socket = require("./socket");

var app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// OAuth endpoints (Claude.ai custom connector)
oauth.register(app);

// MCP HTTP endpoints (Claude Code / Claude.ai connects here)
mcpRoutes.register(app);

// Health check
app.get("/health", function (req, res) {
  res.json({ status: "ok" });
});

// HTTP + Socket.IO server — browser tabs connect here
var httpServer = http.createServer(app);

var io = new SocketServer(httpServer, {
  cors: { origin: CORS_ORIGINS, methods: ["GET", "POST"] },
});

socket.register(io);

httpServer.listen(PORT, function () {
  console.log("Xenote MCP relay listening on port " + PORT);
});
