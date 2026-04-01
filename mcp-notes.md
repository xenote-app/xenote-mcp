# MCP TODO

## Bugs (MCP server)

- [ ] **P1: Token expiry too aggressive**
  - Agent reports ~10-15 min disconnects, testing shows ~40 min
  - Target: at least 30-60 min sessions without re-auth
  - Debug logging added — need to identify root cause before fixing
