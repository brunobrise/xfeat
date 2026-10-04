// STE-lite checks for generated Markdown, paraphrasing ASD-STE100 Issue 9
// rules 3.6, 4.2, 5.1, 5.2, 6.3, 6.6, 8.1, and 8.6. See the Writing Rules
// section of docs/specs/01a10804fd3272c3-portfolio-learning-path-and-checks.md.
//
// Only xfeat's own prose is checked. Tables, headings, code, HTML comments,
// link targets, and blockquotes are skipped: blockquotes hold quoted source
// text, which xfeat must not rewrite. Inline code counts as one word.

const PASSIVE =
  /\b(?:am|is|are|was|were|be|been|being)\s+(?:not\s+)?(?:\w+ly\s+)?(?:\w+ed|built|made|run|set|kept|read|found|shown|known|written|given|taken|done|seen|sent|held|left|put|bound|drawn|chosen)\b/i;
const CONTRACTION =
  /\b\w+n['’]t\b|\b(?:it|that|there|what|here|who|let)['’]s\b|\b\w+['’](?:re|ve|ll|d|m)\b/i;

function clean(raw) {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/`[^`]*`/g, "CODE")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
    .trim();
}

// Splits a page into prose blocks: a paragraph is consecutive plain lines,
// and each list item is its own block. A numbered item that is not a
// question is a step, the procedural writing that rules 5.1 and 5.2 cover.
function proseBlocks(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const blocks = [];
  let paragraph = null;
  let fenced = false;
  const close = () => {
    if (paragraph) blocks.push(paragraph);
    paragraph = null;
  };
  for (const raw of body.split("\n")) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      close();
      continue;
    }
    if (fenced || /^\s*(\||#|>|<!--)/.test(raw) || !raw.trim()) {
      close();
      continue;
    }
    const text = clean(raw);
    if (!text) continue;
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(raw)) {
      close();
      const numbered = /^\s*\d+\.\s+/.test(raw);
      blocks.push({ text, step: numbered && !text.endsWith("?") });
      continue;
    }
    paragraph = paragraph
      ? { text: `${paragraph.text} ${text}`, step: false }
      : { text, step: false };
  }
  close();
  return blocks;
}

function sentencesOf(text) {
  return text.split(/(?<=[.?!:])\s+/).filter(Boolean);
}

// Returns one finding per rule broken, with the sentence or block that broke
// it. `allow` lists patterns for passive sentences whose doer is unknown.
function proseFindings(markdown, { allow = [] } = {}) {
  const findings = [];
  const add = (rule, text) => findings.push({ rule, text });
  for (const block of proseBlocks(markdown)) {
    const sentences = sentencesOf(block.text);
    // A colon introduces, it does not end a sentence, so "(evidence: x)"
    // stays one instruction. ", then" and "and then" chain a second one.
    const full = block.text.split(/(?<=[.?!])\s+/).filter(Boolean);
    const chained = /,\s+then\b|\band then\b/i.test(block.text);
    if (block.step && (full.length > 1 || chained)) {
      add("one-instruction", block.text);
    }
    if (!block.step && sentences.length > 6) {
      add("paragraph-length", block.text);
    }
    for (const sentence of sentences) {
      const words = sentence.split(/\s+/).filter(Boolean).length;
      if (block.step && words > 20) add("step-length", sentence);
      if (!block.step && words > 25) add("sentence-length", sentence);
      if (sentence.includes(";")) add("semicolon", sentence);
      if (CONTRACTION.test(sentence)) add("contraction", sentence);
      if (PASSIVE.test(sentence) && !allow.some((re) => re.test(sentence))) {
        add("passive", sentence);
      }
    }
  }
  return findings;
}

// Kept for existing tests: sentences over `max` words, steps included.
function longSentences(markdown, max = 25) {
  const found = [];
  for (const block of proseBlocks(markdown)) {
    for (const sentence of sentencesOf(block.text)) {
      const words = sentence.split(/\s+/).filter(Boolean).length;
      if (words > max) found.push({ sentence, words });
    }
  }
  return found;
}

module.exports = { longSentences, proseFindings };
