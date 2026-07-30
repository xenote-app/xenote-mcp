# TODO

Ordered easiest → hardest.

- [ ] Ask to use title on 'code' element to label the group of files
  Guides only, no code. `settings.title` already exists and both guides list it, but nothing tells agents to set it — it sits in an "other settings" list while `layout` right above gets a strong directive. Real articles ship with unlabeled code groups.
- [ ] Expose the 'unlist' logic in MCP so agents know how to use it. Also ask agents to make a common unlisted article instead of importing from another article — this avoids big issues later.
  `isUnlisted` already exists on article documents, just exposed nowhere. One schema property + one handler line + a guide note.
- [ ] Disable deleteArticle — keep the tool present, but reply that deletion must be a user action, pointing them to the folder to delete manually, with a manual link in the reply.
  Contained: replace the `deleteArticle` branch at `handlers.js:1733` (wired to `deleteArticleCall`) and rewrite the bit of the `folder` description that currently just warns it is irreversible.
- [ ] Show the logged-in user's email on the MCP authentication page so they know which account they are authorizing.
  `notebook/src/modules/app/views/MCPAuth.jsx` is 95 lines and already holds the user object in scope — close to a one-line addition.
- [ ] Minimize for the MCP presence indicator (front-end side).
  Self-contained UI state in `notebook/src/modules/agent/views/MCPPresence.jsx`.
- [ ] Make 'wide' the default page width on article creation, and make sure agents know they are working in wide so they build items accordingly.
  Default is currently 'normal'. `createArticleCall` takes only `layoutType`, so either follow the create with a `pageWidth` update on the MCP side (easy) or default it in the cloud function (cross-repo). Guidance half is trivial.
- [ ] `navigate` flag when fetching articles — navigate only when the flag is set, instead of navigating on every pass.
  The flag itself is trivial; the work is cross-repo. No `navigate` exists anywhere in MCP today, so whatever navigates now is front-end/event-driven and has to be found and gated.
- [ ] Count of changes on a published article — could be the sum across all versions. Return that sum so agents can tell what is published.
  Versions and `fetchVersions` already exist, so it is tractable. Needs a decision first on what counts as a "change" and whether it is computed on read or stored at publish.
- [ ] Ask where to publish - maybe folders in "new workspace"
  Needs scoping before it is actionable. The guidance half already landed: the `folder` tool says most content belongs in an existing workspace and to confirm title + slug before `createWorkspace`. What remains is the folders-in-a-new-workspace idea and asking for a location rather than picking one.
- [ ] Error reporting tool inside MCP that sends the error to a xenote email address.
  Bigger than it reads: there is no mailer anywhere in notebook functions, so this needs a provider picked, secrets wired, and a cloud function deployed before the MCP tool is worth adding.
- [ ] requiredArticles is unclear over MCP — agents keep recommending it when it does not apply. Needs a programmable `isComplete` call made from inside the notebook.
  The guidance fix is easy; the `isComplete` call is a new cross-repo runtime surface (articles reporting completion programmatically) and is the real work.
- [ ] File/binary upload (URL/base64 designed, streaming approach TBD) - cross-repo design lives at `notebook/todos/article-upload/index.md` (cloud function + command wiring is on the notebook side; MCP side just needs to expose the command)
  Nothing built on either side yet: no `article_upload` tool here, no `uploadFromSource` function or MCP-only command flag in notebook. Blocked on the design doc's own open streaming question, which it says to decide before implementing.
- [ ] Multiple agents working in multiple windows under the same user — handle that case.
  Presence/attachment concurrency. Overlaps the run/refresh rework below; likely wants to be designed alongside it.
- [ ] Rethink and reimplement run/refresh — execution is broken. Fetch the rendered output for web-runner so agents get real execution feedback, return errors from run right away, and add a way to send back 'attached'. Worth redesigning as a whole rather than patching.
  Largest item: four bundled concerns plus a redesign, and it shares the presence model with the two items above.
