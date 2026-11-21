// Parse-only benchmark: run() vs the reference readCsv over the practice cases, in one process.
//   node dev/bench.mjs [rounds]
import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking');
import { readCsv } from '../../kit-csv-speed/csv-reader-speed-01-run-20261121-kit/baselines/csv-reader/vendor/csv-reader/index.js';
import { run } from '../solve.js';

const cases = JSON.parse(readFileSync(new URL('../../kit-csv-speed/csv-reader-speed-01-run-20261121-kit/practice/input/cases.json', import.meta.url), 'utf8'));
const rounds = Number(process.argv[2] ?? 7);

function timeIt(fn, label) {
  const times = [];
  for (let r = 0; r < rounds; r++) {
    const t0 = process.hrtime.bigint();
    for (const c of cases) fn(c.input);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  console.log(`${label}: median ${times[Math.floor(times.length / 2)].toFixed(1)} ms  min ${times[0].toFixed(1)}  all ${times.map((t) => t.toFixed(0)).join(' ')}`);
  return times[Math.floor(times.length / 2)];
}

// Warm both up once, then alternate to cancel drift.
for (const c of cases) { readCsv(c.input); run(c.input); }
const ref = timeIt(readCsv, 'reference readCsv');
const mine = timeIt(run, 'mine run()      ');
const ref2 = timeIt(readCsv, 'reference again ');
console.log(`speedup vs reference: ${(ref / mine).toFixed(2)}x (first), ${(ref2 / mine).toFixed(2)}x (second)`);
