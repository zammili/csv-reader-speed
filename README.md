[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=badge&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/zammili/csv-reader-speed/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=rank-badge&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/zammili/csv-reader-speed/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=reward-badge&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-speed

A fast drop-in replacement for make.fun's **csv-reader 1.0.0**, built for the make.fun bounty
[csv-reader-speed-01-run-20261121](https://make.fun/c/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
("Read broken CSV files faster"). `solve.js` exports `run(input)`, which returns exactly
csv-reader's answer — `{columns, rows, errors}` — for every input `{text, header}`, broken rows
included; `main.ts` is the driver the harness runs, reading `/input/cases.json` and writing
`/output/answers.json`.

## The semantics (csv-reader's, unchanged)

- A U+FEFF at the very start of the text is dropped.
- A record ends at LF or CRLF; a line left with no characters is no record.
- Outside quotes, a CR not followed by LF is dropped (`stray_cr`).
- A field that opens with a quote runs to the next quote that is not doubled (`""` inside it is
  one quote; each CRLF or lone CR inside it is read as LF). What follows its closing quote, up to
  the next comma or line break, is appended as it stands (`quote_junk`, when the field ends). A
  quote that never closes is a literal character, and the text after it is read again as unquoted
  (`unterminated_quote`).
- A quote inside an unquoted field is a literal character. Fields stay strings, never trimmed
  or converted.
- `columns` is the first record when `header` is true, else `null`; `rows` holds the records
  after it (every record when `header` is false), each padded with `""` (`short_row`, with
  `fields`: its count) or cut (`long_row`, with `extra`: the cut fields) to the first record's
  width.
- Each error is `{code, line, row}` in the order met: `line` the 1-based line its record starts
  on (every LF, CRLF and lone CR inside quotes counted), `row` its record's index in `rows`
  (`null` for the header).

## Approach

csv-reader walks the text one character at a time and builds every field character by
character. This reader keeps the same single left-to-right pass and the same decisions, but
never copies a character it does not have to:

- **Fields are slices, not concatenations.** Each reader scans for the next character that can
  matter (comma, LF, CR, quote) and takes the field — or each unbroken run of it, between the
  few characters that need rewriting (a dropped stray CR, a doubled quote, a CR inside quotes
  read as LF) — as one `slice` of the input.
- **Whole-record fast path.** When a record's whole line holds no quote and no CR but a
  CRLF's, the record is the line split at its commas; the probes stay inside the line, so they
  cost the line's length however rare quotes and CRs are in the rest of the file.
- **Quoted-field fast path.** When the next quote closes the field and the field's own slice
  holds no CR or LF, the value is that slice; doubled quotes, embedded line breaks and
  unterminated quotes take the general path, which still works run by run rather than character
  by character.
- Errors are recorded exactly where the reference records them, in the same order, including
  the ones a skipped line of stray CRs leaves behind and the `quote_junk` that is only known
  once the junk after a closing quote has been read.

Correctness is guarded by a differential harness (`dev/difftest.mjs`, `dev/bigfuzz.mjs`) that
runs this reader and the reference over hand-written edge cases, the kit's practice cases,
tens of thousands of generated fuzz inputs (CSV byte soup and structured files with the
generator's broken kinds), and generator-sized files of 1.5–2.0M characters: every answer
byte-identical, zero mismatches. The kit's own scorer grades the practice set at
`{"passed":1,"cases_passed":6,"cases_total":6}`, and `grade-local` reproduces it.

## Local benchmark

Measured on the kit's practice set (6 cases, ~10.2 MB of CSV), back to back on one machine
(Node v24.22.1; the grader runs Node 22 in a 1-CPU container, so absolute times differ —
ratios are the portable part):

| measurement | csv-reader 1.0.0 | this entry | ratio |
| --- | ---: | ---: | ---: |
| `run()` over the 6 cases, median of repeated in-process rounds | ~0.58–0.75 s | ~0.09 s | **~6.5× faster** |
| whole program (the house driver end to end), CPU user+sys, median of 7 runs | ~2.71 s | ~1.38 s | **~2.0× faster** |

The whole-program figure includes the driver's fixed cost — Node start-up, `JSON.parse` of
the 11 MB cases file, `JSON.stringify` of the 12 MB answers — which is the same for every
entry and is netted out of the contest's timing by its do-nothing control; the parse itself,
the part `solve.js` controls, runs about six and a half times faster than the reference.

## Layout

- `solve.js` — the reader: a dependency-free ES module exporting `run(input)`.
- `main.ts` — the harness driver (the house driver's shape; V8 incremental marking off).
- `package.json` — `{"type": "module"}`.
- `dev/` — the differential test harness and benchmarks used while building (not run by the
  harness).

## License

MIT — see `LICENSE`.

---

Entered on make.fun with referral ref nj55s4jw and campaign slug csv-reader-speed-01-run-20261121.
