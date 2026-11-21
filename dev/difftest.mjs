// Differential test: my solve.js against the kit's reference csv-reader 1.0.0, over hand-written
// edge cases, the kit's practice cases, and generated fuzz corpora. Any mismatch is a bug in
// solve.js; the reference is never wrong here.
//
//   node dev/difftest.mjs [seed] [fuzzCount]

import { readFileSync } from 'node:fs';
import { readCsv } from '../../kit-csv-speed/csv-reader-speed-01-run-20261121-kit/baselines/csv-reader/vendor/csv-reader/index.js';
import { run } from '../solve.js';

/** Canonical JSON, the scorer's equality: object keys sorted, everything else as written. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

let checked = 0;
let mismatches = 0;
function check(input, label) {
  checked += 1;
  const want = canonical(readCsv(input));
  const got = canonical(run(input));
  if (want !== got) {
    mismatches += 1;
    console.log(`MISMATCH [${label}] input=${JSON.stringify(input).slice(0, 400)}`);
    if (mismatches <= 3) {
      // Show the first differing region to make the failure readable.
      let i = 0;
      while (i < want.length && i < got.length && want[i] === got[i]) i += 1;
      console.log(`  want …${want.slice(Math.max(0, i - 60), i + 120)}`);
      console.log(`  got  …${got.slice(Math.max(0, i - 60), i + 120)}`);
    }
  }
}

// ---------- hand-written edge cases ----------
const EDGE_TEXTS = [
  '', '\n', '\r', '\r\n', '\n\n\n', '\r\r', '\r\r\n', '\n\r', '\r\n\r', 'a', 'a\n', 'a\r', 'a\r\n',
  ',', ',\n', ',,', 'a,b', 'a,b\n', 'a,b\r\n', 'a,', ',a', 'a,,b', 'a,b\nc', 'a,b\nc,d,e',
  'a,b\nc,d', 'a,b\nc', 'a,b\nc,d,e\nf', '"', '""', '"""', '""""', '"a"', '"a', '"a\n', '"a\nb',
  '"a\nb"', '"a\nb', '"a\rb"', '"a\r\nb"', '"a\rb', '"a""b"', '"a"""', '"a"x', '"a"xy,z',
  '"a"\r', '"a"\rx', '"a"\r\n', '"a" \n', '"a""', '"a""\n', '"a""x', 'a"b', 'a"b"c', 'a\r' + 'b',
  'a\rb\nc', 'a\r\rb', '\uFEFF', '\uFEFFa,b', '\uFEFF\uFEFFa', 'x\uFEFFy', '"\uFEFF"',
  '"x\r\ny",z', '"x\ry",z\n', '"x\n\ny"', 'h1,h2\n"multi\nline",2\n3,4', '  a  ,  b  ',
  'a,b\n\n\nc,d', 'a,b\n\r\nc,d', 'a,b\n\rc,d', '\ra,b', '"",', ',""', '"",""', 'a,"b\nc",d',
  'a,"b\nc', 'a,"b""c",d', 'a,"b"junk,d', 'a,"b"junk', '"h"\n"a"\n"b"', 'one\ntwo\nthree',
  'one\r\ntwo\r\nthree', 'one\rtwo', 'a,b,c\nd,e\nf,g,h,i', 'a,b,c\nd,e,f,g', '"q" ,x',
  '"q"\t,x', 'x,"unterminated', 'x,"unterminated\nmore,fields\nhere,too', '"open\n\n\nclose"',
  '"open\r\rclose"', '"open\r\n\r\nclose"', 'field;with;semicolons', 'trailing,', 'trailing,\n',
  'trailing,,', 'é,東京\n數據,Δέλτα', '"São Paulo",Kraków', 'long' + 'x'.repeat(5000) + ',end',
  '"' + 'y'.repeat(5000) + '"', '"' + 'z'.repeat(5000), 'a'.repeat(3000) + '\r' + 'b'.repeat(3000),
];
for (const t of EDGE_TEXTS) {
  check({ text: t, header: true }, 'edge/header');
  check({ text: t, header: false }, 'edge/noheader');
}
// Missing / odd header values: only === true counts.
check({ text: 'a,b\n1,2' }, 'edge/no-header-key');
check({ text: 'a,b\n1,2', header: 1 }, 'edge/header-1');
console.log(`edge cases done: ${checked} checks, ${mismatches} mismatches`);

// ---------- the kit's practice cases, through run() directly ----------
const cases = JSON.parse(readFileSync(new URL('../../kit-csv-speed/csv-reader-speed-01-run-20261121-kit/practice/input/cases.json', import.meta.url), 'utf8'));
for (const c of cases) check(c.input, `practice/${c.id}`);
console.log(`practice cases done: ${checked} checks, ${mismatches} mismatches`);

// ---------- fuzz ----------
const seed0 = Number(process.argv[2] ?? 12345);
const fuzzCount = Number(process.argv[3] ?? 2500);
let state = seed0 >>> 0;
function rnd() {
  // mulberry32
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// Byte soup: CSV-significant pieces in random order, so quotes open and close (or not) anywhere.
const SOUP = [
  'a', 'bc', 'word', '42', ' ', '', ',', '"', '""', '"""', '\r', '\n', '\r\n', '\n\r', 'é', '東京',
  '"op', 'en"', '"a,b"', 'x"y', '\uFEFF', 'kg', ' (est.)', 'a,b', '1,2,3', '\r\r', '\n\n', '","',
];
function soupText() {
  const parts = [];
  const k = ri(1, 60);
  for (let i = 0; i < k; i++) parts.push(pick(SOUP));
  return parts.join('');
}

// Structured: rows like the generator's, with its broken kinds injected by hand.
const WORDS = ['alpha', 'bravo', 'Zürich', 'São Paulo', '東京', 'naïve', "O'Brien", 'n/a', '#42', 'x_1', ''];
function fieldValue() {
  const kind = ri(0, 5);
  if (kind === 0) return String(ri(-999, 99999));
  if (kind === 1) return `${ri(1990, 2030)}-0${ri(1, 9)}-1${ri(0, 9)}`;
  if (kind === 2) return pick(WORDS);
  if (kind === 3) return [pick(WORDS), pick(WORDS), pick(WORDS)].join(rnd() < 0.3 ? ', ' : ' ');
  if (kind === 4) return [pick(WORDS), pick(WORDS)].join(rnd() < 0.2 ? '\r' : '\n') + ' ' + pick(WORDS);
  return pick(WORDS) + ' "' + pick(WORDS) + '" ' + pick(WORDS);
}
function cellOf(s) {
  let must = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 44 || c === 34 || c === 10 || c === 13) { must = true; break; }
  }
  if (must) return `"${s.replaceAll('"', '""')}"`;
  return s !== '' && rnd() < 0.05 ? `"${s}"` : s;
}
function structuredText() {
  const eol = rnd() < 0.5 ? '\r\n' : '\n';
  const width = ri(1, 12);
  const out = [];
  if (rnd() < 0.3) out.push('\uFEFF');
  const nRows = ri(0, 40);
  for (let r = 0; r < nRows; r++) {
    if (rnd() < 0.03) out.push(eol); // a blank line before the record
    let fields = Array.from({ length: width }, fieldValue);
    const x = rnd();
    let crAt = -1;
    let junkAt = -1;
    if (x < 0.04) fields = fields.slice(0, Math.max(0, width - ri(1, 3)));
    else if (x < 0.08) for (let k = ri(1, 3); k > 0; k--) fields.push(fieldValue());
    else if (x < 0.11) crAt = ri(0, fields.length - 1);
    else if (x < 0.14) junkAt = ri(0, fields.length - 1);
    const cells = fields.map((f, i) => {
      if (i === crAt) return `${pick(WORDS)}\r${pick(WORDS)}`;
      if (i === junkAt) return `"${f.replaceAll('"', '""')}"${pick(['kg', 'x', ' cm', '!', 'x"y', '\r', ' '])}`;
      return cellOf(f);
    });
    out.push(cells.join(',') + eol);
  }
  if (rnd() < 0.25) out.push('"' + fieldValue()); // a quote that never closes, at the very end
  let text = out.join('');
  if (rnd() < 0.3 && text.length >= eol.length) text = text.slice(0, text.length - eol.length);
  return text;
}

for (let i = 0; i < fuzzCount; i++) {
  check({ text: soupText(), header: rnd() < 0.5 }, `fuzz/soup#${i}`);
  check({ text: structuredText(), header: rnd() < 0.5 }, `fuzz/structured#${i}`);
}
console.log(`fuzz done (seed ${seed0}): ${checked} checks total, ${mismatches} mismatches`);
if (mismatches > 0) process.exit(1);
console.log('ALL MATCH');
