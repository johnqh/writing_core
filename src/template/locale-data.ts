/**
 * Spec 02 §20.2 / §17, registry R30 (M2 task 11): the injected CLDR port `TokenString`
 * tokens format through. `Intl` is banned throughout `writing_core` (`src/__guards/
 * platform-free.test.ts`) because its data varies by runtime and ICU version — a
 * document paginated on the web must paginate the same on an iPhone (spec 02 §1.1). A
 * host locale would defeat that even where the *output* only affects header/footer
 * text rather than geometry, so this package never reads one: every locale-dependent
 * piece of token text is asked for through `LocaleDataPort`, injected by the app the
 * same way `IdSource`, `FontRegistry` and `Shaper` are.
 *
 * `defaultLocaleData` is this package's own conservative implementation: exact,
 * deterministic English spellout to 9 999 (§17 — "enough for page, panel and scene
 * counts") and a small CLDR-pattern formatter over a bundled English month/weekday
 * table; every other language gets digits and an ISO-8601 date, never a guess at
 * another language's grammar. Apps that want real CLDR data for other languages
 * inject a fuller port built over `Intl` — legal outside this package, per spec 02
 * §17's own description of the boundary.
 */

export interface LocaleDataPort {
  /** Spelled-out cardinal for {n:words|Words|WORDS} (§17). Digits are a legal answer. */
  spellOut(n: number, language: string): string;
  /** CLDR-pattern date for {date:pattern} / {lastRevised:pattern} (§20.2). */
  formatDate(epochMs: number, pattern: string, language: string): string;
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;

/** 0–99, English, hyphenated compound ("twenty-one"). */
function spellBelowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? TENS[tens]! : `${TENS[tens]}-${ONES[ones]}`;
}

/** 0–999, English, American style ("one hundred one", no "and"). */
function spellBelowThousand(n: number): string {
  if (n < 100) return spellBelowHundred(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return rest === 0 ? `${ONES[hundreds]} hundred` : `${ONES[hundreds]} hundred ${spellBelowHundred(rest)}`;
}

/**
 * English cardinal spellout, 0–9 999 (§17's stated range). Out-of-range or non-integer
 * input falls back to digits rather than guessing at a grammar this table doesn't
 * cover — the same "digits for unsupported" fallback §17 specifies for other
 * languages, applied here at the edge of what this table actually knows.
 */
function spellOutEnglish(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n);
  if (n === 0) return 'zero';
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  if (thousands === 0) return spellBelowThousand(rest);
  const thousandsPart = `${ONES[thousands]} thousand`;
  return rest === 0 ? thousandsPart : `${thousandsPart} ${spellBelowThousand(rest)}`;
}

/** True when `language`'s primary BCP 47 subtag is English, case-insensitively (`en`, `en-US`, `en-GB`, …). */
function isEnglish(language: string): boolean {
  return language.toLowerCase().split('-')[0] === 'en';
}

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
const MONTHS_EN_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const WEEKDAYS_EN_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

type PatternToken = { field: string; length: number } | { literal: string };

/**
 * Splits a CLDR date pattern into field runs (`yy`, `M`, `d`, `E`, …) and literal
 * spans, honouring the `'`-quoted literal convention (`''` = a literal quote). Any
 * pattern letter this port doesn't implement round-trips as the run of that letter
 * unchanged, rather than throwing — a header template is authored text, not code.
 */
function tokenizePattern(pattern: string): PatternToken[] {
  const tokens: PatternToken[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "'") {
      if (pattern[i + 1] === "'") {
        tokens.push({ literal: "'" });
        i += 2;
        continue;
      }
      let j = i + 1;
      let lit = '';
      while (j < pattern.length && pattern[j] !== "'") {
        lit += pattern[j];
        j += 1;
      }
      tokens.push({ literal: lit });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < pattern.length && pattern[j] === ch) j += 1;
      tokens.push({ field: ch, length: j - i });
      i = j;
      continue;
    }
    let j = i;
    while (j < pattern.length && !/[A-Za-z']/.test(pattern[j]!)) j += 1;
    tokens.push({ literal: pattern.slice(i, j) });
    i = j;
  }
  return tokens;
}

/** Renders one field run against the UTC calendar fields of `epochMs` (never local time — see module header). */
function renderField(field: string, length: number, year: number, month: number, day: number, weekday: number): string {
  switch (field) {
    case 'y':
      return length === 2 ? String(year % 100).padStart(2, '0') : String(year).padStart(length, '0');
    case 'M':
      if (length === 1) return String(month);
      if (length === 2) return String(month).padStart(2, '0');
      if (length === 3) return MONTHS_EN_ABBR[month - 1]!;
      return MONTHS_EN[month - 1]!;
    case 'd':
      return length === 1 ? String(day) : String(day).padStart(2, '0');
    case 'E':
      return length < 4 ? WEEKDAYS_EN_ABBR[weekday]! : WEEKDAYS_EN[weekday]!;
    default:
      // Unimplemented CLDR field letter: round-trip verbatim rather than guessing or throwing.
      return field.repeat(length);
  }
}

/** English CLDR-pattern formatting over the bundled month/weekday tables, using UTC calendar fields for determinism. */
function formatEnglishPattern(epochMs: number, pattern: string): string {
  const date = new Date(epochMs);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();
  return tokenizePattern(pattern)
    .map((t) => ('literal' in t ? t.literal : renderField(t.field, t.length, year, month, day, weekday)))
    .join('');
}

/** ISO-8601 calendar date (UTC), the fallback for every language this port doesn't have a pattern table for. */
function formatIsoDate(epochMs: number): string {
  const date = new Date(epochMs);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The package's own default. English spellout to 9 999 (enough for page, panel
 * and scene counts) and a literal pattern formatter over a bundled en month/day
 * table; every other language gets digits and an ISO-8601 date. Deterministic on
 * every runtime, identical in Bun, V8, Hermes and JSC — which is the property
 * §1.1 needs and `Intl` cannot give.
 */
export const defaultLocaleData: LocaleDataPort = {
  spellOut(n: number, language: string): string {
    return isEnglish(language) ? spellOutEnglish(n) : String(n);
  },
  formatDate(epochMs: number, pattern: string, language: string): string {
    return isEnglish(language) ? formatEnglishPattern(epochMs, pattern) : formatIsoDate(epochMs);
  },
};
