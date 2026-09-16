/**
 * Two independent test surfaces (see sentences.ts's header comment for why they're separate):
 *  1. `sentenceBoundaries` against the official `SentenceBreakTest.txt` — every case, zero
 *     exclusions (context item 2's bar).
 *  2. `sentenceEnds` against spec 02 §6.5's own screenplay rule, with dedicated tests for
 *     the abbreviation-list and single-uppercase-initial exceptions — deliberately, because
 *     (context item 3) no official conformance case will ever exercise them. Both the
 *     abbreviation-list regression and the Thai-dictionary regression (dict.test.ts) are
 *     proven live: the mechanism is disabled, the case is shown to fail, then restored.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ABBREVIATIONS, MAY_END_ABBREVIATIONS, sentenceBoundaries, sentenceEnds } from './sentences.js';

const TEST_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../test/ucd/SentenceBreakTest.txt');

interface ConformanceCase {
  line: number;
  text: string;
  offsets: number[];
  expectedBreak: boolean[];
  comment: string;
}

function parseConformanceLine(raw: string, lineNo: number): ConformanceCase | null {
  const hashIndex = raw.indexOf('#');
  const data = (hashIndex >= 0 ? raw.slice(0, hashIndex) : raw).trim();
  const comment = hashIndex >= 0 ? raw.slice(hashIndex + 1).trim() : '';
  if (!data) return null;
  const tokens = data.split(/\s+/);
  const codePoints: number[] = [];
  const breakBeforeAt: boolean[] = [];
  for (const tok of tokens) {
    if (tok === '÷' || tok === '×') breakBeforeAt.push(tok === '÷');
    else codePoints.push(parseInt(tok, 16));
  }
  let text = '';
  const offsets: number[] = [];
  for (const cp of codePoints) {
    offsets.push(text.length);
    text += String.fromCodePoint(cp);
  }
  const expectedBreak = offsets.map((_, k) => breakBeforeAt[k] ?? false);
  return { line: lineNo, text, offsets, expectedBreak, comment };
}

function loadConformanceCases(): ConformanceCase[] {
  const raw = readFileSync(TEST_FILE, 'utf8');
  const cases: ConformanceCase[] = [];
  raw.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const c = parseConformanceLine(line, i + 1);
    if (c && c.text.length > 0) cases.push(c);
  });
  return cases;
}

describe('sentenceBoundaries — UAX #29 official conformance (SentenceBreakTest.txt, all cases)', () => {
  const cases = loadConformanceCases();

  it('loads the conformance file (sanity: about 400+ cases)', () => {
    expect(cases.length).toBeGreaterThan(400);
  });

  for (const c of cases) {
    it(`line ${c.line}: ${JSON.stringify(c.text)} — ${c.comment}`, () => {
      const boundaries = new Set(sentenceBoundaries(c.text));
      const actualBreak = c.offsets.map((offset) => boundaries.has(offset));
      expect(actualBreak).toEqual(c.expectedBreak);
    });
  }
});

describe('sentenceEnds — spec 02 §6.5 explicit cases', () => {
  it('"INT." does not end a sentence (abbreviation list)', () => {
    const text = 'INT. SFPD BRIEFING ROOM - DAY';
    expect(sentenceEnds(text, 'en')).toEqual([]);
  });

  it('"Mr." does not end a sentence (abbreviation list)', () => {
    const text = 'Mr. Smith arrived.';
    const ends = sentenceEnds(text, 'en');
    expect(ends).toEqual([text.length]); // only the final period ends a sentence
  });

  it('"J. Smith" does not end a sentence after "J." (single uppercase initial)', () => {
    const text = 'J. Smith walked in.';
    const ends = sentenceEnds(text, 'en');
    expect(ends).toEqual([text.length]); // not after "J."
  });

  it('CJK full stop "。" ends a sentence with no whitespace required', () => {
    const text = '今日は。明日は。'; // "today is. tomorrow is." with 。, no spaces
    const ends = sentenceEnds(text, 'ja');
    // one boundary right after each 。, with no trailing whitespace involved
    const firstStop = text.indexOf('。') + 1;
    const secondStop = text.lastIndexOf('。') + 1;
    expect(ends).toEqual([firstStop, secondStop]);
  });

  it('`?"` followed by a space ends a sentence (STerm + closing quote + whitespace)', () => {
    const text = 'She asked, "Really?" He nodded.';
    expect(sentenceEnds(text, 'en')).toEqual([20, 31]); // right after the closing quote, and at text end
  });

  it('a plain "." followed by whitespace ends an ordinary sentence', () => {
    const text = 'She left. He stayed.';
    expect(sentenceEnds(text, 'en')).toEqual([9, text.length]);
  });

  it('an abbreviation NOT in the list (e.g. a made-up "Xk.") still ends the sentence normally', () => {
    const text = 'Xk. Fine.';
    expect(sentenceEnds(text, 'en')).toEqual([3, text.length]);
  });

  it('an unlisted language (no abbreviation list) applies the rule with no exceptions', () => {
    // Japanese has no curated abbreviation list (spec 02 §6.5: "others use the rule without
    // exceptions"), so a Latin "Mr." run in Japanese-tagged text still ends a sentence.
    const text = 'Mr. Tanaka desu.';
    expect(sentenceEnds(text, 'ja')).toEqual([3, text.length]);
  });
});

describe('sentenceEnds — two abbreviation classes (spec 02 §6.5, fix round 1)', () => {
  it('FIX: "etc." at a genuine sentence end is now honoured (the reported defect)', () => {
    // Before fix round 1 this returned only [34] — the boundary after "etc." never
    // registered because the exception was unconditional. §6.5 was amended precisely
    // because a suppression-only rule silently merges sentences that should split.
    const text = 'Buy milk, eggs, etc. Then go home.';
    const afterEtc = text.indexOf('etc.') + 'etc.'.length;
    expect(sentenceEnds(text, 'en')).toEqual([afterEtc, text.length]);
  });

  it('may-end "etc." is suppressed mid-sentence (followed by lowercase, not honoured)', () => {
    const text = 'Buy eggs, etc. and then go.';
    expect(sentenceEnds(text, 'en')).toEqual([text.length]); // one sentence, not split after "etc."
  });

  it('may-end "etc." is honoured when followed by whitespace then an opening quote', () => {
    const text = 'We packed food, tools, etc. "Are we ready?" she asked.';
    // [after "etc.", after the closing quote following "?", after the final period]
    expect(sentenceEnds(text, 'en')).toEqual([27, 43, 54]);
  });

  it('may-end "etc." at true end of paragraph is honoured (nothing follows to disambiguate)', () => {
    const text = 'We packed food, tools, etc.';
    expect(sentenceEnds(text, 'en')).toEqual([text.length]);
  });

  it('may-end "Jr." is honoured at a real boundary (followed by whitespace + uppercase)', () => {
    const text = 'That was John Smith Jr. He left early.';
    const afterJr = text.indexOf('Jr.') + 'Jr.'.length;
    expect(sentenceEnds(text, 'en')).toEqual([afterJr, text.length]);
  });

  it('may-end "Jr." is suppressed mid-name (followed by whitespace + lowercase)', () => {
    const text = 'John Smith Jr. arrived late.';
    expect(sentenceEnds(text, 'en')).toEqual([text.length]); // one sentence, not split after "Jr."
  });

  it('may-end "Sr." is honoured at a real boundary, suppressed mid-sentence', () => {
    const honoured = 'This is Alan Sr. He built the house.';
    const afterSr = honoured.indexOf('Sr.') + 'Sr.'.length;
    expect(sentenceEnds(honoured, 'en')).toEqual([afterSr, honoured.length]);

    const suppressed = 'This is Alan Sr. speaking now.';
    expect(sentenceEnds(suppressed, 'en')).toEqual([suppressed.length]);
  });

  it('never-end "Dr." is suppressed even when followed by whitespace + an uppercase letter', () => {
    // The never class must not consult the uppercase signal at all — unlike "etc."/"Jr."/"Sr.",
    // "Dr." never ends a sentence regardless of what capital letter follows.
    const text = 'Dr. Who is here.';
    expect(sentenceEnds(text, 'en')).toEqual([text.length]);
  });

  it('never-end "Mr." is suppressed even when followed by whitespace + an opening quote', () => {
    const text = 'Mr. "Big Deal" Smith arrived.';
    expect(sentenceEnds(text, 'en')).toEqual([text.length]);
  });

  it('REGRESSION GUARD: "INT. SFPD BRIEFING ROOM - DAY" is still one sentence — the all-caps slug line never consults the uppercase signal', () => {
    // INT./EXT./I/E. are deliberately in the never class: every letter in a slug line is
    // uppercase, so the may-end class's "followed by an uppercase letter" test would be
    // worthless there — it would honour (wrongly split) every scene heading.
    const text = 'INT. SFPD BRIEFING ROOM - DAY';
    expect(sentenceEnds(text, 'en')).toEqual([]);
  });

  it('es: may-end "etc." honoured at a real boundary, suppressed mid-sentence', () => {
    const honoured = 'Compramos comida, herramientas, etc. Estamos listos.';
    const afterEtc = honoured.indexOf('etc.') + 'etc.'.length;
    expect(sentenceEnds(honoured, 'es')).toEqual([afterEtc, honoured.length]);

    const suppressed = 'Compramos comida, etc. y nos fuimos.';
    expect(sentenceEnds(suppressed, 'es')).toEqual([suppressed.length]);
  });

  it('de: may-end "usw." honoured at a real boundary, suppressed mid-sentence', () => {
    const honoured = 'Wir kauften Essen, Werkzeug, usw. Wir waren bereit.';
    const afterUsw = honoured.indexOf('usw.') + 'usw.'.length;
    expect(sentenceEnds(honoured, 'de')).toEqual([afterUsw, honoured.length]);

    const suppressed = 'Wir kauften Essen, usw. und gingen.';
    expect(sentenceEnds(suppressed, 'de')).toEqual([suppressed.length]);
  });

  it('ships a may-end list for en, es, fr, de, disjoint from the never-end list per language (spec 02 §6.5)', () => {
    for (const lang of ['en', 'es', 'fr', 'de']) {
      const mayList = MAY_END_ABBREVIATIONS[lang] ?? [];
      expect(mayList.length).toBeGreaterThan(0);
      const neverList = ABBREVIATIONS[lang] ?? [];
      for (const abbrev of mayList) expect(neverList).not.toContain(abbrev);
    }
  });
});

describe('sentenceEnds — may-end trigger set, exactly (spec 02 §6.5, fix round 2)', () => {
  it('REGRESSION: a straight apostrophe contraction ("\'tis") after a may-end abbreviation stays one sentence', () => {
    // Before fix round 2, U+0027 was (wrongly) in the trigger set, so this split at 14.
    const text = "We packed etc. 'tis done.";
    expect(sentenceEnds(text, 'en')).toEqual([text.length]);
  });

  it('a genuine straight double-quote opening quote after a may-end abbreviation still splits', () => {
    const text = 'We packed etc. "Tis done," she said.';
    expect(sentenceEnds(text, 'en')).toEqual([14, text.length]);
  });

  it('the curly closing/contraction apostrophe (’, U+2019) is not a trigger — stays one sentence', () => {
    const text = 'We packed etc. ’tis done.';
    expect(sentenceEnds(text, 'en')).toEqual([text.length]);
  });

  it('the curly opening single quote (‘, U+2018) IS a trigger (it is not the contraction form) — splits', () => {
    const text = 'We packed etc. ‘tis done.';
    expect(sentenceEnds(text, 'en')).toEqual([14, text.length]);
  });

  it('the curly opening double quote (“, U+201C) is a trigger — splits', () => {
    const text = 'We packed etc. “Tis done,” she said.';
    expect(sentenceEnds(text, 'en')).toEqual([14, text.length]);
  });

  it('opening brackets `(`, `[`, `{` are triggers', () => {
    expect(sentenceEnds('We packed etc. (really).', 'en')).toEqual([14, 24]);
    expect(sentenceEnds('We packed etc. [note].', 'en')).toEqual([14, 22]);
    expect(sentenceEnds('We packed etc. {note}.', 'en')).toEqual([14, 22]);
  });

  it('a digit following the whitespace is deliberately not a trigger (spec 02 §6.5, accepted imprecision)', () => {
    const text = 'We packed etc. 42 items remained.';
    expect(sentenceEnds(text, 'en')).toEqual([33]);
  });

  it('a capitalized common noun deliberately misfires as a trigger too (spec 02 §6.5, accepted imprecision)', () => {
    // The heuristic checks General_Category Lu alone, with no semantic distinction between a
    // new sentence and a capitalized proper/common noun continuing the same sentence.
    const text = 'We packed etc. Kraft brand.';
    expect(sentenceEnds(text, 'en')).toEqual([14, 27]);
  });
});

describe('sentenceEnds — abbreviation-list regression proof (spec 02 §6.5, context item 3)', () => {
  it('with the abbreviation list intact, "INT. SFPD BRIEFING ROOM - DAY" is one sentence (no end inside)', () => {
    expect(sentenceEnds('INT. SFPD BRIEFING ROOM - DAY', 'en')).toEqual([]);
  });

  it('REGRESSION: emptying ABBREVIATIONS.en makes "INT." end a sentence, splitting the heading in two', () => {
    // Live proof that the abbreviation list, not luck, is what keeps "INT." from ending a
    // sentence — mutate the actual exported list, show the case goes RED, then restore it
    // and show it goes GREEN again (context item 3: disable the mechanism, watch it fail).
    const text = 'INT. SFPD BRIEFING ROOM - DAY';
    expect(sentenceEnds(text, 'en')).toEqual([]); // GREEN before touching anything

    const mutable = ABBREVIATIONS as Record<string, readonly string[]>;
    const original = mutable.en as readonly string[];
    mutable.en = [];
    try {
      expect(sentenceEnds(text, 'en')).toEqual([4]); // RED: splits right after "INT." with no list
    } finally {
      mutable.en = original;
    }
    expect(sentenceEnds(text, 'en')).toEqual([]); // GREEN again, restored
  });

  it('ships abbreviation lists for en, es, fr, de (spec 02 §6.5)', () => {
    for (const lang of ['en', 'es', 'fr', 'de']) {
      expect(ABBREVIATIONS[lang]?.length).toBeGreaterThan(0);
    }
  });
});
