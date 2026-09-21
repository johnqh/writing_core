import { describe, expect, it } from 'vitest';
import { createFontRegistry } from '../fonts/registry.js';
import { itemize } from './itemize.js';

const fonts = createFontRegistry();
const style = (family = 'courier-screenplay') =>
  ({
    font: { family, size: 12, bold: false, italic: false, underline: null, strike: false, smallCaps: false, color: '#000000' },
    direction: 'auto',
  }) as never;

describe('itemize (spec 02 §8.3)', () => {
  it('returns one item for uniform Latin text', () => {
    const items = itemize('Hello world', [], style(), fonts, 'en');
    expect(items).toHaveLength(1);
    expect(items[0]?.tier).toBe(1);
    expect(items[0]?.text).toBe('Hello world');
  });

  it('splits on bold but not on colour or underline', () => {
    const attrs = [
      { start: 0, end: 5, attrs: { fc: '#ff0000', u: true } },
      { start: 5, end: 8, attrs: { b: true } },
    ];
    const items = itemize('Hello you', attrs as never, style(), fonts, 'en');
    expect(items.map((i) => [i.text, i.bold])).toEqual([['Hello', false], [' yo', true], ['u', false]]);
  });

  it('produces a Latin / Arabic / CJK sequence', () => {
    const items = itemize('abc العربية 中文', [], style(), fonts, 'en');
    const scripts = items.map((i) => i.script);
    expect(scripts).toContain('Latin');
    expect(scripts).toContain('Arabic');
    expect(scripts).toContain('Han');
    expect(items.find((i) => i.script === 'Arabic')?.tier).toBe(2);
    expect(items.find((i) => i.script === 'Arabic')?.bidiLevel).toBe(1);
  });
});
