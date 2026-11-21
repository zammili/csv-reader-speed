// Large-scale differential test: files of generator size and shape (1.4-2.0M chars, 8-18
// columns, the generator's broken kinds, an unterminated quote near the end on half of them),
// compared against the reference.   node dev/bigfuzz.mjs [files]
import { readCsv } from '../../kit-csv-speed/csv-reader-speed-01-run-20261121-kit/baselines/csv-reader/vendor/csv-reader/index.js';
import { run } from '../solve.js';

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

let state = 987654321 >>> 0;
function rnd() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const WORDS = ['alpha', 'bravo', 'charlie', 'Zürich', 'São Paulo', 'Kraków', '東京', '數據', 'naïve', 'café', "O'Brien", 'well-known', 'n/a', '#42', '50%', 'x_1', 'A&B', ''];
const KINDS = ['int', 'decimal', 'date', 'code', 'word', 'word', 'phrase', 'phrase', 'note', 'maybe'];
function value(kind, eol, bare) {
  switch (kind) {
    case 'int': return String(ri(-99999, 9999999));
    case 'decimal': return `${ri(0, 99999)}.${ri(0, 9)}${ri(0, 9)}`;
    case 'date': return `${ri(1990, 2030)}-${String(ri(1, 12)).padStart(2, '0')}-${String(ri(1, 28)).padStart(2, '0')}`;
    case 'code': return `AB-${ri(100, 99999)}`;
    case 'word': case 'maybe': return pick(WORDS);
    case 'phrase': {
      const parts = [pick(WORDS)];
      const cnt = ri(2, 6);
      for (let i = 1; i < cnt; i++) parts.push(pick(WORDS));
      let s = parts.join(rnd() < 0.25 ? ', ' : ' ');
      if (!bare && rnd() < 0.12) s = `"${s}" ${pick(WORDS)}`;
      return s;
    }
    case 'note': {
      if (bare || rnd() < 0.85) return pick(WORDS);
      const lines = [pick(WORDS)];
      const cnt = ri(2, 4);
      for (let i = 1; i < cnt; i++) lines.push(pick(WORDS) + ' ' + pick(WORDS));
      return lines.join(rnd() < 0.1 ? '\r' : eol);
    }
  }
}
function cell(s) {
  let must = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 44 || c === 34 || c === 10 || c === 13) { must = true; break; }
  }
  if (must) return `"${s.replaceAll('"', '""')}"`;
  return s !== '' && rnd() < 0.01 ? `"${s}"` : s;
}
function makeFile() {
  const header = rnd() < 2 / 3;
  const eol = rnd() < 0.5 ? '\r\n' : '\n';
  const width = ri(8, 18);
  const kinds = Array.from({ length: width }, () => pick(KINDS));
  const target = ri(1400000, 2000000);
  const unterminated = rnd() < 0.5;
  const tail = ri(1, 20);
  const out = [];
  let length = 0;
  const push = (s) => { out.push(s); length += s.length; };
  if (rnd() < 1 / 3) push('\uFEFF');
  if (header) push(kinds.map((k, i) => `${k}_${i + 1}`).join(',') + eol);
  let tailLeft = unterminated ? tail : 1;
  let opened = false;
  while (tailLeft > 0) {
    const last = length >= target;
    const bare = last && unterminated;
    let fields = kinds.map((k) => value(k, eol, bare));
    const x = rnd();
    if (x < 0.01) fields.length = width - ri(1, 3);
    else if (x < 0.02) for (let k = ri(1, 3); k > 0; k--) fields.push(value(pick(KINDS), eol, bare));
    const crAt = x >= 0.02 && x < 0.024 ? ri(0, fields.length - 1) : -1;
    const junkAt = x >= 0.024 && x < 0.028 && !bare ? ri(0, fields.length - 1) : -1;
    const cells = fields.map((f, i) => {
      if (i === crAt) return `${pick(WORDS)}\r${pick(WORDS)}`.replaceAll(',', ' ').replaceAll('"', ' ');
      if (i === junkAt) return `"${f.replaceAll('"', '""')}"${pick(['kg', 'x', ' cm', '!', '?', ' (est.)', 'x"y'])}`;
      return bare ? f : cell(f);
    });
    if (x >= 0.028 && x < 0.031) push(eol);
    let line = cells.join(',');
    if (bare && !opened) { opened = true; line = `"${line}`; }
    push(line + eol);
    if (last) tailLeft -= 1;
  }
  let text = out.join('');
  if (rnd() < 0.3) text = text.slice(0, text.length - eol.length);
  return { text, header };
}

const files = Number(process.argv[2] ?? 3);
let bad = 0;
for (let i = 0; i < files; i++) {
  const input = makeFile();
  const want = canonical(readCsv(input));
  const got = canonical(run(input));
  console.log(`file ${i}: ${input.text.length} chars, header=${input.header} -> ${want === got ? 'MATCH' : 'MISMATCH'}`);
  if (want !== got) bad += 1;
}
if (bad > 0) process.exit(1);
console.log('BIG FUZZ ALL MATCH');
