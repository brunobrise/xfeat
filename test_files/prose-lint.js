// STE-lite sentence rule for generated Markdown: no sentence longer than
// `max` words. Inline code counts as one word, link targets and HTML tags are
// ignored, and tables, headings, and code blocks are skipped because they are
// not prose. See docs/research/01a10804fd3079f7-explorable-docs-curriculum-research.md.
function proseLines(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = [];
  let fenced = false;
  for (const raw of body.split("\n")) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s*(\||#)/.test(raw)) continue;
    const text = raw
      .replace(/<[^>]+>/g, " ")
      .replace(/`[^`]*`/g, "CODE")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
      .trim();
    if (text) lines.push(text);
  }
  return lines;
}

function longSentences(markdown, max = 25) {
  const found = [];
  for (const line of proseLines(markdown)) {
    for (const sentence of line.split(/(?<=[.?!:])\s+/)) {
      const words = sentence.split(/\s+/).filter(Boolean).length;
      if (words > max) found.push({ sentence, words });
    }
  }
  return found;
}

module.exports = { longSentences };
