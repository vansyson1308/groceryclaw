import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../../../packages/common/dist/index.js';
import type { ShopStore } from './store.js';
import { ShopDataError } from './store.js';
import { ALL_TOOLS } from './tools.js';
import type { ToolContext, ToolDefinition } from './tools.js';
import { countWords, fitSpeech, MAX_SPOKEN_WORDS } from './speech.js';
import type { z } from 'zod';

export const SERVER_NAME = 'shopvoice';
export const SERVER_VERSION = '0.1.0';

export interface McpFactoryOptions {
  readonly store: ShopStore;
  readonly tenantId: string;
  readonly logger: Logger;
  readonly confirmTtlSeconds: number;
  readonly onToolLatency?: (tool: string, latencyMs: number, outcome: 'ok' | 'error') => void;
}

const SAFE_ERROR_SPEECH = "Sorry, I couldn't reach your shop data just now. Please try again in a moment.";

export function safeErrorSpeech(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (error instanceof ShopDataError && error.code === 'profile_missing') {
    return 'Your shop profile is not set up yet, so I cannot answer that. Please finish setup in the GroceryClaw app.';
  }
  if (message.startsWith('custom_period') || message.startsWith('invalid_date')) {
    return 'I need a valid date range in the past, for example from the first to the seventh of this month.';
  }
  return SAFE_ERROR_SPEECH;
}

function defaultRedact(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = /token|secret|password/i.test(key) ? '[redacted]' : value;
  }
  return out;
}

/** One McpServer per MCP session, bound to the tenant resolved from the bearer token. */
export function createShopVoiceServer(opts: McpFactoryOptions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: 'ShopVoice', version: SERVER_VERSION },
    {
      capabilities: { tools: {}, prompts: {}, resources: {} },
      instructions: 'ShopVoice answers a grocery shop owner by voice. Tool results include content[0].text: a short sentence meant to be spoken as-is. Reorders are two-step: create_reorder_draft, read the summary aloud, and call confirm_reorder only after the owner explicitly says yes.'
    }
  );

  for (const tool of ALL_TOOLS) {
    registerTool(server, tool as unknown as ToolDefinition<z.ZodRawShape, z.ZodRawShape>, opts);
  }

  server.registerPrompt('morning_briefing', {
    title: 'Morning shop briefing',
    description: 'Start-of-day briefing for the shop owner: sales, low stock and invoices, then offer next steps.'
  }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: 'Give me my morning shop briefing. Call get_daily_briefing and speak its answer. Then ask if I want to hear what is running low or draft a reorder. Keep every spoken answer under 35 words.'
      }
    }]
  }));

  server.registerResource('shop-profile', 'shop://profile', {
    title: 'Shop profile',
    description: 'Shop name, display currency, timezone and locale for the connected shop.',
    mimeType: 'application/json'
  }, async (uri) => {
    const profile = await opts.store.withTenant(opts.tenantId, (repo) => repo.getProfile());
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          shop_name: profile.shopName,
          display_currency: profile.displayCurrency,
          vnd_per_display_unit: profile.vndPerDisplayUnit,
          timezone: profile.timezone,
          locale: profile.locale
        })
      }]
    };
  });

  return server;
}

function registerTool(server: McpServer, tool: ToolDefinition<z.ZodRawShape, z.ZodRawShape>, opts: McpFactoryOptions): void {
  server.registerTool(tool.name, {
    title: tool.title,
    description: tool.description,
    inputSchema: tool.input,
    outputSchema: tool.output,
    annotations: { title: tool.title, ...tool.annotations }
  }, async (rawArgs: Record<string, unknown>) => {
    const started = performance.now();
    const args = rawArgs as z.infer<z.ZodObject<z.ZodRawShape>>;
    const redacted = tool.redact ? tool.redact(args) : defaultRedact(rawArgs);
    try {
      const outcome = await opts.store.withTenant(opts.tenantId, async (repo) => {
        const profile = await repo.getProfile();
        const ctx: ToolContext = {
          repo,
          profile,
          today: await repo.today(),
          money: { currency: profile.displayCurrency, vndPerUnit: profile.vndPerDisplayUnit },
          confirmTtlSeconds: opts.confirmTtlSeconds
        };
        return tool.run(ctx, args);
      });
      let speech = outcome.speech;
      if (countWords(speech) > MAX_SPOKEN_WORDS) {
        opts.logger.warn('mcp_speech_over_budget', { tool: tool.name, words: countWords(speech) });
        speech = fitSpeech([speech]);
      }
      const latencyMs = performance.now() - started;
      await audit(opts, tool.name, redacted, speech, 'ok', latencyMs);
      opts.onToolLatency?.(tool.name, latencyMs, 'ok');
      return {
        content: [{ type: 'text' as const, text: speech }],
        structuredContent: outcome.data as Record<string, unknown>
      };
    } catch (error) {
      const latencyMs = performance.now() - started;
      const speech = safeErrorSpeech(error);
      opts.logger.error('mcp_tool_failed', { tool: tool.name, tenant_id: opts.tenantId, error: error instanceof Error ? error.message : 'unknown' });
      await audit(opts, tool.name, redacted, speech, 'error', latencyMs);
      opts.onToolLatency?.(tool.name, latencyMs, 'error');
      return { content: [{ type: 'text' as const, text: speech }], isError: true };
    }
  });
}

async function audit(opts: McpFactoryOptions, toolName: string, args: Record<string, unknown>, summary: string, outcome: 'ok' | 'error', latencyMs: number): Promise<void> {
  try {
    await opts.store.withTenant(opts.tenantId, (repo) => repo.audit({ toolName, argsRedacted: args, resultSummary: summary, outcome, latencyMs }));
  } catch (error) {
    // Auditing must never break the spoken answer; surface it in logs instead.
    opts.logger.error('mcp_audit_failed', { tool: toolName, error: error instanceof Error ? error.message : 'unknown' });
  }
}
