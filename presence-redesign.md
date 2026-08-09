# MCP Presence Redesign

Temp working doc. Covers todo items 1–3 (+ User Settings section). Item 4
(run/refresh) is deferred but the model here is built to receive it.
Spans both repos: `xenote-mcp` (server) and `notebook` (app + rules + functions).

## Core ideas

- Presence goes from one mutable doc to **per-agent entries** — multiple
  agents, listed like recent chats.
- **Tabs post presence too** (symmetric model): tab heartbeat docs replace the
  two magic `attachedTabId`/`attachedLastSeen` fields.
- **Attachment is a 1:1 agent↔tab pairing with physical meaning**: the
  attached tab is the agent's *stage* — parked on the agent's article, so runs
  execute against an already-mounted page.
- **presenceLog becomes the product surface**: the feed is the content of the
  panel, not a toast side-channel.
- **The N=1 case must look as simple as today.** Multi-agent machinery is
  invisible until a second agent actually connects.

## Data model (Firestore)

All under `mcpPresence/{uid}`. The parent doc itself becomes vestigial
(delete its use; keep nothing on it).

### `agents/{agentId}`
One doc per live agent.

- `token` — the `xnt_` token this session authenticated with (lineage to Settings)
- `clientName`, `clientVersion` — from MCP `clientInfo`
- `sessionId` — current MCP session (churns on reconnect; entry survives)
- `toolName`, `path` — current focus ("present tense", updated per tool call)
- `lastSeen` — serverTimestamp per tool call
- `createdAt`, `expiresAt` — TTL field, refreshed on activity
- `attachedTabId` — nullable; the pairing (see Attachment)

**Identity / adoption heuristic** (spec gives no stable per-window id:
`clientInfo` = product only; `Mcp-Session-Id` = server-minted, churns):
key by session, but when a new session matches an existing entry's
`token + clientName` and that entry has been quiet ≥ ~60–90s, **adopt** the
entry (update `sessionId`, keep identity and pairing) instead of creating a
new one. Two *concurrently active* windows ⇒ two entries (correct: genuinely
two agents). Adoption runs server-side when the session first writes presence.

### `tabs/{tabId}`
Tab presence: `lastSeen` heartbeat (30s), `createdAt`. Tab liveness for
pairings derives from this doc (90s lease). Keep the existing
sessionStorage `mcpTabId` + BroadcastChannel rotation for tab identity.

### `presenceLog/{id}` — the feed
Per-user (NOT nested per-agent — one listener, merged timeline, survives
entry expiry), tagged `agentId`. Fields: `type`, `agentId`, payload,
`createdAt`, `expiresAt` (TTL).

- **Every activity is logged.** Typed events carry rich payloads
  (connected, articleCreated, fileEdit + filename, published, error);
  every other successful tool call lands as a generic
  `toolCall { tool, path }` (suppressed when the same call emitted a typed
  event, so nothing double-logs). The agent entry still carries the
  present-tense focus; the feed is the complete past.
- **Coalescing** ("edited app.jsx ×3", "viewed /demo ×5"): write every
  event, coalesce consecutive same-activity runs at render. (Revisit if
  volume ever matters; TTL caps growth.)
- **Significant events** (drive unread dot + bubble): new agent connected,
  published, error, detached.
- **Remove the lease-renewal side effect** — events say nothing about tab
  liveness; the heartbeat owns that.
- Current `fileChange` consumer ignores it; replaced by this vocabulary.

### `requests/{id}` — deferred (#4)
Stays per-user, tagged `agentId`. With 1:1 pairing, routing is trivial: the
request targets the paired tab; no claim contention. Lifecycle redesign
(streamed errors, rendered output, attached-ack) is #4. First concrete #4
requirement already known: **attachment-state feedback to the agent**.

### Security rules
`firebase/firestore.rules:146-159` — extend to the new subcollections
(`agents`, `tabs`), same `request.auth.uid == uid` gate.

## Attachment

- **1:1**: one agent ↔ at most one tab. `attachedTabId` on the agent entry,
  set/cleared via transaction (no-steal guard, per agent). A tab holds at
  most one pairing (a tab parked on one article can't stage two agents on
  different ones). Multi-agent = multi-window, one stage each.
- **Attach ⇒ navigate**: clicking Attach navigates the tab to the agent's
  current `path`.
- **Attachment ⇒ following**: if the agent's focus moves to another article,
  the attached tab follows. Navigation is absorbed into attachment — there is
  no other automatic navigation (todo #1 resolves as: **delete**
  follow-on-fetch in `Presence.jsx:142-149`; no `navigate` flag).
- **User navigation ⇒ detach**: any user-initiated navigation (links, back
  button, folder index) detaches, with a loud bubble ("Detached —
  [Re-attach]"). Implementation must airtightly distinguish
  attachment-driven (programmatic, marked) navigations from user ones,
  or follow would sever itself.
- `element_run` precheck / `browserAttachmentStatus` become per-agent:
  "attached" ⇔ this agent's paired tab is alive (tab doc heartbeat).

## Numbers

- Active pulse: tool call < 3s ago (as today)
- Tab heartbeat 30s / lease 90s (as today)
- Agent staleness (drops from live UI): 5 min without `lastSeen`
- Adoption quiet threshold: 60–90s
- Feed TTL: 24h (raise to 48–72h if "what happened while away" feels short)
- Dismiss re-arm quiet gap: ~10 min

## UI

Terminology: user-facing word is **"connector"** (industry consensus;
"MCP server" in dev docs only). Icons: heroicons/radix have no plug —
inline **Lucide** glyphs at `strokeWidth 1.5` (`plug`, `plug-zap`, `unplug`).

### Visibility (all states)
- Purely **data-driven, no route logic**: mount iff (live agent entries
  exist) OR (this tab holds a pairing). Nothing for viewers — their uid has
  no entries. Verify the component mounts in the published-page shell too.
- Never dismissable while this tab is attached (visibility = consent).
- Dismiss (X on hover, when not attached): session-scoped (in-memory);
  re-arms on new agent, significant feed event, or activity resuming after
  the quiet gap. NOT on every heartbeat (today's bug).
- Collapse state + panel position persist in localStorage. Default collapsed.
- Never auto-expand the panel.

### Badge (collapsed)
Pill of client icons (N=1: single icon — visually like today). Signals:
pulse ring (any agent active), green dot (this tab attached), unread dot
(significant event since last expanded; cleared on open). Click → panel.

### Bubble (transient, sprouts from badge)
For significant moments; auto-dismisses into the badge:
- New agent: "Claude Code started working in /demo — [Attach] [View]"
- Detach: "Detached — [Re-attach]" (persists a bit longer)
- Published / error: one-liner
(#4 later adds a persistent variant for agent-blocked-waiting.)

### Panel (expanded, movable, ~320px)
- **N=1: status card**, not a one-row list — client, path, attach toggle,
  latest feed line, Show more, footer.
- **N≥2: chat-list**, sorted `lastSeen` desc. Row: client icon + name,
  pulse/time-ago, focus path (**click = navigate**, the replacement for
  auto-follow), latest feed event (one line), attach indicator
  (green = this tab, hollow = another tab, empty = unattached; toggle).
- **History: one latest event per agent; [Show more] paginates**
  (`orderBy createdAt desc` + cursor) through the feed until TTL. No other
  history surface exists.
- Footer: **Connectors** button → User Settings section.

## User Settings — Connectors section

One row per `mcpTokens` doc (max 5): client icon/name, connected since,
last used, **expires** — labeled "extends with use" (sliding +90d) — and
**Revoke** (delete token doc; session dies at next validation). Access
description is honest: **"Full access to your workspaces"** — no granular
scopes exist. (Granular scopes = separate future project: enforcement would
live in token → custom claims → security rules, not UI.) Optional: show
live lineage via agent entries' `token` ref ("active as Claude Code in /demo").

## Server-side changes (xenote-mcp)

- `setPresence` → per-agent entry upsert (adoption logic here); needs
  session identity + token + clientInfo in ctx.
- `getActivePresence` → per-agent: paired tab alive?
- `logEvent` → new vocabulary + `agentId` tag; emit from handlers
  (create/edit/publish/run/error), drop dead `fileChange` semantics.
- Tool-response messages (`browserAttachmentStatus`) reworded per-agent.

## Deferred / out of scope

- **#4 run/refresh redesign** (request lifecycle, rendered web-runner output
  via webframe postMessage, immediate errors, attached-ack).
- **Granular permission scopes** (separate project).

## Implementation order

1. Schema + server: agent entries w/ adoption, tab docs, pairing,
   rules; delete old single-doc semantics. (xenote-mcp + rules)
2. Feed: new `logEvent` vocabulary + emitters. (xenote-mcp)
3. Front end: Presence controller rewrite (listeners, attach/follow/detach),
   badge + bubble + panel (N=1 card first). (notebook)
4. Settings Connectors section + panel footer link. (notebook)
5. Multi-agent rendering (stacked badge, list layout). (notebook)
