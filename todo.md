# TODO

- [x] 1. ~~`navigate` flag when fetching articles~~ — resolved by the presence
  redesign: automatic follow-on-fetch is deleted; navigation is absorbed into
  attachment (attach ⇒ navigate, attachment follows the agent, user
  navigation detaches). See presence-redesign.md.
- [x] 2. ~~Minimize for the MCP presence indicator~~ — badge / bubble / panel
  model implemented (collapse persisted, dismiss rules, unread dot).
- [x] 3. ~~Multiple agents in multiple windows~~ — per-agent entries with
  reconnect adoption, tab heartbeat docs, 1:1 agent↔tab pairing.
- [ ] 4. Rethink and reimplement run/refresh — execution is broken. Fetch the
  rendered output for web-runner so agents get real execution feedback,
  return errors from run right away, and add a way to send back 'attached'.
  Worth redesigning as a whole rather than patching.
  The presence redesign already routes requests to the paired tab
  (agentId + targetTabId on request docs) and needs attachment-state
  feedback as its first requirement. Rendered output = new postMessage
  type in notebook/public/webframe (built by build-webframe.sh).
- [ ] 5. Granular permission scopes for MCP tokens (read-only, per-workspace).
  Separate project: enforcement lives in token → custom claims → security
  rules, not UI. Settings currently says "full access" honestly.

## Post-deploy checklist for the presence redesign

- Enable Firestore TTL policies on `expiresAt` for
  `mcpPresence/*/agents` and `mcpPresence/*/tabs` (presenceLog already
  has one).
- Deploy: firestore.rules, cloud functions (registerMcpClientCall change,
  listMcpTokensCall, revokeMcpTokenCall), the app, and the MCP server.
