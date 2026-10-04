const fs = require("fs/promises");
const path = require("path");
const fg = require("fast-glob");
const ignore = require("ignore");

// Directories that never describe a repository's own source: dependencies,
// build output, caches, and virtual environments across ecosystems.
const PORTFOLIO_IGNORE = [
  ".git/",
  ".xfeat/",
  "node_modules/",
  "bower_components/",
  "target/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  "vendor/",
  "venv/",
  ".venv/",
  "__pycache__/",
  ".next/",
  ".nuxt/",
  ".turbo/",
  ".cache/",
  ".gradle/",
  ".idea/",
  ".env",
  ".env.*",
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

const MAX_EVIDENCE_BYTES = 1024 * 1024;

async function readText(filePath, maxBytes = MAX_EVIDENCE_BYTES) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return "";
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function repoIgnore(repoDir, extra = []) {
  const ig = ignore().add(PORTFOLIO_IGNORE).add(extra);
  for (const file of [".gitignore", ".xfeatignore"]) {
    const text = await readText(path.join(repoDir, file));
    if (text) ig.add(text);
  }
  return ig;
}

// Lists repository files relative to repoDir, honoring .gitignore and
// .xfeatignore. Never follows symlinks so a selection cannot escape its repo.
async function listRepoFiles(repoDir, options = {}) {
  const ig = await repoIgnore(repoDir, options.exclude || []);
  const files = await fg(["**/*"], {
    cwd: repoDir,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/target/**"],
  });
  return files
    .map(toPosix)
    .filter((file) => !ig.ignores(file))
    .sort();
}

function lineForIndex(text, index) {
  if (index < 0) return 1;
  return text.slice(0, index).split("\n").length;
}

module.exports = {
  MAX_EVIDENCE_BYTES,
  PORTFOLIO_IGNORE,
  listRepoFiles,
  lineForIndex,
  readText,
  toPosix,
};
