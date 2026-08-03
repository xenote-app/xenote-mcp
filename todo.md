# TODO

Ordered easiest → hardest.

- [x] 1. Ask to use title on 'code' element to label the group of files
  Done 8/3/2026: `title? (recommended group label)` in the tools.js code settings, own line in code-and-files.md, and all three worked examples now carry a title.
  Guides only, no code. `settings.title` already exists and both guides list it, but nothing tells agents to set it — it sits in an "other settings" list while `layout` right above gets a strong directive. Real articles ship with unlabeled code groups.
- [ ] 2. Tables in prose are not obvious and are rarely used — surface them where agents actually look.
  Root cause is in one string: the `text` type description at `tools.js:161` lists `<p>`, `<h2>`, `<strong>`, `<math>` and never `<table>` — it advertises the more exotic capability while omitting tables. It is also the only element type with no `get_guide()` directive, so nothing points at `guides/elements.md:14-25`, where a full "Tables (inside text)" section already exists. Fix is adding `<table>` to that list plus a guide pointer.
- [ ] 3. Expose the 'unlist' logic in MCP so agents know how to use it. Also ask agents to make a common unlisted article instead of importing from another article — this avoids big issues later.
  `isUnlisted` already exists on article documents, just exposed nowhere. One schema property + one handler line + a guide note.
- [ ] 4. Disable deleteArticle — keep the tool present, but reply that deletion must be a user action, pointing them to the folder to delete manually, with a manual link in the reply.
  Contained: replace the `deleteArticle` branch at `handlers.js:1733` (wired to `deleteArticleCall`) and rewrite the bit of the `folder` description that currently just warns it is irreversible.
- [ ] 5. Show the logged-in user's email on the MCP authentication page so they know which account they are authorizing.
  `notebook/src/modules/app/views/MCPAuth.jsx` is 95 lines and already holds the user object in scope — close to a one-line addition.
- [ ] 6. Minimize for the MCP presence indicator (front-end side).
  Self-contained UI state in `notebook/src/modules/agent/views/MCPPresence.jsx`.
- [ ] 7. Make 'wide' the default page width on article creation, and make sure agents know they are working in wide so they build items accordingly.
  Default is currently 'normal'. `createArticleCall` takes only `layoutType`, so either follow the create with a `pageWidth` update on the MCP side (easy) or default it in the cloud function (cross-repo). Guidance half is trivial.
- [ ] 8. Table width in prose — decide what it should actually do.
  Front-end, and it is a deliberate existing choice rather than an oversight: `notebook/src/modules/elements/all/Text/Editor/style.css` excludes tables from the reading measure on purpose ("Wide blocks (tables, code, images) are intentionally excluded and stay full-width") and sets `table-layout: fixed; width: 100%`. So a table in a `normal`-width article spans the full container with equal-width columns regardless of content. Needs a call on the wanted behaviour before any CSS changes; interacts with the 'wide' default above.
- [ ] 9. `navigate` flag when fetching articles — navigate only when the flag is set, instead of navigating on every pass.
  The flag itself is trivial; the work is cross-repo. No `navigate` exists anywhere in MCP today, so whatever navigates now is front-end/event-driven and has to be found and gated.
- [ ] 10. Count of changes on a published article — could be the sum across all versions. Return that sum so agents can tell what is published.
  Versions and `fetchVersions` already exist, so it is tractable. Needs a decision first on what counts as a "change" and whether it is computed on read or stored at publish.
- [ ] 11. Ask where to publish - maybe folders in "new workspace"
  Needs scoping before it is actionable. The guidance half already landed: the `folder` tool says most content belongs in an existing workspace and to confirm title + slug before `createWorkspace`. What remains is the folders-in-a-new-workspace idea and asking for a location rather than picking one.
- [ ] 12. Error reporting tool inside MCP that sends the error to a xenote email address.
  Bigger than it reads: there is no mailer anywhere in notebook functions, so this needs a provider picked, secrets wired, and a cloud function deployed before the MCP tool is worth adding.
- [x] 13. requiredArticles is unclear over MCP — agents keep recommending it when it does not apply. Needs a programmable `isComplete` call made from inside the notebook.
  Done 8/3/2026: the programmable call already existed (`/core/completion` — markComplete/fetchIsComplete over the runner bridge). Fixed the guidance instead: responses omit `requiredArticles` when empty (fetch, folder listings; public_fetch article payload never includes it — live-doc state doesn't belong in the snapshot), tool + schema descriptions now say it's for course gates (quiz/test before advancing), guides point at `public_fetch /core/completion` (dropped /references/mark-complete), and the live /core/completion article was rewritten and republished with both setup paths and the permanent-lock caveat.
- [ ] 14. File/binary upload (URL/base64 designed, streaming approach TBD) - cross-repo design lives at `notebook/todos/article-upload/index.md` (cloud function + command wiring is on the notebook side; MCP side just needs to expose the command)
  Nothing built on either side yet: no `article_upload` tool here, no `uploadFromSource` function or MCP-only command flag in notebook. Blocked on the design doc's own open streaming question, which it says to decide before implementing.
- [ ] 15. Multiple agents working in multiple windows under the same user — handle that case.
  Presence/attachment concurrency. Overlaps the run/refresh rework below; likely wants to be designed alongside it.
- [ ] 16. Rethink and reimplement run/refresh — execution is broken. Fetch the rendered output for web-runner so agents get real execution feedback, return errors from run right away, and add a way to send back 'attached'. Worth redesigning as a whole rather than patching.
  Largest item: four bundled concerns plus a redesign, and it shares the presence model with the two items above.
