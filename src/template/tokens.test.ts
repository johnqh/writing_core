import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StyleId } from '../ids/ids.js';
import type { NumberLabel } from '../schema/template.js';
import { defaultLocaleData, type LocaleDataPort } from './locale-data.js';
import { parseTokenString, renderTokenString, type TokenContext } from './tokens.js';

const S = (s: string): StyleId => s as StyleId;

function label(base: number, opts: Partial<NumberLabel> = {}): NumberLabel {
  return { base, prefix: [], suffix: [], ...opts };
}

function ctx(overrides: Partial<TokenContext> = {}): TokenContext {
  return { locale: defaultLocaleData, language: 'en', ...overrides };
}

const render = (s: string, c: TokenContext) => renderTokenString(s, c);

describe('platform-free: no Intl usage in the two files this task adds', () => {
  // Mirrors src/__guards/platform-free.test.ts's actual forbidden pattern for `Intl`
  // (`new Intl.`) rather than banning the bare word — both files' doc comments
  // legitimately *talk about* the ban (that's the whole reason LocaleDataPort
  // exists), and the general repo-wide guard already walks these two files too.
  it('locale-data.ts and tokens.ts never construct an Intl.* object', () => {
    const dir = import.meta.dirname;
    for (const file of ['locale-data.ts', 'tokens.ts']) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text).not.toMatch(/\bnew Intl\./);
    }
  });
});

describe('§20.2 token table — every row renders', () => {
  it('{page} is the pre-formatted page label', () => {
    const c = ctx({ page: { label: '12A.', count: 90, revisionName: null } });
    expect(render('{page}', c).text).toBe('12A.');
  });

  it('{pages} is the body page count', () => {
    const c = ctx({ page: { label: '1', count: 90, revisionName: null } });
    expect(render('{pages}', c).text).toBe('90');
  });

  it('{date} and {date:pattern} route through ctx.locale, never a global', () => {
    const fakeLocale: LocaleDataPort = {
      spellOut: () => 'STUB-WORDS',
      formatDate: (epochMs, pattern, language) => `STUB(${epochMs >= 0},${pattern},${language})`,
    };
    const c = ctx({ locale: fakeLocale });
    expect(render('{date}', c).text).toBe('STUB(true,M/d/yy,en)');
    expect(render('{date:yyyy}', c).text).toBe('STUB(true,yyyy,en)');
  });

  it('{lastRevised} and {lastRevised:pattern} format ctx.document.lastRevised', () => {
    const c = ctx({ document: { filename: 'f', project: null, snapshot: null, label: null, lastRevised: 0 } });
    expect(render('{lastRevised}', c).text).toBe('1/1/70');
    expect(render('{lastRevised:yyyy-MM-dd}', c).text).toBe('1970-01-01');
  });

  it('{lastRevised} is empty when there is no revision yet', () => {
    const c = ctx({ document: { filename: 'f', project: null, snapshot: null, label: null, lastRevised: null } });
    expect(render('{lastRevised}', c).text).toBe('');
  });

  it('{title} renders the title field\'s first line', () => {
    const c = ctx({ title: { title: 'MIDNIGHT\nRUN' } });
    expect(render('{title}', c).text).toBe('MIDNIGHT');
  });

  it('{field:<key>} renders any TITLE_FIELDS key\'s first line', () => {
    const c = ctx({ title: { author: 'Jane Doe' } });
    expect(render('{field:author}', c).text).toBe('Jane Doe');
  });

  it('{draft} is an alias of {field:draftDate}', () => {
    const c = ctx({ title: { draftDate: 'Third Draft' } });
    expect(render('{draft}', c).text).toBe(render('{field:draftDate}', c).text);
    expect(render('{draft}', c).text).toBe('Third Draft');
  });

  it('{filename}, {project}, {snapshot} come from ctx.document', () => {
    const c = ctx({ document: { filename: 'Heist.fwm', project: 'Heist', snapshot: 'v3', label: null, lastRevised: null } });
    expect(render('{filename}', c).text).toBe('Heist.fwm');
    expect(render('{project}', c).text).toBe('Heist');
    expect(render('{snapshot}', c).text).toBe('v3');
  });

  it('{scene.heading} and {scene.number} come from ctx.scene', () => {
    const c = ctx({ scene: { heading: 'INT. HOUSE - DAY', number: '12' } });
    expect(render('{scene.heading}', c).text).toBe('INT. HOUSE - DAY');
    expect(render('{scene.number}', c).text).toBe('12');
  });

  it('{style:<StyleId>} calls ctx.styleText, with |trunc:N usable after it', () => {
    const c = ctx({ styleText: (id) => (id === S('st_action') ? 'A very long action line' : null) });
    expect(render('{style:st_action}', c).text).toBe('A very long action line');
    expect(render('{style:st_action|trunc:7}', c).text).toBe('A very ');
    expect(render('{style:st_missing}', c).text).toBe('');
  });

  it('{label} is the document\'s most-recent Final Draft label', () => {
    const c = ctx({ document: { filename: 'f', project: null, snapshot: null, label: 'C-14', lastRevised: null } });
    expect(render('{label}', c).text).toBe('C-14');
  });

  it('{revision.name} / .color / .date / .mark come from ctx.revision', () => {
    const c = ctx({ revision: { name: 'Blue Revision', color: '#0000FF', date: 0, mark: '*', active: null, collated: [] } });
    expect(render('{revision.name}', c).text).toBe('Blue Revision');
    expect(render('{revision.color}', c).text).toBe('#0000FF');
    expect(render('{revision.date}', c).text).toBe('1/1/70');
    expect(render('{revision.mark}', c).text).toBe('*');
  });

  it('{page.revision} is the page\'s own revision set name', () => {
    const c = ctx({ page: { label: '1', count: 1, revisionName: 'Pink Revision' } });
    expect(render('{page.revision}', c).text).toBe('Pink Revision');
  });

  it('{revision.active} and {revision.collated} come from ctx.revision', () => {
    const c = ctx({ revision: { name: null, color: null, date: null, mark: null, active: 'Blue', collated: ['Pink', 'Blue'] } });
    expect(render('{revision.active}', c).text).toBe('Blue');
    expect(render('{revision.collated}', c).text).toBe('Pink, Blue');
  });

  it('{watermark.recipient} is a known name that always renders empty (not modeled by TokenContext yet)', () => {
    const c = ctx();
    const result = render('{watermark.recipient}', c);
    expect(result.text).toBe('');
    expect(result.unknown).toEqual([]);
  });

  it('{n} is the number label, base formatted plainly, full label combined normally', () => {
    const c = ctx({ number: { label: label(5), counts: new Map() } });
    expect(render('{n}', c).text).toBe('5');
  });

  it('{count:<StyleId>} and {count:<StyleId>:words|Words|WORDS} count elements', () => {
    const c = ctx({ number: { label: label(1), counts: new Map([[S('st_panel'), 3]]) } });
    expect(render('{count:st_panel}', c).text).toBe('3');
    expect(render('{count:st_panel:words}', c).text).toBe('three');
    expect(render('{count:st_panel:Words}', c).text).toBe('Three');
    expect(render('{count:st_panel:WORDS}', c).text).toBe('THREE');
  });

  it('the graphic-novel page heading example from §17 renders exactly', () => {
    const c = ctx({ number: { label: label(1), counts: new Map([[S('st_panel'), 2]]) } });
    const template = 'PAGE {n:WORDS} ({count:st_panel:WORDS} PANEL{count:st_panel|plural:S})';
    expect(render(template, c).text).toBe('PAGE ONE (TWO PANELS)');
  });
});

describe('{n:…} number formats', () => {
  it('{n:padK} zero-pads the base only — prefix/suffix attach to the formatted base (§20.2 example, verbatim)', () => {
    const A12B = label(12, { prefix: [{ kind: 'letters', value: [1] }], suffix: [{ kind: 'letters', value: [2] }] });
    const c = ctx({ number: { label: A12B, counts: new Map() } });
    expect(render('{n:pad3}', c).text).toBe('A012B');
  });

  it('{n:padK} on a single-digit base with prefix/suffix, contrasting with padding the whole label', () => {
    // If padding were applied to the *whole* formatted label ("A2B", already 3 chars)
    // instead of the base, this would wrongly stay "A2B". Padding just the base gives "A002B".
    const A2B = label(2, { prefix: [{ kind: 'letters', value: [1] }], suffix: [{ kind: 'letters', value: [2] }] });
    const c = ctx({ number: { label: A2B, counts: new Map() } });
    expect(render('{n:pad3}', c).text).toBe('A002B');
  });

  it('{n:words} routes through ctx.locale.spellOut, never a global', () => {
    const fakeLocale: LocaleDataPort = { spellOut: () => 'STUB', formatDate: () => '' };
    const c = ctx({ locale: fakeLocale, number: { label: label(2), counts: new Map() } });
    expect(render('{n:words}', c).text).toBe('STUB');
  });

  it('{n:words} / {n:Words} / {n:WORDS} case variants', () => {
    const c = ctx({ number: { label: label(2), counts: new Map() } });
    expect(render('{n:words}', c).text).toBe('two');
    expect(render('{n:Words}', c).text).toBe('Two');
    expect(render('{n:WORDS}', c).text).toBe('TWO');
  });

  it('{n:roman} / {n:ROMAN}', () => {
    const c = ctx({ number: { label: label(1994), counts: new Map() } });
    expect(render('{n:roman}', c).text).toBe('mcmxciv');
    expect(render('{n:ROMAN}', c).text).toBe('MCMXCIV');
  });

  it('{n:alpha} / {n:ALPHA} bijective base-26', () => {
    for (const [base, expected] of [[1, 'a'], [26, 'z'], [27, 'aa'], [28, 'ab'], [52, 'az'], [53, 'ba']] as const) {
      const c = ctx({ number: { label: label(base), counts: new Map() } });
      expect(render('{n:alpha}', c).text).toBe(expected);
      expect(render('{n:ALPHA}', c).text).toBe(expected.toUpperCase());
    }
  });

  it('a custom label overrides format args entirely, like plain {n}', () => {
    const c = ctx({ number: { label: label(5, { custom: 'TWO-A' }), counts: new Map() } });
    expect(render('{n:pad3}', c).text).toBe('TWO-A');
  });

  it('{n} is empty when there is no number in context', () => {
    expect(render('{n}', ctx()).text).toBe('');
  });
});

describe('plural filter (used after count; boundary tested both directions)', () => {
  it('renders X when the count is 2 (≠ 1) — the exact §20.2 example', () => {
    const c = ctx({ number: { label: label(1), counts: new Map([[S('st_panel'), 2]]) } });
    const result = render('{count:st_panel|plural:S}', c);
    expect(result.text).toBe('S');
  });

  it('renders empty when the count is exactly 1', () => {
    const c = ctx({ number: { label: label(1), counts: new Map([[S('st_panel'), 1]]) } });
    const result = render('{count:st_panel|plural:S}', c);
    expect(result.text).toBe('');
  });

  it('renders X again at 0 and at large counts (both sides of the ≠1 boundary)', () => {
    for (const n of [0, 3, 100]) {
      const c = ctx({ number: { label: label(1), counts: new Map([[S('st_panel'), n]]) } });
      expect(render('{count:st_panel|plural:S}', c).text).toBe('S');
    }
  });
});

describe('upper / lower / trunc filters', () => {
  it('upper and lower transform the rendered text', () => {
    const c = ctx({ title: { title: 'Midnight Run' } });
    expect(render('{title|upper}', c).text).toBe('MIDNIGHT RUN');
    expect(render('{title|lower}', c).text).toBe('midnight run');
  });

  it('trunc:N truncates to N ASCII characters with no ellipsis', () => {
    const c = ctx({ title: { title: 'Midnight Run' } });
    expect(render('{title|trunc:9}', c).text).toBe('Midnight ');
  });

  it('trunc:N truncates by grapheme cluster, never splitting a multi-code-unit cluster', () => {
    // U+1F44D U+1F3FD (thumbs up + medium skin tone) is one extended grapheme cluster
    // spanning two surrogate pairs (4 UTF-16 code units). A naive `text.slice(0, 1)`
    // would cut it in half and produce an unpaired surrogate; grapheme-aware trunc:1
    // must keep the whole cluster.
    const thumbsUp = '\u{1F44D}\u{1F3FD}';
    const c = ctx({ styleText: () => `${thumbsUp}rest` });
    expect(render('{style:st_x|trunc:1}', c).text).toBe(thumbsUp);
  });

  it('trunc:N beyond the string length leaves it unchanged', () => {
    const c = ctx({ title: { title: 'Hi' } });
    expect(render('{title|trunc:50}', c).text).toBe('Hi');
  });

  it('filters chain left to right', () => {
    const c = ctx({ title: { title: 'Midnight Run' } });
    expect(render('{title|upper|trunc:4}', c).text).toBe('MIDN');
  });
});

describe('literal braces and case-insensitive names', () => {
  it('{{ and }} are literal braces', () => {
    expect(render('{{hi}} and {{bye}}', ctx()).text).toBe('{hi} and {bye}');
  });

  it('names are case-insensitive', () => {
    const c = ctx({ title: { title: 'Case Test' } });
    expect(render('{Title}', c).text).toBe(render('{title}', c).text);
    expect(render('{TITLE}', c).text).toBe('Case Test');
  });
});

describe('unknown token names', () => {
  it('an unknown name renders empty and is reported in unknown', () => {
    const result = render('before {bogus} after', ctx());
    expect(result.text).toBe('before  after');
    expect(result.unknown).toEqual(['bogus']);
  });

  it('unknown-name matching is also case-insensitive', () => {
    expect(render('{BOGUS}', ctx()).unknown).toEqual(['bogus']);
  });
});

describe('malformed tokens: consistent with the unknown-name rule (empty + reported)', () => {
  it('an unclosed { renders the rest of the string as one malformed entry', () => {
    const result = render('abc {title', ctx());
    expect(result.text).toBe('abc ');
    expect(result.unknown).toEqual(['title']);
  });

  it('a stray unpaired } is literal text, not reported (decision: symmetric with }} collapsing to one })', () => {
    const result = render('abc } def', ctx());
    expect(result.text).toBe('abc } def');
    expect(result.unknown).toEqual([]);
  });

  it('trunc with no argument is malformed', () => {
    const c = ctx({ title: { title: 'x' } });
    const result = render('{title|trunc}', c);
    expect(result.text).toBe('');
    expect(result.unknown).toEqual(['title|trunc']);
  });

  it('plural with no argument is malformed', () => {
    const c = ctx({ number: { label: label(1), counts: new Map([[S('st_panel'), 2]]) } });
    const result = render('{count:st_panel|plural}', c);
    expect(result.text).toBe('');
    expect(result.unknown).toEqual(['count|plural']);
  });

  it('an unrecognized filter name is malformed', () => {
    const c = ctx({ title: { title: 'x' } });
    const result = render('{title|frobnicate}', c);
    expect(result.text).toBe('');
    expect(result.unknown).toEqual(['title|frobnicate']);
  });

  it('{field} with no key is malformed; {field:<unknown key>} too', () => {
    expect(render('{field}', ctx()).unknown).toEqual(['field']);
    expect(render('{field:bogus}', ctx()).unknown).toEqual(['field:bogus']);
  });

  it('{style} with no id is malformed', () => {
    expect(render('{style}', ctx()).unknown).toEqual(['style']);
  });

  it('{count} with no id is malformed', () => {
    expect(render('{count}', ctx()).unknown).toEqual(['count']);
  });

  it('{n:<unrecognized arg>} is malformed', () => {
    const c = ctx({ number: { label: label(1), counts: new Map() } });
    expect(render('{n:bogus}', c).unknown).toEqual(['n:bogus']);
  });

  it('{count:<id>:<unrecognized format>} is malformed', () => {
    const c = ctx({ number: { label: label(1), counts: new Map([[S('st_panel'), 2]]) } });
    expect(render('{count:st_panel:bogus}', c).unknown).toEqual(['count:st_panel:bogus']);
  });
});

describe('conditionals', () => {
  it('{if Name}text{/if} is true only for a non-empty expansion', () => {
    const truthy = ctx({ revision: { name: 'Blue', color: null, date: null, mark: null, active: null, collated: [] } });
    const falsyEmpty = ctx({ revision: { name: '', color: null, date: null, mark: null, active: null, collated: [] } });
    const falsyAbsent = ctx();
    expect(render('{if revision.name}text{/if}', truthy).text).toBe('text');
    expect(render('{if revision.name}text{/if}', falsyEmpty).text).toBe('');
    expect(render('{if revision.name}text{/if}', falsyAbsent).text).toBe('');
  });

  it('{if Name}A{else}B{/if} picks the else branch when false', () => {
    const truthy = ctx({ revision: { name: 'Blue', color: null, date: null, mark: null, active: null, collated: [] } });
    const falsy = ctx();
    expect(render('{if revision.name}A{else}B{/if}', truthy).text).toBe('A');
    expect(render('{if revision.name}A{else}B{/if}', falsy).text).toBe('B');
  });

  it('conditionals nest, each {/if} closing its own {if}', () => {
    const both = ctx({
      revision: { name: 'Blue', color: null, date: null, mark: null, active: null, collated: [] },
      scene: { heading: 'INT. HOUSE', number: null },
    });
    const outerOnly = ctx({ revision: { name: 'Blue', color: null, date: null, mark: null, active: null, collated: [] } });
    const template = '{if revision.name}{if scene.heading}AB{/if}{else}C{/if}';
    expect(render(template, both).text).toBe('AB');
    expect(render(template, outerOnly).text).toBe('');
  });

  it('an {if} with no matching {/if} is malformed (empty + reported)', () => {
    const c = ctx({ revision: { name: 'Blue', color: null, date: null, mark: null, active: null, collated: [] } });
    const result = render('before {if revision.name}text', c);
    expect(result.text).toBe('before ');
    expect(result.unknown).toEqual(['if revision.name']);
  });

  it('{else} and {/if} outside any open conditional are ordinary unknown tokens', () => {
    expect(render('{else}', ctx()).unknown).toEqual(['else']);
    expect(render('{/if}', ctx()).unknown).toEqual(['/if']);
  });
});

describe('parseTokenString', () => {
  it('produces a flat node list mixing literal and token nodes', () => {
    const nodes = parseTokenString('Page {page} of {pages}');
    expect(nodes).toEqual([
      { kind: 'literal', text: 'Page ' },
      { kind: 'token', name: 'page', args: [], filters: [] },
      { kind: 'literal', text: ' of ' },
      { kind: 'token', name: 'pages', args: [], filters: [] },
    ]);
  });
});
