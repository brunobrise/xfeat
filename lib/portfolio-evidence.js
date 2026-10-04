const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const { MAX_EVIDENCE_BYTES, readText } = require("./portfolio-files");
const { pathExists } = require("./portfolio-util");

function lineHash(text) {
  return crypto
    .createHash("sha256")
    .update(String(text || "").trim())
    .digest("hex")
    .slice(0, 16);
}

// Caches file text per repository so every claim records the hash of the exact
// line it cites. Hashes let `verify` tell moved lines from changed ones.
function evidenceReader(repoDir, slug) {
  const cache = new Map();
  const oversized = new Set();
  async function text(file) {
    if (!file) return "";
    if (!cache.has(file)) {
      const absolute = path.join(repoDir, file);
      const body = await readText(absolute);
      if (!body && (await tooLarge(absolute))) oversized.add(file);
      cache.set(file, body);
    }
    return cache.get(file);
  }
  async function cite(file, line = 1) {
    const lines = (await text(file)).split("\n");
    const safeLine = Math.min(
      Math.max(1, line || 1),
      Math.max(1, lines.length),
    );
    return {
      repo: slug,
      file,
      line: safeLine,
      // Files above the size limit are never read, so their lines cannot be
      // hashed or verified later.
      hash: oversized.has(file) ? null : lineHash(lines[safeLine - 1]),
    };
  }
  return { text, cite };
}

async function tooLarge(absolute) {
  try {
    return (await fs.stat(absolute)).size > MAX_EVIDENCE_BYTES;
  } catch {
    return false;
  }
}

async function checkEvidence(repoDir, evidence) {
  if (evidence.hash === null) return { state: "unverifiable" };
  const text = await readText(path.join(repoDir, evidence.file));
  if (!text && !(await pathExists(path.join(repoDir, evidence.file)))) {
    return { state: "missing" };
  }
  const lines = text.split("\n");
  if (lineHash(lines[evidence.line - 1]) === evidence.hash) {
    return { state: "fresh" };
  }
  const moved = lines.findIndex((line) => lineHash(line) === evidence.hash);
  if (moved >= 0) return { state: "moved", line: moved + 1 };
  return { state: "changed" };
}

module.exports = { checkEvidence, evidenceReader, lineHash };
