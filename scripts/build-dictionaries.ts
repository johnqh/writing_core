// Regenerates `src/text/generated/dict-{th,lo,km,my}.ts` from the ICU break-iterator
// dictionaries (spec 02 §6.4, task 9). Bun script.
//
// **Source and pin.** ICU's `icu4c/source/data/brkitr/dictionaries/{thai,lao,khmer,
// burmese}dict.txt`, fetched from the `unicode-org/icu` GitHub tree pinned to release tag
// `release-78.3` (an immutable tag, not a moving branch — same reproducibility rationale as
// `fonts/LICENSES.md`'s pinned-commit sources). Each source file's SHA-256 is recorded in
// `dict/LICENSES.md`.
//
// **License — read from the source, not the brief (context item 4).** The task brief says
// all four ICU dictionaries are Unicode License v3. That is only correct for `thaidict.txt`
// and `khmerdict.txt`. The four source files' own per-file headers do NOT distinguish this —
// all four carry the same byte-identical two-line boilerplate pointer to
// `unicode.org/copyright.html`; reading only that would wrongly suggest one license for all
// four. What actually distinguishes them is ICU's own **top-level** `LICENSE` file (fetched
// at the same pinned tag, not trusted from memory or from the brief), which carries a
// "Third-Party Software Licenses" section with dedicated entries overriding that default
// pointer for `laodict.txt` and `burmesedict.txt` only, each a distinct BSD-style license
// under its own (non-Unicode) copyright holder — see `dict/ICU-LAO-DICTIONARY-LICENSE.txt`
// and `dict/ICU-BURMESE-DICTIONARY-LICENSE.txt`, vendored verbatim from that section, and
// `dict/LICENSES.md` for the full finding. `thaidict.txt`/`khmerdict.txt` have no entry in
// that section, so nothing overrides their header's pointer, whose current terms are the
// Unicode License v3 itself (verified byte-identical in its operative grant to
// `ucd/UNICODE-LICENSE.txt`, already vendored from unicode.org) — reusing that vendored text
// rather than re-fetching, per the task instructions.
//
// **Format.** Each source file is a plain word list, one word per line, `#`-prefixed comment
// lines (a UTF-8 BOM on the very first line, and a handful of files having a leading space
// before their `#`, both handled by trimming before the comment check). Words are compiled
// into a minimal acyclic finite-state automaton (DAWG): the classic incremental construction
// for a sorted, deduplicated word list (Daciuk et al., 2000) — insert words in lexicographic
// order, maintaining a stack of the previous word's path, and after each insertion minimize
// (register-dedupe) every node strictly deeper than the two words' common prefix. The result
// is serialized as a compact columnar binary (node count, a per-source alphabet table so
// transition characters are 1-byte indices rather than 2-byte code points, final-flags,
// per-node child counts, and transition (char-index, target-id) arrays — target ids are
// 16-bit unless a dictionary's node count exceeds 65 535, tracked per file by a `wide` flag)
// and embedded as a base64 string constant, decoded by `dict.ts` at load — never as a
// `Uint8Array` numeric-literal array (the shape `fonts/generated/*.fwm.ts` uses), because
// base64 text is roughly 3x more compact as *source* than a JS number-array literal, and
// these payloads are hundreds of KB (§6.4) where the font metrics generator's arrays are not.
//
// **Measured sizes vs spec 02 §6.4's approximate figures.** Reported in the task 9 report:
// this construction's gzipped sizes are smaller than the spec's estimate for Thai, but larger
// for Lao, Khmer and Myanmar — plain DAWG construction (no ICU-style bytecode trie with
// linear-match-run collapsing) does not hit the same numbers a production ICU build does.
// Flagged as a finding, not silently forced.
//
// Usage: bun run dict:generate
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ICU_TAG = 'release-78.3';
const DICT_BASE = `https://raw.githubusercontent.com/unicode-org/icu/${ICU_TAG}/icu4c/source/data/brkitr/dictionaries`;
const LICENSE_URL = `https://raw.githubusercontent.com/unicode-org/icu/${ICU_TAG}/LICENSE`;
const OUT_DIR = 'src/text/generated';

interface DictSpec {
  lang: string; // 'th' | 'lo' | 'km' | 'my'
  sourceFile: string; // thaidict.txt etc.
  constName: string; // DICT_TH_BASE64 etc.
}

const DICTS: readonly DictSpec[] = [
  { lang: 'th', sourceFile: 'thaidict.txt', constName: 'DICT_TH_BASE64' },
  { lang: 'lo', sourceFile: 'laodict.txt', constName: 'DICT_LO_BASE64' },
  { lang: 'km', sourceFile: 'khmerdict.txt', constName: 'DICT_KM_BASE64' },
  { lang: 'my', sourceFile: 'burmesedict.txt', constName: 'DICT_MY_BASE64' },
];

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Parses one ICU brkitr dictionary: one word per line, `#`-comment lines, BOM/leading-space tolerant. */
const BOM = String.fromCharCode(65279); // U+FEFF, built from its code point to avoid an embedded literal BOM in this source file

function parseWordList(text: string): string[] {
  const stripped = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const words: string[] = [];
  for (const rawLine of stripped.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    words.push(trimmed);
  }
  return words;
}

// ─── DAWG construction (Daciuk et al. incremental minimal-automaton algorithm) ─────────────

interface BuildNode {
  children: Map<number, BuildNode>;
  isFinal: boolean;
  finalId: number;
}
function newNode(): BuildNode {
  return { children: new Map(), isFinal: false, finalId: -1 };
}
function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

interface Dawg {
  root: BuildNode;
  nodeCount: number;
}

function buildDawg(words: string[]): Dawg {
  const sorted = Array.from(new Set(words)).sort();
  let nextId = 0;
  const register = new Map<string, BuildNode>();

  function signature(n: BuildNode): string {
    let s = n.isFinal ? 'F' : '.';
    for (const [ch, child] of n.children) s += `${ch.toString(36)}:${child.finalId},`;
    return s;
  }
  function freeze(n: BuildNode): BuildNode {
    const sig = signature(n);
    const found = register.get(sig);
    if (found) return found;
    n.finalId = nextId++;
    register.set(sig, n);
    return n;
  }

  const root = newNode();
  let stack: { ch: number; node: BuildNode }[] = [{ ch: -1, node: root }];
  let prevWord = '';

  function minimizeDownTo(keep: number): void {
    for (let i = stack.length - 1; i >= keep; i--) {
      const entry = stack[i] as { ch: number; node: BuildNode };
      const frozen = freeze(entry.node);
      (stack[i - 1] as { ch: number; node: BuildNode }).node.children.set(entry.ch, frozen);
    }
    stack.length = Math.max(keep, 1);
  }

  for (const word of sorted) {
    if (word.length === 0) continue;
    const cpl = commonPrefixLen(prevWord, word);
    minimizeDownTo(cpl + 1);
    let curr = (stack[stack.length - 1] as { ch: number; node: BuildNode }).node;
    for (let i = cpl; i < word.length; i++) {
      const ch = word.charCodeAt(i);
      let child = curr.children.get(ch);
      if (!child) {
        child = newNode();
        curr.children.set(ch, child);
      }
      stack.push({ ch, node: child });
      curr = child;
    }
    curr.isFinal = true;
    prevWord = word;
  }
  minimizeDownTo(1);
  const rootFrozen = freeze(root);
  return { root: rootFrozen, nodeCount: nextId };
}

/** Every word in `words` looks up as final in the built DAWG — a self-check run before emitting. */
function verifyDawg(dawg: Dawg, words: string[]): void {
  const sorted = Array.from(new Set(words)).sort();
  for (const word of sorted) {
    let node: BuildNode | undefined = dawg.root;
    for (let i = 0; i < word.length; i++) {
      node = node?.children.get(word.charCodeAt(i));
      if (!node) throw new Error(`DAWG verify failed: ${JSON.stringify(word)} not reachable`);
    }
    if (!node.isFinal) throw new Error(`DAWG verify failed: ${JSON.stringify(word)} reachable but not marked final`);
  }
}

// ─── Serialization: columnar binary, alphabet-indexed transitions (see header comment) ────

function serializeDawg(dawg: Dawg): Uint8Array {
  const { root, nodeCount } = dawg;
  const nodes: BuildNode[] = new Array(nodeCount);
  const visited = new Set<BuildNode>();
  const alphabetSet = new Set<number>();
  (function visit(n: BuildNode): void {
    if (visited.has(n)) return;
    visited.add(n);
    nodes[n.finalId] = n;
    for (const ch of n.children.keys()) alphabetSet.add(ch);
    for (const c of n.children.values()) visit(c);
  })(root);

  const alphabet = Array.from(alphabetSet).sort((a, b) => a - b);
  if (alphabet.length > 256) throw new Error(`alphabet too large: ${alphabet.length} (max 256)`);
  const charIndex = new Map<number, number>();
  alphabet.forEach((cp, i) => charIndex.set(cp, i));

  const wide = nodeCount > 0xffff;
  const finalFlags = new Uint8Array(nodeCount);
  const childCount = new Uint8Array(nodeCount);
  const transCharIdx: number[] = [];
  const transTarget: number[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const n = nodes[i] as BuildNode;
    finalFlags[i] = n.isFinal ? 1 : 0;
    if (n.children.size > 255) throw new Error(`node has >255 children: ${n.children.size}`);
    childCount[i] = n.children.size;
    const entries = Array.from(n.children.entries()).sort((a, b) => a[0] - b[0]);
    for (const [ch, child] of entries) {
      transCharIdx.push(charIndex.get(ch) as number);
      transTarget.push(child.finalId);
    }
  }

  const header = new Uint32Array([nodeCount, transCharIdx.length, root.finalId, wide ? 1 : 0, alphabet.length]);
  const alphabetArr = new Uint16Array(alphabet);
  const charBytes = new Uint8Array(transCharIdx);
  const targetBytes = wide ? new Uint8Array(new Uint32Array(transTarget).buffer) : new Uint8Array(new Uint16Array(transTarget).buffer);

  const parts = [new Uint8Array(header.buffer), new Uint8Array(alphabetArr.buffer), finalFlags, childCount, charBytes, targetBytes];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return buf;
}

function toBase64(bytes: Uint8Array): string {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const ch = (i: number): string => CHARS[i] as string;
  let out = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1] as number;
    const b2 = bytes[i + 2] as number;
    out += ch(b0 >> 2) + ch(((b0 & 3) << 4) | (b1 >> 4)) + ch(((b1 & 15) << 2) | (b2 >> 6)) + ch(b2 & 63);
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const b0 = bytes[i] as number;
    out += ch(b0 >> 2) + ch((b0 & 3) << 4) + '==';
  } else if (rem === 2) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1] as number;
    out += ch(b0 >> 2) + ch(((b0 & 3) << 4) | (b1 >> 4)) + ch((b1 & 15) << 2) + '=';
  }
  return out;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const licenseText = await fetchText(LICENSE_URL);
  console.log(`fetched ICU LICENSE (${ICU_TAG}): ${licenseText.length} bytes, sha256 ${sha256(licenseText)}`);

  for (const spec of DICTS) {
    const url = `${DICT_BASE}/${spec.sourceFile}`;
    const text = await fetchText(url);
    const sha = sha256(text);
    const words = parseWordList(text);
    const dawg = buildDawg(words);
    verifyDawg(dawg, words);
    const bin = serializeDawg(dawg);
    const b64 = toBase64(bin);

    const src =
      `// GENERATED by scripts/build-dictionaries.ts from ICU ${ICU_TAG}'s ${spec.sourceFile} — do not edit.\n` +
      `// Source SHA-256: ${sha}\n` +
      `// See dict/LICENSES.md for license and provenance (spec 02 §6.4, §3.1's obligation extended).\n` +
      `export const ${spec.constName} = '${b64}';\n`;
    writeFileSync(join(OUT_DIR, `dict-${spec.lang}.ts`), src);
    console.log(
      `${spec.sourceFile}: ${words.length} words, ${dawg.nodeCount} DAWG nodes, ${bin.length} raw bytes, ${b64.length} base64 chars, sha256 ${sha}`,
    );
  }

  console.log('done.');
}

await main();
