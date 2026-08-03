# TODO

Ordered easiest → hardest.

- [ ] 1. `navigate` flag when fetching articles — navigate only when the flag is set, instead of navigating on every pass.
  The flag itself is trivial; the work is cross-repo. No `navigate` exists anywhere in MCP today, so whatever navigates now is front-end/event-driven and has to be found and gated.
- [ ] 2. Count of changes on a published article — could be the sum across all versions. Return that sum so agents can tell what is published.
  Versions and `fetchVersions` already exist, so it is tractable. Needs a decision first on what counts as a "change" and whether it is computed on read or stored at publish.
- [ ] 3. Ask where to publish - maybe folders in "new workspace"
  Needs scoping before it is actionable. The guidance half already landed: the `folder` tool says most content belongs in an existing workspace and to confirm title + slug before `createWorkspace`. What remains is the folders-in-a-new-workspace idea and asking for a location rather than picking one.
- [ ] 4. Error reporting tool inside MCP that sends the error to a xenote email address.
  Bigger than it reads: there is no mailer anywhere in notebook functions, so this needs a provider picked, secrets wired, and a cloud function deployed before the MCP tool is worth adding.
- [ ] 5. File/binary upload (URL/base64 designed, streaming approach TBD) - cross-repo design lives at `notebook/todos/article-upload/index.md` (cloud function + command wiring is on the notebook side; MCP side just needs to expose the command)
  Nothing built on either side yet: no `article_upload` tool here, no `uploadFromSource` function or MCP-only command flag in notebook. Blocked on the design doc's own open streaming question, which it says to decide before implementing.
- [ ] 6. Minimize for the MCP presence indicator (front-end side).
  Self-contained UI state in `notebook/src/modules/agent/views/MCPPresence.jsx`. Overlaps the presence model of the two items below — design alongside them.
- [ ] 7. Multiple agents working in multiple windows under the same user — handle that case.
  Presence/attachment concurrency. Overlaps the run/refresh rework below; likely wants to be designed alongside it.
- [ ] 8. Rethink and reimplement run/refresh — execution is broken. Fetch the rendered output for web-runner so agents get real execution feedback, return errors from run right away, and add a way to send back 'attached'. Worth redesigning as a whole rather than patching.
  Largest item: four bundled concerns plus a redesign, and it shares the presence model with the two items above.
