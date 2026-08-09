#!/usr/bin/env node
/**
 * Presence simulator for UI polishing — fakes agent activity directly in the
 * Firestore EMULATOR (no MCP client, no auth; uses the emulator owner bypass).
 *
 * Usage:
 *   node sim.js work [--secs 45] [--client claude-code] [--path /logic-lab]
 *       Agent connects (if new) and works: presence updates + toolCall/fileEdit
 *       feed events every ~2s, alternating read/write. Ctrl-C or --secs end.
 *   node sim.js second        A second agent (codex) works for 30s alongside.
 *   node sim.js publish       Emit a `published` event (bubble + unread).
 *   node sim.js error         Emit an `error` event (bubble + unread).
 *   node sim.js idle          One presence touch, no loop (tests time-ago).
 *   node sim.js stale         Push the agent's lastSeen 10 min back.
 *   node sim.js clean         Delete all agents, tabs, and feed events.
 *
 * Options: --uid <uid> (else auto-detected from existing data or auth
 * emulator), --client <name>, --path </workspace/article>, --secs <n>.
 */

var BASE = "http://localhost:5001/v1/projects/xenote-app/databases/(default)";
var HDRS = { Authorization: "Bearer owner", "Content-Type": "application/json" };

var args = process.argv.slice(2);
var cmd = args[0] || "work";
function opt(name, dflt) {
  var i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : dflt;
}

function ts(msOffset) {
  return { timestampValue: new Date(Date.now() + (msOffset || 0)).toISOString() };
}
function str(v) { return { stringValue: v }; }

async function api(path, opts) {
  var res = await fetch(BASE + path, Object.assign({ headers: HDRS }, opts));
  if (!res.ok) throw new Error(path + " → " + res.status + " " + (await res.text()).slice(0, 200));
  return res.json();
}

// PATCH with updateMask — creates the doc if missing, never clobbers
// unlisted fields (attachedTabId stays intact).
async function patchDoc(docPath, fields) {
  var mask = Object.keys(fields).map(function (f) { return "updateMask.fieldPaths=" + f; }).join("&");
  return api("/documents/" + docPath + "?" + mask, {
    method: "PATCH",
    body: JSON.stringify({ fields: fields }),
  });
}

async function addEvent(uid, fields) {
  fields.createdAt = ts();
  fields.expiresAt = ts(24 * 3600 * 1000);
  return api("/documents/mcpPresence/" + uid + "/presenceLog", {
    method: "POST",
    body: JSON.stringify({ fields: fields }),
  });
}

async function query(collectionId) {
  var out = await api("/documents:runQuery", {
    method: "POST",
    body: JSON.stringify({
      structuredQuery: { from: [{ collectionId: collectionId, allDescendants: true }], limit: 300 },
    }),
  });
  return out.filter(function (r) { return r.document; }).map(function (r) { return r.document; });
}

async function detectUid() {
  var fromFlag = opt("uid");
  if (fromFlag) return fromFlag;
  var docs = await query("agents");
  if (docs.length) return docs[0].name.split("/mcpPresence/")[1].split("/")[0];
  // Fall back to the first auth-emulator user.
  var res = await fetch(
    "http://localhost:5003/emulator/v1/projects/xenote-app/accounts:query",
    { method: "POST", headers: HDRS, body: JSON.stringify({}) },
  );
  var users = (await res.json()).userInfo || [];
  if (users.length) return users[0].localId;
  throw new Error("No uid found — pass --uid <uid>.");
}

var READS = [
  { tool: "fetch" }, { tool: "element_get" }, { tool: "get_guide" },
];
var WRITES = [
  { tool: "element_update" }, { tool: "element_patch", file: "app.jsx" },
  { tool: "element_create" }, { tool: "element_patch", file: "styles.css" },
];

function agentFields(client, path, sessionId, tool) {
  return {
    token: str("xnt_sim"),
    clientName: str(client),
    clientVersion: str("0.0.0-sim"),
    sessionId: str(sessionId),
    toolName: str(tool),
    path: str(path),
    lastSeen: ts(),
    expiresAt: ts(24 * 3600 * 1000),
  };
}

async function ensureAgent(uid, client, path) {
  var docs = await query("agents");
  var mine = docs.find(function (d) {
    var f = d.fields || {};
    return d.name.indexOf("/mcpPresence/" + uid + "/") >= 0 &&
      f.clientName && f.clientName.stringValue === client;
  });
  if (mine) return mine.name.split("/agents/")[1];
  var agentId = "sim-" + client;
  await patchDoc(
    "mcpPresence/" + uid + "/agents/" + agentId,
    Object.assign(agentFields(client, path, "sim-session", "fetch"), { createdAt: ts() }),
  );
  await addEvent(uid, { type: str("connected"), agentId: str(agentId), clientName: str(client) });
  console.log("agent connected:", agentId);
  return agentId;
}

async function workLoop(uid, client, path, secs) {
  var agentId = await ensureAgent(uid, client, path);
  var until = Date.now() + secs * 1000;
  var i = 0;
  console.log(client + " working on " + path + " for " + secs + "s — Ctrl-C to stop");
  while (Date.now() < until) {
    var writing = i % 3 === 2; // mostly reads, every 3rd beat writes
    var pick = (writing ? WRITES : READS)[i % (writing ? WRITES.length : READS.length)];
    await patchDoc(
      "mcpPresence/" + uid + "/agents/" + agentId,
      agentFields(client, path, "sim-session", pick.tool),
    );
    if (pick.file) {
      await addEvent(uid, {
        type: str("fileEdit"), agentId: str(agentId), path: str(path),
        filename: str(pick.file),
      });
    } else {
      await addEvent(uid, {
        type: str("toolCall"), agentId: str(agentId), tool: str(pick.tool), path: str(path),
      });
    }
    process.stdout.write((writing ? "W" : "R"));
    i++;
    await new Promise(function (r) { setTimeout(r, 2000); });
  }
  console.log("\ndone — agent goes idle now");
}

async function main() {
  var uid = await detectUid();
  var client = opt("client", "claude-code");
  var path = opt("path", "/logic-lab");
  var secs = parseInt(opt("secs", "45"), 10);

  if (cmd === "work") {
    await workLoop(uid, client, path, secs);
  } else if (cmd === "second") {
    await workLoop(uid, "codex", "/robo-diner", 30);
  } else if (cmd === "publish") {
    var agentId = await ensureAgent(uid, client, path);
    await addEvent(uid, {
      type: str("published"), agentId: str(agentId), path: str(path),
      slug: str("0.0.1-d." + Math.floor(Math.random() * 100)), label: str("Sim publish"),
    });
    console.log("published event sent");
  } else if (cmd === "error") {
    var agentId2 = await ensureAgent(uid, client, path);
    await addEvent(uid, {
      type: str("error"), agentId: str(agentId2), tool: str("element_update"),
      path: str(path), message: str("Simulated failure: element not found"),
    });
    console.log("error event sent");
  } else if (cmd === "idle") {
    var agentId3 = await ensureAgent(uid, client, path);
    await patchDoc("mcpPresence/" + uid + "/agents/" + agentId3, agentFields(client, path, "sim-session", "fetch"));
    console.log("one presence touch");
  } else if (cmd === "stale") {
    var docs = await query("agents");
    for (var d of docs) {
      await patchDoc(d.name.split("/documents/")[1], { lastSeen: ts(-10 * 60 * 1000) });
    }
    console.log("all agents pushed 10min stale");
  } else if (cmd === "clean") {
    var all = [].concat(await query("agents"), await query("tabs"), await query("presenceLog"));
    for (var doc of all) {
      await fetch(BASE.replace("/v1/", "/v1/") + "/documents/" + doc.name.split("/documents/")[1], { method: "DELETE", headers: HDRS });
    }
    console.log("deleted " + all.length + " docs");
  } else {
    console.log("unknown command: " + cmd + " (work | second | publish | error | idle | stale | clean)");
  }
}

main().catch(function (e) { console.error(e.message); process.exit(1); });
