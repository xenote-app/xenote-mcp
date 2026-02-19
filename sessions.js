const sessions = {};

function getSession(token) {
  if (!sessions[token]) {
    sessions[token] = {
      socket: null,
      tools: [],
      pendingCalls: {},
      transports: {},
      servers: {},
    };
  }
  return sessions[token];
}

function rejectAllPending(session, reason) {
  for (var id in session.pendingCalls) {
    clearTimeout(session.pendingCalls[id].timer);
    session.pendingCalls[id].resolve({
      isError: true,
      content: [{ type: "text", text: reason }],
    });
  }
  session.pendingCalls = {};
}

function notifyToolsChanged(session) {
  for (var sid in session.servers) {
    try {
      session.servers[sid].sendToolListChanged();
    } catch (e) {
      console.log("MCP: Failed to notify session", sid.slice(0, 8) + "...");
    }
  }
}

module.exports = { getSession, rejectAllPending, notifyToolsChanged };
