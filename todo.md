# TODO

Ordered easiest → hardest.

- [ ] 1. `navigate` flag when fetching articles — navigate only when the flag is set, instead of navigating on every pass.
  The flag itself is trivial; the work is cross-repo. No `navigate` exists anywhere in MCP today, so whatever navigates now is front-end/event-driven and has to be found and gated.
- [ ] 2. Minimize for the MCP presence indicator (front-end side).
  Self-contained UI state in `notebook/src/modules/agent/views/MCPPresence.jsx`. Overlaps the presence model of the two items below — design alongside them.
- [ ] 3. Multiple agents working in multiple windows under the same user — handle that case.
  Presence/attachment concurrency. Overlaps the run/refresh rework below; likely wants to be designed alongside it.
- [ ] 4. Rethink and reimplement run/refresh — execution is broken. Fetch the rendered output for web-runner so agents get real execution feedback, return errors from run right away, and add a way to send back 'attached'. Worth redesigning as a whole rather than patching.
  Largest item: four bundled concerns plus a redesign, and it shares the presence model with the two items above.
