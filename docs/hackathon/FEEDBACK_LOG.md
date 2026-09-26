# ShopVoice — Product feedback log

Running notes per tool/API/SDK, used to fill the Devpost "product feedback" fields. Format: used for / worked well / needs work / onboarding / would build again.

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.30.1)

- **Used for:** the `apps/mcp-server` Streamable HTTP server (`McpServer`, `StreamableHTTPServerTransport`), and the MCP client inside `apps/alexa-sim`.
- **Worked well:** `LATEST_PROTOCOL_VERSION` is already `2025-11-25`, so no configuration is needed to speak the current spec. `registerTool` takes `outputSchema` and `annotations` in one config object.
- **Needs work:** the npm package does not ship the `docs/` folder that its own README links to (`docs/server.md`, and so on), so you need the GitHub repo to read them. Built-in `allowedOrigins`/`allowedHosts` are deprecated in favour of "external middleware", but no framework-free (raw `node:http`) middleware example exists. The v1 `sdk` package and the v2 split packages (`@modelcontextprotocol/server@2.1.0`) are both "latest" on npm, which is confusing when choosing one.
- **Onboarding:** about 20 minutes from install to reading the protocol version out of `dist/esm/types.js`.
- **Would build again:** yes.

## Amazon Bedrock / Polly (via AWS SDK for JavaScript v3, 3.1140.0)

- **Used for:** the Converse API with tool use (agent brain) and Polly neural TTS in `apps/alexa-sim`.
- **Status:** not yet exercised with real credentials (BLOCKERS.md B2). Code runs against deterministic fakes behind interfaces.

## MCP Inspector (`@modelcontextprotocol/inspector` 2.8.0)

- **Used for:** protocol-conformance evidence. The CLI covered `tools/list`, `tools/call`, `resources/read` and `prompts/get`, and the web UI was driven by Playwright for screenshots (`scripts/demo/inspector_evidence.mjs`).
- **Worked well:** the web UI shows the negotiated protocol version (`MCP 2025-11-25`) next to the connection. Structured output is rendered separately from the text content. The schema-portability lint is genuinely useful.
- **Needs work:** see friction F7 (CLI argument parsing for stdio) and F8 (nullable warnings). `npx ... --web` spawns a child process that survives SIGTERM to `npx`, so scripts must kill the process group.
- **Would use again:** yes.
