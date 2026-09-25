# ShopVoice — Friction log

For each friction: task, steps, expected vs actual, severity (low/med/high), workaround, suggestion. Appended as issues happen.

## F1. MCP SDK docs are not in the npm tarball

- **Task:** confirm which protocol version `@modelcontextprotocol/sdk` negotiates, and how Streamable HTTP DNS-rebinding protection should be configured.
- **Steps:** `npm i @modelcontextprotocol/sdk@1.30.1`, then open the README and follow its links to `docs/server.md`.
- **Expected:** the linked docs ship with the package, or the README links to the versioned docs site.
- **Actual:** the links are relative to the GitHub repo, and `node_modules/@modelcontextprotocol/sdk/` has no `docs/`. The protocol version had to be read from `dist/esm/types.js`.
- **Severity:** low.
- **Workaround:** read the `.d.ts` files (`webStandardStreamableHttp.d.ts` has the option docs).
- **Suggestion:** ship `docs/` in the package, or use absolute versioned URLs in the README.

## F2. Built-in Origin validation is deprecated with no replacement example for raw Node

- **Task:** validate `Origin` on `/mcp`, as the MCP spec requires for Streamable HTTP.
- **Expected:** a supported option, or a documented middleware for plain `node:http`.
- **Actual:** `allowedOrigins`, `allowedHosts` and `enableDnsRebindingProtection` are all marked `@deprecated Use external middleware`. The only middleware shipped is for Express/Hono.
- **Severity:** medium, because a server author on raw `node:http` can easily miss this security requirement.
- **Workaround:** a 20-line Origin allow-list check before calling `transport.handleRequest`.
- **Suggestion:** export a framework-agnostic `validateOrigin(req, allowList)` helper.

## F3. Agent sandbox AWS credentials are placeholders

- **Task:** call Bedrock Converse and Polly from the build environment.
- **Actual:** `InvalidClientTokenId` / `UnrecognizedClientException` on STS, Bedrock and Polly.
- **Severity:** high for AWS-dependent milestones.
- **Workaround:** interfaces plus deterministic fakes; real clients activate when credentials exist.
- **Suggestion:** for the hackathon, a short-lived sandbox credential or a Bedrock playground API key would lower the barrier.

## F4. `StreamableHTTPServerTransport` is not assignable to `Transport` under `exactOptionalPropertyTypes`

- **Task:** `await server.connect(new StreamableHTTPServerTransport({...}))` in a strict TypeScript project (`exactOptionalPropertyTypes: true`, which this repo uses).
- **Expected:** it compiles, since the class `implements Transport`.
- **Actual:** `TS2379: Argument of type 'StreamableHTTPServerTransport' is not assignable to parameter of type 'Transport' with 'exactOptionalPropertyTypes: true'`. The getters `onclose`/`onerror`/`onmessage` return `T | undefined`, but the interface declares optional properties without `| undefined`.
- **Severity:** low (it's types only; runtime is fine).
- **Workaround:** `server.connect(transport as unknown as Transport)`, with a comment (`apps/mcp-server/src/http.ts`).
- **Suggestion:** declare `onclose?: (() => void) | undefined` and so on in `Transport`, and run the SDK's own type tests with `exactOptionalPropertyTypes`.

## F5. Docker builds in the agent sandbox need `--network host` for npm

- **Task:** `docker build -f apps/mcp-server/Dockerfile .`
- **Actual:** `npm ci` inside the build fails with `npm error Exit handler never called!` (no egress from the default bridge network). `docker build --network host` works.
- **Severity:** low (environment-specific; CI and AWS CodeBuild are unaffected).
- **Workaround:** `scripts/aws/deploy.sh` passes `--network host` when `DOCKER_BUILD_NETWORK=host`.
