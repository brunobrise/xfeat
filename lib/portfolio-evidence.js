const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { readText } = require("./portfolio-files");

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
  async function text(file) {
    if (!file) return "";
    if (!cache.has(file))
      cache.set(file, await readText(path.join(repoDir, file)));
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
      hash: lineHash(lines[safeLine - 1]),
    };
  }
  return { text, cite };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function checkEvidence(repoDir, evidence) {
  const text = await readText(path.join(repoDir, evidence.file));
  if (!text && !(await exists(path.join(repoDir, evidence.file)))) {
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
