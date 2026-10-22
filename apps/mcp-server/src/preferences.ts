// Shop memory: rules the owner stated explicitly, applied to reorder
// suggestions and drafts. A rule names products by plain words ("milk"); it
// applies to every product whose name contains all of them. Rules never change
// what the owner asked for in the same breath: an explicit quantity wins over a
// cap, and naming a skipped item orders it anyway.
import type { ShopPreference, StockRow, Supplier } from './store.js';
import { formatNumber, joinList } from './speech.js';

export const DEFAULT_VOICE_PROFILE = 'owner';
export const MAX_RULES_PER_PROFILE = 20;

const PROFILE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function normalizeVoiceProfile(value: string | undefined): string {
  return value && PROFILE_PATTERN.test(value) ? value : DEFAULT_VOICE_PROFILE;
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('es') && !word.endsWith('ses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2).map(stem);
}

const STOP_WORDS = new Set(['the', 'my', 'all', 'any', 'of', 'and', 'our']);

/** Product words of a rule, lower-cased and singular ("Eggs" -> "egg"). */
export function subjectWords(subject: string): string[] {
  return [...new Set(words(subject).filter((w) => !STOP_WORDS.has(w)))];
}

/** Stored subject: the owner's words, lower-cased, so "Eggs" and "eggs" are one rule (matching also ignores plurals). */
export function canonicalSubject(subject: string): string {
  return subject.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w)).join(' ').slice(0, 80);
}

export function ruleMatchesProduct(subject: string, productName: string): boolean {
  const want = subjectWords(subject);
  if (want.length === 0) return false;
  const have = new Set(words(productName));
  return want.every((w) => have.has(w));
}

export function supplierName(code: string | null, suppliers: readonly Supplier[]): string {
  return suppliers.find((s) => s.code === code)?.name ?? code ?? 'an unknown supplier';
}

/** How the rule is said back to the owner ("order milk from Green Valley Dairy & Eggs"). */
export function describeRule(pref: ShopPreference, suppliers: readonly Supplier[]): string {
  switch (pref.kind) {
    case 'preferred_supplier':
      return `order ${pref.subject} from ${supplierName(pref.supplierCode, suppliers)}`;
    case 'max_order_qty':
      return `never order more than ${formatNumber(pref.maxQty ?? 0)} ${pref.subject}`;
    case 'skip_item':
      return `skip ${pref.subject} in reorders`;
    case 'order_day':
      return `you usually order on ${pref.weekday ? `${pref.weekday[0]?.toUpperCase()}${pref.weekday.slice(1)}s` : 'a set day'}`;
  }
}

export interface ReorderLine {
  readonly row: StockRow;
  readonly qty: number;
  /** The owner named this quantity in the request. */
  readonly explicitQty?: boolean;
}

export interface AppliedRule {
  readonly id: string;
  readonly kind: ShopPreference['kind'];
  readonly rule: string;
  /** Short spoken phrase ("milk from Metro Wholesale"). */
  readonly phrase: string;
  readonly skus: string[];
}

/**
 * Applies skip, cap and preferred-supplier rules. `explicitItems` is true when
 * the owner named the products ("reorder milk"): skip rules then do not apply.
 */
export function applyPreferences(
  lines: readonly ReorderLine[],
  prefs: readonly ShopPreference[],
  suppliers: readonly Supplier[],
  opts: { explicitItems: boolean }
): { lines: ReorderLine[]; applied: AppliedRule[] } {
  const applied = new Map<string, AppliedRule>();
  const touch = (pref: ShopPreference, phrase: string, sku: string) => {
    const prev = applied.get(pref.id);
    applied.set(pref.id, prev
      ? { ...prev, skus: [...prev.skus, sku] }
      : { id: pref.id, kind: pref.kind, rule: describeRule(pref, suppliers), phrase, skus: [sku] });
  };
  const out: ReorderLine[] = [];
  for (const line of lines) {
    const matching = prefs.filter((p) => p.kind !== 'order_day' && ruleMatchesProduct(p.subject, line.row.name));
    const skip = matching.find((p) => p.kind === 'skip_item');
    if (skip && !opts.explicitItems) {
      touch(skip, `${skip.subject} skipped`, line.row.sku);
      continue;
    }
    let { row, qty } = line;
    const preferred = matching.find((p) => p.kind === 'preferred_supplier' && p.supplierCode);
    const supplier = preferred ? suppliers.find((s) => s.code === preferred.supplierCode) : undefined;
    if (preferred && supplier && supplier.code !== row.supplierCode) {
      row = { ...row, supplierCode: supplier.code, leadTimeDays: supplier.leadTimeDays };
      touch(preferred, `${preferred.subject} from ${supplier.name}`, row.sku);
    }
    const cap = matching
      .filter((p) => p.kind === 'max_order_qty' && p.maxQty !== null)
      .sort((a, b) => (a.maxQty ?? 0) - (b.maxQty ?? 0))[0];
    if (cap && cap.maxQty !== null && !line.explicitQty && qty > cap.maxQty) {
      qty = Math.floor(cap.maxQty);
      touch(cap, `${cap.subject} capped at ${formatNumber(cap.maxQty)}`, row.sku);
    }
    out.push({ row, qty, ...(line.explicitQty ? { explicitQty: true } : {}) });
  }
  return { lines: out, applied: [...applied.values()] };
}

/** "As you asked: milk from Metro Wholesale and cola skipped." ('' when no rule applied). */
export function asYouAsked(applied: readonly AppliedRule[]): string {
  return applied.length === 0 ? '' : `As you asked: ${joinList(applied.map((a) => a.phrase))}.`;
}
