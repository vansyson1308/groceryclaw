# Draft PR for `modelcontextprotocol/typescript-sdk`

**Status:** drafted, not opened. The owner opens it from their own GitHub account, since the agent never opens external PRs.

**Target:** `modelcontextprotocol/typescript-sdk`, branch `main` (v1.x examples in `src/examples/server/`).
**Patch:** `0001-examples-node-http-auth-streamable-http.patch` adds one new file, `src/examples/server/nodeHttpAuthStreamableHttp.ts`.

## How to open it

```bash
gh repo fork modelcontextprotocol/typescript-sdk --clone && cd typescript-sdk
git checkout -b examples/node-http-auth
git apply /path/to/groceryclaw/docs/hackathon/oss/typescript-sdk-example/0001-examples-node-http-auth-streamable-http.patch
npm install && npx tsc --noEmit -p .   # plus the repo's lint, if configured
MCP_TOKENS="alice:token-a" npx tsx src/examples/server/nodeHttpAuthStreamableHttp.ts
git commit -am "examples: Streamable HTTP on plain node:http with Origin validation and per-session bearer auth"
gh pr create --title "examples: Streamable HTTP on plain node:http with Origin validation + bearer auth" --body-file PR_BODY.md
```

Also add a row to the "Server examples" table in `README.md` / `src/examples/README.md` if the maintainers want it listed.

---

## PR title

examples: Streamable HTTP on plain `node:http` with Origin validation and per-session bearer auth

## PR body

### Motivation

`WebStandardStreamableHTTPServerTransportOptions.allowedOrigins`, `allowedHosts` and `enableDnsRebindingProtection` are marked `@deprecated Use external middleware`. However, the only middleware examples target Express and Hono. People building on plain `node:http`, which many small or embedded servers use, have no reference for:

1. the **Origin validation** the Streamable HTTP spec requires against DNS rebinding;
2. **bearer authentication**, and binding a session to the principal that created it so one caller's token cannot drive another caller's `Mcp-Session-Id`.

We hit exactly this while building an Alexa+ MCP server for grocery shops (ShopVoice, *Build, Ship, Shape* hackathon). This example is the minimal, framework-free version of what we ended up with.

### What it adds

`src/examples/server/nodeHttpAuthStreamableHttp.ts` (about 110 lines, no new dependencies):
- the Origin allow-list check runs before anything else; requests without an `Origin` header (server-to-server) are allowed;
- `Authorization: Bearer` is checked against SHA-256 digests with `timingSafeEqual`, and tokens are never logged;
- `401` responses carry `WWW-Authenticate`;
- sessions are keyed by `Mcp-Session-Id` and bound to their principal. A foreign or unknown session gets the same `404`, so there is no enumeration oracle;
- a `whoami` tool with `outputSchema` shows that the principal reaches handlers.

### Testing

Verified against `@modelcontextprotocol/sdk` 1.30.1 (protocol `2025-11-25`):
- `npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --header "Authorization: Bearer token-a" --method tools/call --tool-name whoami` returns `You are alice.`;
- a bad `Origin` gets `403`; a missing or wrong token gets `401`.

### Notes

This is a static-token example. It deliberately does not replace the OAuth examples (`simpleStreamableHttp.ts --oauth`); it shows where the checks go on a raw Node server.
