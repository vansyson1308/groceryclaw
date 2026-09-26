// Rewrites display text into text a TTS voice reads fluently. Subtitles keep
// the original; only the synthesized audio uses this. Offline voices (Piper,
// espeak) stumble on brand names, acronyms, money and codes: "$210" came out
// as "dollar two hove and ten", "ShopVoice" as "Shop... Voice".

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Cardinal number in words, American style ("one hundred twenty"). */
export function numberToWords(n) {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `minus ${numberToWords(-n)}`;
  n = Math.round(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberToWords(n % 100)}` : ''}`;
  for (const [size, word] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= size) {
      const rest = n % size;
      return `${numberToWords(Math.floor(n / size))} ${word}${rest ? ` ${numberToWords(rest)}` : ''}`;
    }
  }
  return String(n);
}

function digits(s) {
  return s.split('').map((d) => (d === '0' ? 'oh' : ONES[Number(d)])).join(' ');
}

// Whole words or tokens -> how to say them. Order matters: longer first.
const LEXICON = [
  [/\bShopVoice\b/g, 'Shop Voice'],
  [/\bKiotViet\b/g, 'Key-ott Vee-et'], // close to the Vietnamese "Ki-ốt Việt"
  [/\bAlexa\+/g, 'Alexa Plus'],
  [/\bPostgres(QL)?\b/g, 'Post-gress'],
  [/\bMCP\b/g, 'M C P'],
  [/\bCDK\b/g, 'C D K'],
  [/\bAWS\b/g, 'A W S'],
  [/\bHTTP\b/g, 'H T T P'],
  [/\bMIT\b/g, 'M I T'],
  [/\bRLS\b/g, 'R L S'],
  [/\bLLM\b/g, 'L L M'],
  [/\bAPI\b/g, 'A P I'],
  // Offline voices blur "Want a reorder" into "want to order".
  [/\bWant a\b/g, 'Want uh'],
  [/\b([Rr])eorder/g, '$1e-order']
];

export function speakable(text) {
  let s = String(text);
  for (const [re, say] of LEXICON) s = s.replace(re, say);
  // Codes like SRB-10442: letters spelled, digits read one by one.
  // The trailing comma adds a beat so the last digit doesn't run into the next word
  // ("...four two arrived" was heard as "...four to arrive").
  s = s.replace(/\b([A-Z]{2,5})-(\d{3,})\b(,?)/g, (_, letters, num) => `${letters.split('').join(' ')} ${digits(num)},`);
  // Money: "$1,234.50" -> "one thousand two hundred thirty-four dollars fifty".
  s = s.replace(/\$(\d[\d,]*)(?:\.(\d{2}))?/g, (_, whole, cents) => {
    const d = Number(whole.replace(/,/g, ''));
    const c = cents ? Number(cents) : 0;
    return `${numberToWords(d)} dollar${d === 1 ? '' : 's'}${c ? ` ${numberToWords(c)}` : ''}`;
  });
  s = s.replace(/(\d+(?:\.\d+)?)\s?%/g, (_, p) => `${p} percent`);
  // Units glued to numbers: "1L" -> "1 liter", "10-pack" -> "10 pack".
  s = s.replace(/\b(\d+)\s?L\b/g, (_, n) => `${n} liter${n === '1' ? '' : 's'}`);
  s = s.replace(/\b(\d+)-(pack|kg|g|ml)\b/gi, (_, n, u) => `${n} ${u.toLowerCase() === 'ml' ? 'milliliter' : u.toLowerCase() === 'kg' ? 'kilo' : u.toLowerCase() === 'g' ? 'gram' : u}`);
  // Remaining plain numbers (with thousands separators) -> words.
  s = s.replace(/\b\d{1,3}(?:,\d{3})+\b|\b\d+\b/g, (m) => numberToWords(Number(m.replace(/,/g, ''))));
  // Symbols voices read literally or skip awkwardly.
  s = s.replace(/&/g, 'and').replace(/\s*[—–]\s*/g, ', ').replace(/\s{2,}/g, ' ').trim();
  return s;
}
