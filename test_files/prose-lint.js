// STE-lite checks for generated Markdown, paraphrasing ASD-STE100 Issue 9
// rules 3.6, 4.2, 5.1, 5.2, 6.3, 6.6, 8.1, and 8.6. See the Writing Rules
// section of docs/specs/01a10804fd3272c3-portfolio-learning-path-and-checks.md.
//
// Only xfeat's own prose is checked. Tables, headings, code, HTML comments,
// link targets, and blockquotes are skipped: blockquotes hold quoted source
// text, which xfeat must not reword. Inline code counts as one word.

// A form of "be" or "get", an optional adverb, then a past participle that is
// not the start of a hyphenated adjective such as "read-only" or "built-in".
const PARTICIPLE =
  "(?:\\w{3,}ed|used|built|made|run|set|kept|read|found|shown|known|written|rewritten|overwritten|given|taken|done|seen|sent|held|left|put|bound|drawn|chosen|hidden|broken|driven|forgotten|thrown|caught|brought|thought|told|meant|lost)";
// "Getting started" is an idiom, not a get passive.
const PASSIVE = new RegExp(
  `\\b(?:am|is|are|was|were|be|been|being|get|gets|got|getting)\\s+(?:\\w+ly\\s+|(?:also|never|not|always|now|still|only|then|already|often)\\s+)?(?!started\\b)${PARTICIPLE}(?![-\\w])` +
    // A fragment such as "Required by web." or "documented by xfeat".
    `|(?:^|\\s)(?:\\w{3,}ed|built|made|written|run)\\s+by\\b`,
  "i",
);
const CONTRACTION =
  /\b\w+n['’ʼ]t\b|\b(?:it|that|there|what|here|who|let|he|she|where|how|why|when)['’ʼ]s\b|\b\w+['’ʼ](?:re|ve|ll|d|m)\b/i;
// Two actions in one step: ", then", "and then", or "and" followed by a
// common instruction verb.
const CHAINED =
  /,\s+then\b|\band then\b|\band (?:run|clone|open|read|check|install|change|verify|copy|edit|create|delete|add|remove|update|commit|push|rerun|restart)\b/i;
const MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
// Abbreviations whose period does not end a sentence.
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|cf)\./gi;

function clean(raw) {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/`[^`]*`/g, "CODE")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(MARKER, "")
    .trim();
}

// Splits a page into prose blocks: a paragraph is consecutive plain lines,
// and each list item is its own block, including indented continuation
// lines. A numbered item that is not a question is a step, the procedural
// writing that rules 5.1 and 5.2 cover.
function proseBlocks(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const blocks = [];
  let open = null;
  let fenced = false;
  const close = () => {
    if (open) blocks.push(open);
    open = null;
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
    if (MARKER.test(raw)) {
      close();
      open = { text, item: true, numbered: NUMBERED.test(raw) };
    } else if (open?.item && /^\s+/.test(raw)) {
      open.text = `${open.text} ${text}`;
    } else if (open && !open.item) {
      open.text = `${open.text} ${text}`;
    } else {
      close();
      open = { text, item: false, numbered: false };
    }
  }
  close();
  return blocks.map((block) => ({
    text: block.text,
    step: block.numbered && !block.text.endsWith("?"),
  }));
}

// Only ".", "?", and "!" end a sentence; a colon introduces a list or a
// label, so it does not.
function sentencesOf(text) {
  return text
    .replace(ABBREVIATIONS, (m) => m.replace(/\./g, "\u0000"))
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.replace(/\u0000/g, "."))
    .filter(Boolean);
}

// Returns one finding per rule broken, with the sentence or block that broke
// it. `allow` lists patterns for passive sentences whose doer is unknown.
function proseFindings(markdown, { allow = [] } = {}) {
  const findings = [];
  const add = (rule, text) => findings.push({ rule, text });
  for (const block of proseBlocks(markdown)) {
    const sentences = sentencesOf(block.text);
    if (block.step && (sentences.length > 1 || CHAINED.test(block.text))) {
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
