// Claude as the simulator's brain, through the Anthropic API (Messages API
// with tool use). The agent loop keeps Converse-shaped history ({text},
// {toolUse}, {toolResult}); this class maps it to the Messages API and back.
// Claude's thinking blocks stay verbatim in the assistant turn they came from,
// because a tool-use loop must send them back unchanged; the agent strips them
// from the history at the end of each turn (see agent.ts).
//
// Ported from vansyson1308/shopvoice-pay apps/console/src/claude-brain.ts
// (MIT, same author; see NOTICE). Changes: Anthropic API provider only (no
// Bedrock SDK), a per-call timeout for the voice loop's turn deadline, token
// usage for the cost guard, and refusals treated as errors so the host falls
// back to the offline rules brain.
//
// The voice loop targets a quick spoken reply, so it runs Claude Sonnet 5.5 at
// low effort by default, or Claude Haiku 4.5 as the fast option
// (CLAUDE_MODEL=haiku). Opus models are refused: too slow for a spoken turn.
//
// The brain only proposes tool calls. The host (agent.ts) decides whether a
// call may run, fills in held confirmation tokens itself, and lets
// confirm_reorder through only after a spoken yes matched by its own code.
import Anthropic from '@anthropic-ai/sdk';
import type { Block, Brain, BrainCallOptions, BrainResponse, BrainUsage, ChatMessage, ToolSpec } from './brain.js';

export type VoiceModelFamily = 'sonnet' | 'haiku';
type Effort = 'low' | 'medium' | 'high';

/** The one SDK call the brain makes; the real client and test stubs both fit. */
export interface MessagesClient {
  readonly messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { timeout?: number; maxRetries?: number }): Promise<Anthropic.Message>;
  };
}

export interface ClaudeBrainConfig {
  readonly model: string;
  readonly family: VoiceModelFamily;
  /** Sent only to Sonnet 5.5; Haiku 4.5 takes no effort parameter. */
  readonly effort: Effort;
  readonly maxTokens: number;
}

export interface ClaudeEnv {
  readonly CLAUDE_MODEL?: string | undefined;
  readonly CLAUDE_EFFORT?: string | undefined;
  readonly CLAUDE_MAX_TOKENS?: string | undefined;
  readonly ANTHROPIC_API_KEY?: string | undefined;
}

export const VOICE_MODELS: Readonly<Record<VoiceModelFamily, string>> = {
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5-20251001'
};

/** USD per million tokens (Anthropic API list prices), used only for the simulator's own spend guard. */
export const PRICES_PER_MTOK: Readonly<Record<VoiceModelFamily, { input: number; output: number; cacheRead: number; cacheWrite: number }>> = {
  sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }
};

/**
 * CLAUDE_MODEL: empty or "sonnet" (default), "haiku", or a full model id of
 * either family. Anything else (Opus, Fable, unknown) is refused for voice.
 */
export function resolveVoiceModel(value: string | undefined): { model: string; family: VoiceModelFamily } {
  const raw = (value ?? '').trim();
  const alias = raw.toLowerCase();
  if (alias === '' || alias === 'sonnet') return { model: VOICE_MODELS.sonnet, family: 'sonnet' };
  if (alias === 'haiku' || alias === 'fast') return { model: VOICE_MODELS.haiku, family: 'haiku' };
  if (/^claude-sonnet-5-5(-\d{8})?$/.test(alias)) return { model: raw, family: 'sonnet' };
  if (/^claude-haiku-4-5(-\d{8})?$/.test(alias)) return { model: raw, family: 'haiku' };
  throw new Error(`CLAUDE_MODEL=${raw} is not a voice model. Use "sonnet" (Claude Sonnet 5.5, default) or "haiku" (Claude Haiku 4.5); Opus is too slow for the voice loop`);
}

export function claudeConfigFromEnv(env: ClaudeEnv): ClaudeBrainConfig {
  const effort = (['low', 'medium', 'high'] as const).find((e) => e === env.CLAUDE_EFFORT) ?? 'low';
  const { model, family } = resolveVoiceModel(env.CLAUDE_MODEL);
  const parsed = Number.parseInt(env.CLAUDE_MAX_TOKENS ?? '', 10);
  const maxTokens = Number.isFinite(parsed) ? Math.min(8192, Math.max(256, parsed)) : 2048;
  return { model, family, effort, maxTokens };
}

/** Builds the Anthropic API client. Retries are off: the turn deadline decides, then the rules brain answers. */
export function claudeClientFromEnv(env: ClaudeEnv): { client: MessagesClient; config: ClaudeBrainConfig } {
  if (!env.ANTHROPIC_API_KEY) throw new Error('SIM_BRAIN=claude needs ANTHROPIC_API_KEY');
  return { client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 }), config: claudeConfigFromEnv(env) };
}

const isNative = (b: Block): b is Block & { type: string } => typeof (b as { type?: unknown }).type === 'string';

/** Converse-shaped history -> Messages API params. Native Claude blocks (thinking) pass through untouched. */
export function toClaudeMessages(messages: readonly ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.flatMap((b): Anthropic.ContentBlockParam[] => {
      if (isNative(b)) return [b as unknown as Anthropic.ContentBlockParam];
      if ('text' in b && typeof b.text === 'string') return b.text ? [{ type: 'text', text: b.text }] : [];
      if ('toolUse' in b) {
        const u = (b as { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }).toolUse;
        return [{ type: 'tool_use', id: u.toolUseId, name: u.name, input: u.input }];
      }
      if ('toolResult' in b) {
        const r = (b as { toolResult: { toolUseId: string; content: ({ json: Record<string, unknown> } | { text: string })[]; status?: string } }).toolResult;
        const content = r.content.map((c): Anthropic.TextBlockParam => ({ type: 'text', text: 'text' in c ? c.text : JSON.stringify(c.json) }));
        return [{ type: 'tool_result', tool_use_id: r.toolUseId, content, ...(r.status === 'error' ? { is_error: true } : {}) }];
      }
      return [];
    })
  }));
}

/** Messages API response -> agent blocks: text and tool_use become {text}/{toolUse}; thinking stays native, in place. */
export function fromClaudeContent(content: readonly Anthropic.ContentBlock[]): Block[] {
  const out: Block[] = [];
  for (const block of content) {
    if (block.type === 'text') out.push({ text: block.text });
    else if (block.type === 'tool_use') out.push({ toolUse: { toolUseId: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> } });
    else if (block.type === 'thinking' || block.type === 'redacted_thinking') out.push(block as unknown as Block);
  }
  return out;
}

export function costUsd(family: VoiceModelFamily, usage: BrainUsage): number {
  const p = PRICES_PER_MTOK[family];
  return (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite) / 1_000_000;
}

/** Thrown when Claude declines a turn; the host answers it with the rules brain instead. */
export class ClaudeRefusalError extends Error {
  constructor(readonly category: string | null) {
    super('claude_refusal');
    this.name = 'ClaudeRefusalError';
  }
}

export class ClaudeBrain implements Brain {
  readonly kind = 'claude' as const;
  readonly model: string;

  constructor(private readonly client: MessagesClient, private readonly config: ClaudeBrainConfig) {
    this.model = config.model;
  }

  get family(): VoiceModelFamily {
    return this.config.family;
  }

  async converse(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }, opts: BrainCallOptions = {}): Promise<BrainResponse> {
    const started = performance.now();
    const tools: Anthropic.Tool[] = input.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema
    }));
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      // System and tools are identical on every call: one cache breakpoint covers both.
      system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
      tools,
      tool_choice: { type: 'auto' },
      messages: toClaudeMessages(input.messages),
      // Adaptive thinking (the default) at low effort keeps Sonnet 5.5 quick; Haiku 4.5 takes no effort setting.
      ...(this.config.family === 'sonnet' ? { output_config: { effort: this.config.effort } } : {})
    }, { maxRetries: 0, ...(opts.timeoutMs ? { timeout: Math.max(1, Math.round(opts.timeoutMs)) } : {}) });
    if (response.stop_reason === 'refusal') {
      const details = (response as { stop_details?: { category?: string | null } | null }).stop_details;
      throw new ClaudeRefusalError(details?.category ?? null);
    }
    const usage: BrainUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0
    };
    const stop = response.stop_reason;
    return {
      content: fromClaudeContent(response.content),
      stopReason: stop === 'tool_use' ? 'tool_use' : stop === 'end_turn' ? 'end_turn' : stop === 'max_tokens' ? 'max_tokens' : 'other',
      latencyMs: performance.now() - started,
      usage,
      costUsd: costUsd(this.config.family, usage)
    };
  }
}
