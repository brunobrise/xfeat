const path = require("path");
const { permalink } = require("./portfolio-git");
const { toPosix } = require("./portfolio-files");

const GENERATOR = "xfeat portfolio";

function frontmatter(type, title) {
  return [
    "---",
    `type: ${type}`,
    `title: ${yamlString(title)}`,
    `generator: ${GENERATOR}`,
    "---",
    "",
  ];
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function cell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function code(value) {
  return `\`${String(value).replace(/`/g, "'")}\``;
}

function table(headers, rows) {
  if (!rows.length) return [];
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
    "",
  ];
}

function firstSentence(text, limit = 140) {
  const value = String(text || "");
  const end = value.search(/\.(\s|$)/);
  const sentence = end > 0 ? value.slice(0, end + 1) : value;
  if (sentence.length <= limit) return sentence;
  return `${sentence.slice(0, sentence.lastIndexOf(" ", limit))}...`;
}

const CATEGORY_ORDER = ["setup", "build", "test", "lint", "run", "other"];

function sortCommands(commands) {
  return [...commands].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );
}

// Named systems sort alphabetically; repositories without one come last.
function systemNames(repos) {
  const names = [...new Set(repos.map((repo) => repo.systemName?.value || ""))];
  return names.sort((a, b) => (!a ? 1 : !b ? -1 : a < b ? -1 : 1));
}

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : "";
}

// Creates link builders bound to the output folder. Evidence links become
// commit permalinks when the cited file is tracked in a clean checkout with a
// known web host; otherwise they point at the local file relative to the page.
function createLinker(outDir, repos) {
  const bySlug = new Map(repos.map((repo) => [repo.slug, repo]));

  function evidenceUrl(evidence, pageDir) {
    const repo = bySlug.get(evidence.repo);
    if (!repo) return "";
    const file = repo.git.prefix
      ? `${repo.git.prefix}/${evidence.file}`
      : evidence.file;
    const remote =
      !repo.git.dirty && repo.tracked && repo.tracked.has(evidence.file)
        ? permalink(repo.git.remoteUrl, repo.git.head, file, evidence.line)
        : "";
    if (remote) return remote;
    const from = path.join(outDir, pageDir);
    const target = path.join(repo.path, evidence.file);
    return `${toPosix(path.relative(from, target))}#L${evidence.line}`;
  }

  function evidence(evidenceItem, pageDir) {
    if (!evidenceItem) return "";
    const label = `${evidenceItem.repo}:${evidenceItem.file}:${evidenceItem.line}`;
    return `[${code(label)}](${evidenceUrl(evidenceItem, pageDir)})`;
  }

  function file(slug, relativeFile, pageDir) {
    const url = evidenceUrl(
      { repo: slug, file: relativeFile, line: 1 },
      pageDir,
    );
    return `[${code(relativeFile)}](${url.replace(/#L1$/, "")})`;
  }

  function page(target, pageDir) {
    return toPosix(
      path.relative(path.join(outDir, pageDir), path.join(outDir, target)),
    );
  }

  return { bySlug, evidence, evidenceUrl, file, page };
}

module.exports = {
  GENERATOR,
  cell,
  code,
  createLinker,
  firstSentence,
  frontmatter,
  shortSha,
  sortCommands,
  systemNames,
  table,
};
