const PORT = process.env.PORT || 3459;

const CORS_ORIGINS = [
  "http://localhost:3000",
  "https://xenote-app.web.app",
  "https://xenote.com",
];

const TOOL_CALL_TIMEOUT = 30000;

const XENOTE_AUTH_URL =
  process.env.XENOTE_AUTH_URL || "https://xenote.com/mcp-auth";

module.exports = { PORT, CORS_ORIGINS, TOOL_CALL_TIMEOUT, XENOTE_AUTH_URL };
