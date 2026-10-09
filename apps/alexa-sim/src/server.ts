import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, InMemoryTokenBucketRateLimiter } from '../../../packages/common/dist/index.js';
import type { LogLevel, Logger } from '../../../packages/common/dist/index.js';
import { BedrockBrain, RulesBrain } from './brain.js';
import type { Brain } from './brain.js';
import { ClaudeBrain, claudeClientFromEnv } from './claude-brain.js';
import { BrowserSpeech, PollySpeech } from './speech.js';
import type { SpeechClient } from './speech.js';
import { McpToolbox } from './toolbox.js';
import type { Toolbox } from './toolbox.js';
import { newConversation, runTurn } from './agent.js';
import type { Conversation } from './agent.js';
import { SpendGuard } from './spend-guard.js';
import { clientIpFrom, parseTrustProxy } from './client-ip.js';

export type BrainChoice = 'claude' | 'rules' | 'bedrock';

export interface SimConfig {
  readonly host: string;
  readonly port: number;
  readonly mcpUrl: string;
  /** MCP endpoint shown to visitors (the public URL when the simulator reaches MCP privately). */
  readonly publicMcpUrl: string;
  readonly mcpToken: string;
  /** claude (Anthropic API), rules (offline), or bedrock (implemented, not deployed: AWS account unavailable). */
  readonly brain: BrainChoice;
  readonly bedrockModelId: string;
  readonly awsRegion: string;
  readonly tts: 'polly' | 'browser';
  readonly pollyVoice: string;
  readonly pollyEngine: string;
  readonly accessCode: string;
  /** Per-IP turns per minute. */
  readonly turnsPerMinute: number;
  /** All visitors together, turns per minute. */
  readonly globalTurnsPerMinute: number;
  /** Trusted proxy hops in front of the simulator (Render: 2). */
  readonly trustProxyHops: number;
  /** Wall-clock budget for Claude's calls in one turn before the rules brain answers. */
  readonly turnDeadlineMs: number;
  readonly claudeDailyTurnCap: number;
  readonly claudeDailyBudgetUsd: number;
  readonly anchorDate: string;
  readonly shopTimezone: string;
  readonly originVerifySecret: string;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** SIM_BRAIN wins; when unset, Claude is used if an Anthropic API key is present, else the rules brain. */
export function chooseBrain(env: Record<string, string | undefined>): BrainChoice {
  const value = (env.SIM_BRAIN ?? '').trim().toLowerCase();
  if (value === 'claude' || value === 'rules' || value === 'bedrock') return value;
  if (value) throw new Error(`SIM_BRAIN=${value} is not one of claude, rules, bedrock`);
  return env.ANTHROPIC_API_KEY ? 'claude' : 'rules';
}

export function loadSimConfig(env: Record<string, string | undefined>): SimConfig {
  const mcpUrl = env.SIM_MCP_URL || (env.SIM_MCP_HOSTPORT ? `http://${env.SIM_MCP_HOSTPORT}/mcp` : 'http://127.0.0.1:8090/mcp');
  const budget = Number.parseFloat(env.CLAUDE_DAILY_BUDGET_USD ?? '');
  return {
    host: env.SIM_HOST ?? '0.0.0.0',
    port: Number.parseInt(env.SIM_PORT ?? '8091', 10),
    mcpUrl,
    publicMcpUrl: env.SIM_PUBLIC_MCP_URL || mcpUrl,
    mcpToken: env.SIM_MCP_TOKEN ?? env.MCP_DEMO_TOKEN ?? '',
    brain: chooseBrain(env),
    bedrockModelId: env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0',
    awsRegion: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? 'us-east-1',
    tts: env.SIM_TTS === 'polly' ? 'polly' : 'browser',
    pollyVoice: env.POLLY_VOICE_ID ?? 'Joanna',
    pollyEngine: env.POLLY_ENGINE ?? 'neural',
    accessCode: env.SIM_ACCESS_CODE ?? '',
    turnsPerMinute: positiveInt(env.SIM_TURNS_PER_MINUTE, 20),
    globalTurnsPerMinute: positiveInt(env.SIM_GLOBAL_TURNS_PER_MINUTE, 60),
    trustProxyHops: parseTrustProxy(env.SIM_TRUST_PROXY),
    turnDeadlineMs: positiveInt(env.SIM_TURN_DEADLINE_MS, 8000),
    claudeDailyTurnCap: positiveInt(env.CLAUDE_DAILY_TURN_CAP, 400),
    claudeDailyBudgetUsd: Number.isFinite(budget) && budget > 0 ? budget : 1,
    anchorDate: env.DEMO_ANCHOR_DATE ?? '',
    shopTimezone: env.SIM_SHOP_TIMEZONE ?? 'Asia/Ho_Chi_Minh',
    originVerifySecret: env.ORIGIN_VERIFY_SECRET ?? ''
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  'permissions-policy': 'microphone=(self)'
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, max = 16_384): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > max) throw new Error('body_too_large');
    chunks.push(buf);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json');
  return parsed as Record<string, unknown>;
}

function shopToday(config: SimConfig): string {
  if (config.anchorDate) return config.anchorDate;
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.shopTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export interface SimDeps {
  readonly config: SimConfig;
  readonly logger: Logger;
  readonly toolbox: Toolbox;
  readonly brain: Brain;
  readonly fallbackBrain: Brain;
  readonly speech: SpeechClient;
  readonly staticDir: string;
  /** Daily cap on Claude turns and estimated spend; defaults from config. */
  readonly spendGuard?: SpendGuard;
  /** Why the configured brain is not in use (for /api/config), e.g. a missing API key. */
  readonly brainNote?: string;
}

const BRAIN_LABELS: Record<string, string> = {
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5'
};

export function brainLabel(brain: Brain): string {
  if (brain.kind === 'rules') return 'Offline rules brain';
  if (brain.kind === 'bedrock') return `Bedrock · ${brain.model} (untested)`;
  return BRAIN_LABELS[brain.model] ?? brain.model;
}

export function createSimHandler(deps: SimDeps) {
  const { config, logger, toolbox, speech } = deps;
  const conversations = new Map<string, Conversation>();
  const limiter = new InMemoryTokenBucketRateLimiter(config.turnsPerMinute, config.turnsPerMinute);
  const globalLimiter = new InMemoryTokenBucketRateLimiter(config.globalTurnsPerMinute, config.globalTurnsPerMinute);
  const spendGuard = deps.spendGuard ?? new SpendGuard(config.claudeDailyTurnCap, config.claudeDailyBudgetUsd);

  function authorized(req: IncomingMessage): boolean {
    if (!config.accessCode) return true;
    return req.headers['x-sim-access'] === config.accessCode;
  }

  function conversationFor(id: unknown): Conversation {
    const now = Date.now();
    for (const [key, c] of conversations) if (now - c.lastSeenMs > 30 * 60_000) conversations.delete(key);
    if (typeof id === 'string' && conversations.has(id)) return conversations.get(id) as Conversation;
    if (conversations.size >= 200) {
      const oldest = [...conversations.values()].sort((a, b) => a.lastSeenMs - b.lastSeenMs)[0];
      if (oldest) conversations.delete(oldest.id);
    }
    const c = newConversation(randomUUID(), now);
    conversations.set(c.id, c);
    return c;
  }

  async function serveStatic(res: ServerResponse, path: string): Promise<void> {
    const rel = path === '/' ? 'index.html' : path.replace(/^\/static\//, '');
    const file = normalize(join(deps.staticDir, rel));
    if (!file.startsWith(deps.staticDir) || rel.includes('\0')) {
      send(res, 404, { error: 'not_found' });
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', ...SECURITY_HEADERS });
      res.end(body);
    } catch {
      send(res, 404, { error: 'not_found' });
    }
  }

  async function handleTurn(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = clientIpFrom(req, config.trustProxyHops);
    if (!limiter.consume(ip).allowed || !globalLimiter.consume('global').allowed) {
      send(res, 429, { error: 'rate_limited', reply: 'One moment please, too many requests.' });
      return;
    }
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      send(res, 400, { error: 'text_required' });
      return;
    }
    const conversation = conversationFor(body.conversationId);
    const usesModel = deps.brain.kind !== 'rules';
    const allowed = usesModel ? spendGuard.tryStartTurn() : true;
    const result = await runTurn({
      conversation,
      userText: text,
      toolbox,
      today: shopToday(config),
      now: Date.now,
      brain: deps.brain,
      ...(usesModel ? { fallbackBrain: deps.fallbackBrain, deadlineMs: config.turnDeadlineMs } : {}),
      ...(allowed ? {} : { forcedFallback: 'budget' as const })
    });
    if (usesModel) spendGuard.record(result.brain.costUsd);
    const fallback = result.brain.fallback;
    if (fallback) logger.warn('sim_brain_fallback', { reason: fallback.reason, after_rounds: fallback.afterRounds });
    logger.info('sim_turn', {
      conversation_id: conversation.id,
      tools: result.toolCalls.map((t) => t.name),
      total_ms: result.totalLatencyMs,
      brain: result.brain.kind,
      model: result.brain.model,
      cost_usd: Math.round(result.brain.costUsd * 1_000_000) / 1_000_000,
      fallback: fallback?.reason ?? null
    });
    send(res, 200, {
      conversationId: conversation.id,
      ...result,
      brainFallback: Boolean(fallback),
      fallbackReason: fallback?.reason ?? null,
      brainLabel: fallback ? brainLabel(deps.fallbackBrain) : brainLabel(deps.brain)
    });
  }

  async function handleTts(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 600) : '';
    if (!text) {
      send(res, 400, { error: 'text_required' });
      return;
    }
    try {
      const audio = await speech.synthesize(text);
      if (!audio) {
        send(res, 204, {});
        return;
      }
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', ...SECURITY_HEADERS });
      res.end(Buffer.from(audio));
    } catch (error) {
      logger.warn('sim_tts_fallback', { error: error instanceof Error ? error.name : 'unknown' });
      send(res, 204, {});
    }
  }

  return {
    conversations,
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(req.url ?? '/', 'http://localhost');
      try {
        if (req.method === 'GET' && url.pathname === '/healthz') {
          send(res, 200, { status: 'ok', service: 'alexa-sim' });
          return;
        }
        if (config.originVerifySecret) {
          const given = req.headers['x-origin-verify'];
          const value = Array.isArray(given) ? given[0] ?? '' : given ?? '';
          const ok = timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update(config.originVerifySecret).digest());
          if (!ok) {
            send(res, 403, { error: 'forbidden' });
            return;
          }
        }
        if (req.method === 'GET' && url.pathname === '/readyz') {
          try {
            const tools = await toolbox.listTools();
            send(res, 200, { status: 'ready', tools: tools.length });
          } catch {
            send(res, 503, { status: 'not_ready', checks: { mcp: 'fail' } });
          }
          return;
        }
        if (url.pathname.startsWith('/api/')) {
          if (!authorized(req)) {
            send(res, 401, { error: 'access_code_required' });
            return;
          }
          if (req.method === 'GET' && url.pathname === '/api/config') {
            const spend = spendGuard.status();
            send(res, 200, {
              brain: deps.brain.kind, model: deps.brain.model, brainLabel: brainLabel(deps.brain),
              brainNote: deps.brainNote ?? null,
              claudeAvailable: deps.brain.kind === 'claude' && !spend.exhausted,
              tts: speech.kind, voice: speech.voice,
              mcpUrl: config.publicMcpUrl, protocolVersion: toolbox.protocolVersion() ?? null, today: shopToday(config),
              accessCodeRequired: Boolean(config.accessCode)
            });
            return;
          }
          if (req.method === 'POST' && url.pathname === '/api/turn') return await handleTurn(req, res);
          if (req.method === 'POST' && url.pathname === '/api/tts') return await handleTts(req, res);
          if (req.method === 'POST' && url.pathname === '/api/reset') {
            const body = await readJson(req);
            if (typeof body.conversationId === 'string') conversations.delete(body.conversationId);
            send(res, 200, { ok: true });
            return;
          }
          send(res, 404, { error: 'not_found' });
          return;
        }
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/static/'))) {
          await serveStatic(res, url.pathname);
          return;
        }
        send(res, 404, { error: 'not_found' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        if (message === 'body_too_large' || message === 'invalid_json' || error instanceof SyntaxError) {
          send(res, 400, { error: 'bad_request' });
          return;
        }
        logger.error('sim_request_failed', { path: url.pathname, error: message });
        send(res, 502, { error: 'upstream_failed', reply: "Sorry, I couldn't reach the shop just now. Please try again." });
      }
    }
  };
}

async function main(): Promise<void> {
  const logger = createLogger({ service: 'alexa-sim', level: (process.env.LOG_LEVEL ?? 'info') as LogLevel });
  const config = loadSimConfig(process.env);
  if (config.mcpToken.length < 16) throw new Error('SIM_MCP_TOKEN (the MCP bearer token for the demo tenant) is required');
  const fallbackBrain = new RulesBrain();
  let brain: Brain = fallbackBrain;
  let brainNote: string | undefined;
  if (config.brain === 'claude') {
    if (process.env.ANTHROPIC_API_KEY) {
      // Throws for a model the voice loop refuses (Opus): fail at start, not mid-demo.
      const { client, config: claudeConfig } = claudeClientFromEnv(process.env);
      brain = new ClaudeBrain(client, claudeConfig);
    } else {
      brainNote = 'SIM_BRAIN=claude but ANTHROPIC_API_KEY is not set: using the offline rules brain';
      logger.warn('sim_claude_unavailable', { reason: 'missing ANTHROPIC_API_KEY' });
    }
  } else if (config.brain === 'bedrock') {
    // Implemented, not deployed: AWS account unavailable. Never verified against a live account.
    brain = new BedrockBrain(config.bedrockModelId, config.awsRegion);
  }
  const speech: SpeechClient = config.tts === 'polly' ? new PollySpeech(config.pollyVoice, config.awsRegion, config.pollyEngine) : new BrowserSpeech();
  const toolbox = new McpToolbox(config.mcpUrl, config.mcpToken, config.originVerifySecret ? { 'x-origin-verify': config.originVerifySecret } : {});
  const staticDir = fileURLToPath(new URL('../static/', import.meta.url));
  const handler = createSimHandler({ config, logger, toolbox, brain, fallbackBrain, speech, staticDir, ...(brainNote ? { brainNote } : {}) });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(config.port, config.host, () => {
    logger.info('sim_listening', { port: config.port, brain: brain.kind, model: brain.model, tts: speech.kind, mcp_url: config.mcpUrl });
  });
  const shutdown = () => {
    server.close();
    void toolbox.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ level: 'error', service: 'alexa-sim', message: 'sim_start_failed', error: error instanceof Error ? error.message : 'unknown' }));
    process.exit(1);
  });
}
