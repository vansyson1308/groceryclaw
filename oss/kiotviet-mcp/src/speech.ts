// Voice-first formatting: short (<= 35 words), rounded, always with units,
// never more than 3 list items read aloud.
export const MAX_SPOKEN_WORDS = 35;

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function fitSpeech(candidates: readonly string[], maxWords = MAX_SPOKEN_WORDS): string {
  for (const c of candidates) if (countWords(c) <= maxWords) return c.trim();
  const words = (candidates[candidates.length - 1] ?? '').trim().split(/\s+/).slice(0, maxWords);
  return `${words.join(' ').replace(/[,;:]+$/, '')}.`;
}

const IRREGULAR: Record<string, string> = { loaf: 'loaves', box: 'boxes', bunch: 'bunches' };

export function formatQty(qty: number, unit: string): string {
  const n = Math.round(qty);
  const u = unit || 'unit';
  const plural = n === 1 ? u : IRREGULAR[u] ?? (/(s|x|z|ch|sh)$/.test(u) ? `${u}es` : `${u}s`);
  return `${n.toLocaleString('en-US')} ${plural}`;
}

export function formatMoney(amount: number, currency: string): string {
  if (currency === 'VND') {
    const abs = Math.abs(amount);
    if (abs >= 1_000_000) return `${(Math.round(amount / 100_000) / 10).toString()} million dong`;
    if (abs >= 1_000) return `${Math.round(amount / 1_000)} thousand dong`;
    return `${Math.round(amount)} dong`;
  }
  const symbol = currency === 'USD' ? '$' : '';
  return `${symbol}${Math.round(amount).toLocaleString('en-US')}${symbol ? '' : ` ${currency}`}`;
}

export function speakList(items: readonly string[], max = 3): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join('; ')}; and ${rest} more` : `${shown.slice(0, -1).join('; ')}; and ${shown[shown.length - 1]}`;
}

export function daysLeft(days: number | null): string {
  if (days === null) return 'no recent sales';
  if (days < 1) return 'under a day left';
  const d = Math.floor(days);
  return `${d} ${d === 1 ? 'day' : 'days'} left`;
}
