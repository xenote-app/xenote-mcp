# TODO

## Ship blockers (P0)
- [x] **FATAL**: New user's new workspace doesn't show up when listing user's workspaces (incl. personal/auto-created workspace failed to fetch)

## Pre-launch (P1)
- [x] Filenames are unique per article, not per 'code' element - MCP currently assumes per-code-element
- [ ] Ask to use title on 'code' element to label the group of files

## Post-launch (P2)
- [ ] Ask where to publish - maybe folders in "new workspace"
- [ ] File/binary upload (URL/base64 designed, streaming approach TBD) - cross-repo design lives at `notebook/todos/article-upload/index.md` (cloud function + command wiring is on the notebook side; MCP side just needs to expose the command)
