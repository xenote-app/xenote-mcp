# TODO

- [x] 1. ~~`navigate` flag when fetching articles~~ — resolved by the presence
  redesign: automatic follow-on-fetch is deleted; navigation is absorbed into
  attachment (attach ⇒ navigate, attachment follows the agent, user
  navigation detaches). See presence-redesign.md.
- [x] 2. ~~Minimize for the MCP presence indicator~~ — badge / bubble / panel
  model implemented (collapse persisted, dismiss rules, unread dot).
- [x] 3. ~~Multiple agents in multiple windows~~ — per-agent entries with
  reconnect adoption, tab heartbeat docs, 1:1 agent↔tab pairing.
- [x] 4. ~~Rethink and reimplement run/refresh~~ — lean fix shipped:
  element_run waits for real outcomes (settled/error/still-loading, 8s cap),
  returns rendered capture (innerText + DOM stats), optional `eval` probe
  (2KB cap), `reload: false` probe mode with per-call log deltas.
  Deferred to a future full redesign (do when demand appears):
  - Proper webframe protocol messages for capture/eval (currently piggybacks
    the console eval channel — one reply in flight at a time; rebuild
    notebook/public/webframe via build-webframe.sh)
  - Screenshots for vision-based UI verification
  - Status streaming (Firestore request docs as a status stream; surface as
    MCP progress notifications if clients ever hold streams)
  - box/kernel runners still use the old 250ms snapshot
  - Timeout stack invariant: capture 1.5s < eval 3s < settle 8s <
    page-load 10s < server 20s
- [ ] 5. Granular permission scopes for MCP tokens (read-only, per-workspace).
  Separate project: enforcement lives in token → custom claims → security
  rules, not UI. Settings currently says "full access" honestly.

## Post-deploy checklist for the presence redesign

- Enable Firestore TTL policies on `expiresAt` for
  `mcpPresence/*/agents` and `mcpPresence/*/tabs` (presenceLog already
  has one).
- Deploy: firestore.rules, firestore indexes (new presenceLog
  agentId+createdAt composite for the per-agent panel log), cloud functions
  (registerMcpClientCall change, listMcpTokensCall, revokeMcpTokenCall),
  the app, and the MCP server.
