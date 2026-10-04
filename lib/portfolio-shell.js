// Just enough shell reading to split a CI `run: |` block into the commands a
// developer could type. It tracks quotes, escapes, comments, arithmetic, and
// heredocs, because each of them can make text look like a command or hide
// one. It is not a shell parser; it errs toward keeping a line.

const SHELL_BODY = /^(?:bash|sh|zsh|dash)\b/;

// Scans one logical line outside of heredoc bodies. Returns the quote still
// open at the end, if any, and the delimiter of the first heredoc it opens.
function scanShell(text) {
  let quote = null;
  let heredoc = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (ch === "\\") i += 1;
      else if (ch === '"') quote = null;
      continue;
    }
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    // A comment ends the line; `<<EOF` in it opens nothing.
    if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) break;
    // `$((1<<BITS))` is a shift, not a heredoc.
    if (text.startsWith("$((", i)) {
      const end = text.indexOf("))", i + 3);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    // `<<<` is a here-string: its word is on the same line.
    if (text.startsWith("<<<", i)) {
      i += 2;
      continue;
    }
    if (!heredoc && text.startsWith("<<", i)) {
      const match = /^<<-?\s*(?:\\|(['"]))?([A-Za-z_]\w*)\1?/.exec(
        text.slice(i),
      );
      if (match) {
        heredoc = match[2];
        i += match[0].length - 1;
      }
    }
  }
  return { quote, heredoc };
}

// Index just past one shell word starting at `start`, honouring quotes and
// `$(...)` so `X="a b"` and `X=$(cmd | tr -d '"')` are one word each.
function wordEnd(text, start) {
  let quote = null;
  let depth = 0;
  let i = start;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (ch === "\\") i += 1;
      else if (ch === '"') quote = null;
      continue;
    }
    if (ch === "\\") {
      i += 1;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (text.startsWith("$(", i)) {
      depth += 1;
      i += 1;
    } else if (ch === ")" && depth) {
      depth -= 1;
    } else if (/\s/.test(ch) && !depth) {
      break;
    }
  }
  return i;
}

// `RESULT=ok` or `FAILS=$(jq ...)` runs nothing a developer would type;
// `RUSTFLAGS="-D warnings" cargo test` still runs `cargo test`.
function onlyAssignments(text) {
  let rest = text;
  let assigned = false;
  for (;;) {
    const match = /^[A-Za-z_]\w*=/.exec(rest);
    if (!match) break;
    assigned = true;
    rest = rest.slice(wordEnd(rest, match[0].length)).trimStart();
  }
  return assigned && rest === "";
}

// Joins backslash continuations and lines inside an open quote into logical
// lines. Heredoc bodies are skipped as data, except bodies fed to a shell,
// whose lines are commands; their closing delimiter is skipped.
function blockCommands(block) {
  const out = [];
  let shellDelimiter = null;
  let i = 0;
  while (i < block.length) {
    let { text } = block[i];
    const { line } = block[i];
    i += 1;
    if (shellDelimiter && text === shellDelimiter) {
      shellDelimiter = null;
      continue;
    }
    while (i < block.length) {
      if (text.endsWith("\\")) {
        text = `${text.slice(0, -1).trim()} ${block[i].text}`;
      } else if (scanShell(text).quote) {
        text = `${text} ${block[i].text}`;
      } else {
        break;
      }
      i += 1;
    }
    out.push({ text, line });
    const { heredoc } = scanShell(text);
    if (!heredoc) continue;
    if (SHELL_BODY.test(text)) {
      shellDelimiter = heredoc;
      continue;
    }
    while (i < block.length && block[i].text !== heredoc) i += 1;
    i += 1;
  }
  return out;
}

module.exports = { blockCommands, onlyAssignments, scanShell };
