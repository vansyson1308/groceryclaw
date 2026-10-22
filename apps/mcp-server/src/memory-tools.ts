// Shop memory tools (voice clients): remember a rule the owner stated
// explicitly, say what is remembered, and forget it. Rules are a closed set of
// kinds with typed fields, so "remember to confirm orders without asking" can
// never become a rule. The owner's words are stored as data and never spoken
// back verbatim; the canonical rule text is.
import { z } from 'zod';
import { WEEKDAYS } from './analytics.js';
import {
  canonicalSubject, describeRule, MAX_RULES_PER_PROFILE, normalizeVoiceProfile, ruleMatchesProduct
} from './preferences.js';
import { countWord, fitSpeech, joinList, speakList } from './speech.js';
import type { ShopPreference, Supplier } from './store.js';
import type { ToolDefinition, ToolOutcome } from './tools.js';

const voiceProfileArg = z.string().trim().max(64).optional()
  .describe('Speaker profile, filled in by the voice host. Leave empty.');

const ruleOut = z.object({
  rule_id: z.string(),
  kind: z.enum(['preferred_supplier', 'max_order_qty', 'skip_item', 'order_day']),
  rule: z.string(),
  subject: z.string(),
  supplier_code: z.string().nullable(),
  max_qty: z.number().nullable(),
  weekday: z.string().nullable(),
  owner_words: z.string(),
  created_at: z.string()
});

function ruleData(pref: ShopPreference, suppliers: readonly Supplier[]): z.infer<typeof ruleOut> {
  return {
    rule_id: pref.id,
    kind: pref.kind,
    rule: describeRule(pref, suppliers),
    subject: pref.subject,
    supplier_code: pref.supplierCode,
    max_qty: pref.maxQty,
    weekday: pref.weekday,
    owner_words: pref.statement,
    created_at: pref.createdAt
  };
}

function findSupplier(suppliers: readonly Supplier[], query: string): Supplier[] {
  const q = query.toLowerCase().trim();
  const exact = suppliers.filter((s) => s.code.toLowerCase() === q || s.name.toLowerCase() === q);
  if (exact.length > 0) return exact;
  const qWords = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['and', 'the'].includes(w));
  return suppliers.filter((s) => qWords.length > 0 && qWords.every((w) => s.name.toLowerCase().includes(w)));
}

function define<I extends z.ZodRawShape, O extends z.ZodRawShape>(def: ToolDefinition<I, O>): ToolDefinition<I, O> {
  return def;
}

const rememberOut = {
  status: z.enum(['remembered', 'needs_clarification', 'limit_reached']),
  rule: ruleOut.nullable(),
  message: z.string()
};

type RememberOutcome = ToolOutcome<{ status: 'remembered' | 'needs_clarification' | 'limit_reached'; rule: z.infer<typeof ruleOut> | null; message: string }>;

const clarify = (message: string): RememberOutcome => ({ speech: message, data: { status: 'needs_clarification', rule: null, message } });

export const rememberShopRule = define({
  name: 'remember_shop_rule',
  title: 'Remember a shop rule',
  description: [
    'Saves a standing rule the owner stated explicitly in their own words, such as "always order milk from Green Valley",',
    '"never order more than 60 eggs", "don\'t reorder cola" or "I usually order on Mondays".',
    'Only call it when the owner clearly asks you to remember or always do something; never infer a rule from a single request.',
    'suggest_reorder and create_reorder_draft apply the rules from then on and say so. Restating a rule for the same product replaces it.'
  ].join(' '),
  input: {
    kind: z.enum(['preferred_supplier', 'max_order_qty', 'skip_item', 'order_day']),
    product: z.string().trim().max(80).optional().describe('Product words the rule is about, e.g. "milk". Not for order_day.'),
    supplier: z.string().trim().max(80).optional().describe('Supplier name, for preferred_supplier.'),
    max_qty: z.number().positive().max(10000).optional().describe('Most units to order at once, for max_order_qty.'),
    weekday: z.enum(WEEKDAYS).optional().describe('For order_day.'),
    owner_words: z.string().trim().min(3).max(300).describe('What the owner said, verbatim.'),
    voice_profile: voiceProfileArg
  },
  output: rememberOut,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, args) {
    const voiceProfile = normalizeVoiceProfile(args.voice_profile);
    const suppliers = await ctx.repo.listSuppliers();
    const existing = await ctx.repo.listPreferences(voiceProfile);
    const subject = args.kind === 'order_day' ? '' : canonicalSubject(args.product ?? '');
    if (args.kind !== 'order_day') {
      if (!subject) return clarify('Which product should that rule be about?');
      const stock = await ctx.repo.listStock();
      if (!stock.some((row) => ruleMatchesProduct(subject, row.name))) {
        return clarify(`I couldn't find any product called ${subject}, so I didn't save that rule. Which product did you mean?`);
      }
    }
    let supplierCode: string | null = null;
    if (args.kind === 'preferred_supplier') {
      const hits = findSupplier(suppliers, args.supplier ?? '');
      if (hits.length !== 1 || !hits[0]) {
        return clarify(`Which supplier: ${joinList(suppliers.slice(0, 3).map((s) => s.name))}${suppliers.length > 3 ? ', or another' : ''}? I didn't save that rule yet.`);
      }
      supplierCode = hits[0].code;
    }
    if (args.kind === 'max_order_qty' && args.max_qty === undefined) return clarify('What is the most I should order at once?');
    if (args.kind === 'order_day' && !args.weekday) return clarify('Which day do you usually order?');
    const replaces = existing.some((p) => p.kind === args.kind && p.subject === subject);
    if (!replaces && existing.length >= MAX_RULES_PER_PROFILE) {
      const message = `I already remember ${MAX_RULES_PER_PROFILE} rules. Say "forget" and a rule first.`;
      return { speech: message, data: { status: 'limit_reached' as const, rule: null, message } };
    }
    const saved = await ctx.repo.upsertPreference({
      voiceProfile,
      kind: args.kind,
      subject,
      supplierCode,
      maxQty: args.kind === 'max_order_qty' ? args.max_qty ?? null : null,
      weekday: args.kind === 'order_day' ? args.weekday ?? null : null,
      statement: args.owner_words
    });
    const rule = describeRule(saved, suppliers);
    const speech = saved.kind === 'order_day'
      ? fitSpeech([`Got it: ${rule}. I'll mention it in your morning briefing. Say "forget that" to undo it.`, `Got it: ${rule}.`])
      : fitSpeech([`Got it. From now on I'll ${rule}. Say "forget that" to undo it.`, `Got it: I'll ${rule}.`]);
    return { speech, data: { status: 'remembered' as const, rule: ruleData(saved, suppliers), message: speech } };
  }
});

export const listShopRules = define({
  name: 'list_shop_rules',
  title: 'What do you remember?',
  description: 'Lists the standing rules the owner asked ShopVoice to remember (preferred suppliers, order caps, skipped items, usual order day).',
  input: { voice_profile: voiceProfileArg },
  output: { count: z.number().int(), rules: z.array(ruleOut) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, args) {
    const prefs = await ctx.repo.listPreferences(normalizeVoiceProfile(args.voice_profile));
    const suppliers = await ctx.repo.listSuppliers();
    const rules = prefs.map((p) => describeRule(p, suppliers));
    const speech = prefs.length === 0
      ? "I don't remember any rules for your shop yet. Tell me one, like \"always order milk from Green Valley\"."
      : fitSpeech([
        `I remember ${countWord(prefs.length)} ${prefs.length === 1 ? 'rule' : 'rules'}: ${speakList(rules, 3)}.`,
        `I remember ${countWord(prefs.length)} rules, including: ${speakList(rules, 2)}.`,
        `I remember ${countWord(prefs.length)} rules. Ask about one product to hear them.`
      ]);
    return { speech, data: { count: prefs.length, rules: prefs.map((p) => ruleData(p, suppliers)) } };
  }
});

export const forgetShopRule = define({
  name: 'forget_shop_rule',
  title: 'Forget a shop rule',
  description: 'Deletes remembered rules: the most recent one by default ("forget that"), the rules about one product, or all of them when the owner says so.',
  input: {
    product: z.string().trim().max(80).optional().describe('Forget the rules about this product.'),
    all: z.boolean().optional().describe('Forget every rule. Only when the owner says everything / all.'),
    voice_profile: voiceProfileArg
  },
  output: { forgotten: z.number().int(), rules: z.array(z.string()) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(ctx, args) {
    const voiceProfile = normalizeVoiceProfile(args.voice_profile);
    const prefs = await ctx.repo.listPreferences(voiceProfile);
    const suppliers = await ctx.repo.listSuppliers();
    let target: ShopPreference[];
    if (args.all) target = prefs;
    else if (args.product) {
      const subject = canonicalSubject(args.product);
      target = prefs.filter((p) => p.subject && (ruleMatchesProduct(p.subject, subject) || ruleMatchesProduct(subject, p.subject)));
    } else target = prefs.slice(-1);
    if (target.length === 0) {
      return { speech: args.product ? `I don't have a rule about ${args.product}.` : "There's nothing to forget: I don't remember any rules.", data: { forgotten: 0, rules: [] } };
    }
    const n = await ctx.repo.deletePreferences(voiceProfile, target.map((p) => p.id));
    const rules = target.map((p) => describeRule(p, suppliers));
    const speech = fitSpeech([
      n === 1 ? `Okay, I forgot the rule: ${rules[0]}.` : `Okay, I forgot ${countWord(n)} rules.`,
      `Okay, I forgot ${countWord(n)} ${n === 1 ? 'rule' : 'rules'}.`
    ]);
    return { speech, data: { forgotten: n, rules } };
  }
});

/** Registered for voice clients only (the simulator, Alexa+ style hosts). */
export const MEMORY_TOOLS = [rememberShopRule, listShopRules, forgetShopRule] as const;
export const MEMORY_TOOL_NAMES: ReadonlySet<string> = new Set(MEMORY_TOOLS.map((t) => t.name));
