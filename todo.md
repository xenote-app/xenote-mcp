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
- [x] 5. ~~Granular permission scopes for MCP tokens~~ — class-level version
  shipped: every MCP custom token now carries an `mcp: true` claim
  (authenticateMCPTokenCall), visible to security rules
  (`request.auth.token.mcp`) and callables (`auth.token.mcp`). Agents are
  denied, via `requireHuman()` guards and `isAgent()` rules:
  - Token self-service (list/generate/revoke — list returns full token
    strings; generate would let an agent mint a credential that outlives
    revocation)
  - setUserRoleCall (email check alone passes for agent sessions),
    and `isRoot()` no longer honors the admin role claim for agents
  - Stripe calls, deleteDomainCall, deleteArticleCall
  - Access grants: addDomainAccessCall + client-side domain/article access
    writes
  - Workspace slug rename (article/folder/version renames still allowed);
    userInfos profile updates
  Deferred (needs UI + per-token storage): per-token scopes — read-only
  tokens, per-workspace lists in the claim, scope picker on consent.
  Settings can now say "content access" instead of "full access".

## Post-deploy checklist for the presence redesign

- Enable Firestore TTL policies on `expiresAt` for
  `mcpPresence/*/agents` and `mcpPresence/*/tabs` (presenceLog already
  has one).
- Deploy: firestore.rules (presence + agent-claim denials), firestore
  indexes (new presenceLog agentId+createdAt composite for the per-agent
  panel log), cloud functions (registerMcpClientCall change,
  listMcpTokensCall, revokeMcpTokenCall, mcp-claim minting + requireHuman
  guards), the app, and the MCP server.
- Agent-scope note: sessions signed in before the functions deploy keep
  claim-less ID tokens until they re-auth; a Cloud Run restart of the MCP
  server clears them. No rules/functions ordering constraint — claim-less
  agents just aren't denied yet, humans are never affected.
