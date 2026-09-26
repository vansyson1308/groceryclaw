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

## F6. Docker Hub rate limits and blocked apt mirrors in the agent sandbox

- **Task:** build the three images of `infra/aws/compose.aws.yml` locally to rehearse the EC2 boot.
- **Actual:** `docker.io/library/node:22-bookworm-slim` HEAD returns `429 Too Many Requests` (anonymous Docker Hub pulls). `deb.debian.org` over plain HTTP returns `403` through the egress proxy.
- **Severity:** medium (it blocks a full local rehearsal of the AWS layout).
- **Workaround:** the compose file is validated with `docker compose config`. The same processes were run natively against Postgres 16 (e2e 5/5), and the `mcp-server` image built and passed a container smoke test before the rate limit hit.
- **Suggestion (for AWS):** mirror base images to **Amazon ECR Public** (`public.ecr.aws/docker/library/node:22-bookworm-slim`) to avoid Docker Hub limits on EC2 and CodeBuild too.

## F7. MCP Inspector 2.x CLI: argument order matters for stdio servers

- **Task:** list the tools of a stdio server that needs a flag and an env var.
- **Steps:** `mcp-inspector --cli -e KIOTVIET_MCP_DEMO=1 node dist/cli.js --method tools/list`, then `mcp-inspector --cli node dist/cli.js --demo --method tools/list`.
- **Expected:** both work, like the 1.x `npx @modelcontextprotocol/inspector --cli <cmd> <args>` examples.
- **Actual:** with `-e` before the target: `No servers found in config file`. With `--demo`: the flag is not forwarded to the server. Only `--cli node dist/cli.js -e KEY=VALUE --method ...` works.
- **Severity:** low.
- **Workaround:** env switch `KIOTVIET_MCP_DEMO=1`, with the documented argument order.
- **Suggestion:** support `--` to separate server args, and make the error name the argument that was misparsed.

## F8. MCP Inspector schema-portability warnings for zod `.nullable()` outputs

- **Task:** conformance check with `mcp-inspector --cli ... --method tools/list`.
- **Actual:** `Schema portability: 0 errors, 19 warnings`. All come from nullable output fields, which the SDK's zod-to-JSON-Schema conversion emits as `type: ["string","null"]`, even when written as `z.union([z.string(), z.null()])`.
- **Severity:** low (valid JSON Schema; input schemas are clean).
- **Suggestion:** an SDK option to emit `anyOf` for nullables, as the Inspector suggests.

## F9. `node --test` runs test files in parallel against one shared database
- **Task:** make the repo's `npm test` pass with `DATABASE_URL` set.
- **Steps:** `node --test tests/v2/*.test.mjs tests/v2/db/*.test.mjs tests/v2/integration/*.test.mjs` with a real Postgres.
- **Expected:** each file's fixture setup is isolated, or the runner documents that files run concurrently.
- **Actual:** files run in parallel by default. Several DB test files wipe shared tables (`DELETE FROM tenants`), so one file removed rows another had just seeded, and a foreign-key violation appeared only in the full run.
- **Severity:** medium (intermittent, hard to reproduce file by file).
- **Workaround:** keep unit files parallel and run `tests/v2/db` and `tests/v2/integration` with `--test-concurrency=1`.
- **Suggestion:** Node's test runner docs could say more clearly that each file runs in its own process and in parallel, and show a per-glob concurrency pattern for integration tests.

## F10. A "free port" helper can hand out the same port twice
- **Task:** start gateway test servers on free ports so a failed test can't block later ones.
- **Steps:** call a helper twice that listens on port 0, reads the port and closes, then start a server with both ports (service + metrics).
- **Expected:** two different ports.
- **Actual:** on the GitHub runner (Node 20) the kernel returned the same port twice in a row. The gateway crashed with `EADDRINUSE` on its own second listener. Locally it never happened.
- **Severity:** low (one CI round).
- **Workaround:** the helper remembers ports it has already handed out and skips them.
- **Suggestion:** a built-in way to pass `0` for every listener and read the bound ports back from the child would avoid the race entirely.

## F11. Playwright `recordVideo` timestamps drift from wall-clock time
- **Task:** record the voice simulator for the demo video and line up pre-synthesized speech with the picture.
- **Steps:** Chromium headless, `browser.newContext({ recordVideo: { size: 1440x810 } })`, drive five turns over about 72 s of wall-clock time, and place the audio at wall-clock offsets.
- **Expected:** the webm spans the same 72 s.
- **Actual:** the webm lasted 80.8 s, a constant 1.13x stretch, so the picture fell up to 6 s behind the voices by the last turn. Separately, when heavy CPU work (neural TTS) ran mid-recording, the screencast held a stale frame until the next DOM change.
- **Severity:** medium (silent: nothing fails, the video just drifts out of sync).
- **Workaround:** read the last packet timestamp and rescale with `setpts` onto the recorder's clock; synthesize all audio before recording; keep one invisible animation running so frames keep flowing.
- **Suggestion:** Playwright could expose the video's start time and real frame timestamps (or a `video.duration()`), and document that `recordVideo` output is not guaranteed to be real-time.
