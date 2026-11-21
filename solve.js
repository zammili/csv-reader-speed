// A fast drop-in replacement for csv-reader 1.0.0 (make.fun's reference CSV reader).
//
// run(input) returns exactly csv-reader's answer for every input {text, header}: {columns, rows, errors},
// under csv-reader's written broken-row policy:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled ("" inside it is one
//     quote; each CRLF or lone CR inside it is read as LF); what follows its closing quote, up to the
//     next comma or line break, is appended as it stands (quote_junk, when the field ends); a quote
//     that never closes is a literal character and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed;
//   - columns is the first record when header is true, else null; rows holds the records after it
//     (every record when header is false), each padded with "" (short_row, with fields: its count) or
//     cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met: line the 1-based line its record starts on
//     (every LF, CRLF and lone CR inside quotes counted), row its record's index in rows (null for
//     the header).
//
// Where the reference walks one character at a time and builds every field character by character,
// this reader scans for the next character that can matter (comma, LF, CR, quote) and takes each
// field, or each unbroken run of one, as a single slice of the text. The semantics are unchanged;
// only the copying is gone.

// How a field ended: 0 at a comma (the record goes on), 1 at a line break, 2 at the end of the text.
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field last read: its value, how it ended (0 comma, 1 line break, 2 end), and how many
  // characters the last unquoted read kept (the junk test after a closing quote).
  let fValue = '';
  let fEnded = 2;
  let fAdded = 0;

  // Reads unquoted characters onto `initial` up to the next comma or line break: a CR not followed
  // by LF is dropped (stray_cr). Sets fValue, fEnded and fAdded (characters kept by this read).
  function readUnquoted(initial) {
    let built = initial === '' ? null : initial; // null: nothing forced a copy yet
    let added = 0;
    let seg = pos; // start of the run not yet copied into built
    let i = pos;
    for (;;) {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10 || c === 13) break; // , \n \r
        i += 1;
      }
      if (i >= n) {
        fValue = built === null ? text.slice(seg, n) : built + text.slice(seg, n);
        fAdded = added + (n - seg);
        pos = n;
        fEnded = 2;
        return;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        fValue = built === null ? text.slice(seg, i) : built + text.slice(seg, i);
        fAdded = added + (i - seg);
        pos = i + 1;
        fEnded = 0;
        return;
      }
      if (c === 10) {
        fValue = built === null ? text.slice(seg, i) : built + text.slice(seg, i);
        fAdded = added + (i - seg);
        pos = i + 1;
        line += 1;
        fEnded = 1;
        return;
      }
      // c is CR: CRLF ends the field; a lone CR is dropped.
      if (text.charCodeAt(i + 1) === 10) {
        fValue = built === null ? text.slice(seg, i) : built + text.slice(seg, i);
        fAdded = added + (i - seg);
        pos = i + 2;
        line += 1;
        fEnded = 1;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      built = built === null ? text.slice(seg, i) : built + text.slice(seg, i);
      added += i - seg;
      i += 1;
      seg = i;
    }
  }

  // A quoted field has closed with `value`, and pos is just past its closing quote: the field
  // ends here, or what follows the quote is appended as it stands. Sets fValue and fEnded.
  function afterQuote(value) {
    if (pos >= n) {
      fValue = value;
      fEnded = 2;
      return;
    }
    const a = text.charCodeAt(pos);
    if (a === 44) {
      pos += 1;
      fValue = value;
      fEnded = 0;
      return;
    }
    if (a === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = 1;
      return;
    }
    if (a === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = 1;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line
    // break; if any of it was kept, the field carries junk.
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue and fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    const start = pos + 1; // the field's first content character

    // Fast path: the next quote closes the field and nothing between the quotes needs
    // rewriting — no doubled quote, no CR to read as LF, no LF to count. The checks run on
    // the field's own slice, so they cost the field's length however rare CRs are elsewhere.
    const q = text.indexOf('"', start);
    if (q !== -1 && text.charCodeAt(q + 1) !== 34) {
      const value = text.slice(start, q);
      if (value.indexOf('\r') === -1 && value.indexOf('\n') === -1) {
        pos = q + 1;
        afterQuote(value);
        return;
      }
    }

    let built = null; // null: the content so far is the raw run from seg
    let seg = start;
    let i = start;
    for (;;) {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 34 || c === 13) break; // " \r
        if (c === 10) line += 1; // an LF inside quotes is kept as it stands
        i += 1;
      }
      if (i >= n) {
        // The quote never closes: it is a literal character, and the text after it is read again
        // as unquoted, from just after the opening quote and on the line the quote opened on.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      const c = text.charCodeAt(i);
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          // A doubled quote is one quote in the value.
          built = built === null ? text.slice(seg, i) + '"' : built + text.slice(seg, i) + '"';
          i += 2;
          seg = i;
          continue;
        }
        // The closing quote.
        const value = built === null ? text.slice(start, i) : built + text.slice(seg, i);
        pos = i + 1;
        afterQuote(value);
        return;
      }
      // c is CR: CRLF and a lone CR inside quotes are each one LF.
      built = built === null ? text.slice(seg, i) + '\n' : built + text.slice(seg, i) + '\n';
      line += 1;
      i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
      seg = i;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let fields = null;
    let skipRecord = false;

    // Fast path: the whole record sits on one line with no quote and no CR but a CRLF's. Such a
    // record is the line split at its commas: no field can open a quote, no CR can be stray, and
    // no field can run past the line's end. The probes stay inside the line, so they cost the
    // line's length however rare quotes and CRs are in the rest of the file.
    const eolIdx = text.indexOf('\n', pos);
    const lineEnd = eolIdx === -1 ? n : eolIdx;
    const lineStr = text.slice(pos, lineEnd);
    const rIdx = lineStr.indexOf('\r');
    if (lineStr.indexOf('"') === -1 && (rIdx === -1 || (eolIdx !== -1 && rIdx === lineStr.length - 1))) {
      fields = (rIdx === -1 ? lineStr : lineStr.slice(0, -1)).split(',');
      pos = eolIdx === -1 ? n : eolIdx + 1;
      if (eolIdx !== -1) line += 1;
    } else {
      // The general path: field by field, unquoted fields scanned inline, quoted fields and the
      // broken corners read by the helpers above.
      fields = [];
      let quoted = false;
      for (;;) {
        if (text.charCodeAt(pos) === 34) {
          quoted = true;
          readQuoted();
          fields.push(fValue);
          if (fEnded !== 0) break;
          continue;
        }
        quoted = false;
        let i = pos;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 44 || c === 10 || c === 13) break;
          i += 1;
        }
        if (i >= n) {
          fields.push(text.slice(pos, n));
          pos = n;
          break;
        }
        const c = text.charCodeAt(i);
        if (c === 44) {
          fields.push(text.slice(pos, i));
          pos = i + 1;
          continue;
        }
        if (c === 10) {
          fields.push(text.slice(pos, i));
          pos = i + 1;
          line += 1;
          break;
        }
        if (text.charCodeAt(i + 1) === 10) {
          fields.push(text.slice(pos, i));
          pos = i + 2;
          line += 1;
          break;
        }
        // A stray CR ends the plain run: the helper drops it and reads the field to its end.
        readUnquoted('');
        fields.push(fValue);
        if (fEnded !== 0) break;
      }
      // A line that held only stray CRs is left with no characters: no record (its errors stay).
      skipRecord = fields.length === 1 && fields[0] === '' && !quoted;
    }
    if (skipRecord) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
