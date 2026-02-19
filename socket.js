const {
  getSession,
  rejectAllPending,
  notifyToolsChanged,
} = require("./sessions");

function register(io) {
  io.on("connection", function (socket) {
    var socketToken = null;

    socket.on("mcp", function (message) {
      var topic = message.topic;

      if (topic === "claim") {
        var token = message.token;
        if (!token) {
          socket.emit("mcp", { topic: "error", error: "Token required" });
          return;
        }

        var session = getSession(token);

        // If another tab is connected, kick it
        if (session.socket && session.socket !== socket) {
          session.socket.emit("mcp", {
            topic: "released",
            reason: "Another tab claimed the session",
          });
          rejectAllPending(session, "Session claimed by another tab");
          session.tools = [];
        }

        session.socket = socket;
        socketToken = token;
        console.log(
          "MCP: Session claimed for token",
          token.slice(0, 8) + "...",
        );
        socket.emit("mcp", { topic: "claimed" });
      } else if (topic === "release") {
        if (!socketToken) return;
        var session = getSession(socketToken);
        if (session.socket !== socket) return;

        console.log(
          "MCP: Session released for token",
          socketToken.slice(0, 8) + "...",
        );
        session.socket = null;
        session.tools = [];
        rejectAllPending(session, "MCP session released");
        notifyToolsChanged(session);
        socket.emit("mcp", { topic: "released" });
      } else if (topic === "register") {
        if (!socketToken) {
          socket.emit("mcp", { topic: "error", error: "Not claimed" });
          return;
        }
        var session = getSession(socketToken);
        if (session.socket !== socket) {
          socket.emit("mcp", { topic: "error", error: "Not claimed" });
          return;
        }

        session.tools = message.tools || [];
        console.log("MCP: Registered", session.tools.length, "tools");
        notifyToolsChanged(session);
        socket.emit("mcp", {
          topic: "registered",
          count: session.tools.length,
        });
      } else if (topic === "tool_result") {
        if (!socketToken) return;
        var session = getSession(socketToken);
        var pending = session.pendingCalls[message.id];
        if (pending) {
          clearTimeout(pending.timer);
          delete session.pendingCalls[message.id];

          if (message.error) {
            pending.resolve({
              isError: true,
              content: [{ type: "text", text: message.error }],
            });
          } else {
            pending.resolve({
              content: [
                {
                  type: "text",
                  text:
                    typeof message.result === "string"
                      ? message.result
                      : JSON.stringify(message.result),
                },
              ],
            });
          }
        }
      }
    });

    socket.on("disconnect", function () {
      if (!socketToken) return;
      var session = getSession(socketToken);
      if (session.socket === socket) {
        console.log(
          "MCP: Tab disconnected for token",
          socketToken.slice(0, 8) + "...",
        );
        session.socket = null;
        session.tools = [];
        rejectAllPending(session, "Browser tab disconnected");
        notifyToolsChanged(session);
      }
    });
  });
}

module.exports = { register };
