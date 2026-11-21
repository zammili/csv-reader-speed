import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking');
const cases = JSON.parse(readFileSync(new URL('../../kit-csv-speed/csv-reader-speed-01-run-20261121-kit/practice/input/cases.json', import.meta.url), 'utf8'));
const A = (await import(process.argv[2])).run;
const B = (await import(process.argv[3])).run;
for (const c of cases) { A(c.input); B(c.input); }
const rounds = Number(process.argv[4] ?? 11);
const ta = [], tb = [];
for (let r = 0; r < rounds; r++) {
  let t0 = process.hrtime.bigint();
  for (const c of cases) A(c.input);
  ta.push(Number(process.hrtime.bigint() - t0) / 1e6);
  t0 = process.hrtime.bigint();
  for (const c of cases) B(c.input);
  tb.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
const stat = (xs) => `min ${Math.min(...xs).toFixed(1)}  median ${xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(1)}`;
console.log(`A ${process.argv[2]}: ${stat(ta)}`);
console.log(`B ${process.argv[3]}: ${stat(tb)}`);
