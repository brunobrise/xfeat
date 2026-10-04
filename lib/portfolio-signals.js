const path = require("path");

const LANGUAGES = {
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".py": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".hpp": "C++",
  ".scala": "Scala",
  ".dart": "Dart",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".sh": "Shell",
  ".sql": "SQL",
  ".vue": "Vue",
  ".svelte": "Svelte",
};

const SUMMARY_LIMIT = 320;

function languageFor(file) {
  return LANGUAGES[path.extname(file).toLowerCase()] || "";
}

function cleanInline(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function capSummary(text) {
  if (text.length <= SUMMARY_LIMIT) return text;
  const head = text.slice(0, SUMMARY_LIMIT);
  const sentenceEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"));
  if (sentenceEnd > 40) return head.slice(0, sentenceEnd + 1);
  return `${head.slice(0, head.lastIndexOf(" "))}...`;
}

function isProseStart(line) {
  return !/^(#|<|>|!|\[!\[|\||[-*+]\s|\d+\.\s|```|~~~|-{3,}$|={3,}$)/.test(
    line,
  );
}

// Returns the README title and its first prose paragraph. Wrapped lines are
// joined so summaries are never cut mid-sentence by hard line breaks.
function readmeSummary(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  let title = "";
  let titleLine = 1;
  let inFence = false;
  let start = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) + 1 : 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    if (!title && /^#\s+/.test(line)) {
      title = cleanInline(line.replace(/^#\s+/, ""));
      titleLine = index + 1;
      continue;
    }
    if (!line || !isProseStart(line)) continue;
    const paragraph = [];
    for (let end = index; end < lines.length && lines[end].trim(); end += 1) {
      paragraph.push(lines[end].trim());
    }
    const summary = cleanInline(paragraph.join(" "));
    if (summary.length < 12) {
      start = index;
      continue;
    }
    return { title, titleLine, summary: capSummary(summary), line: index + 1 };
  }
  return { title, titleLine, summary: "", line: 1 };
}

const CATCH_ALL = new Set(["*", "**", "/", "/*", "/**"]);

function parseCodeowners(text) {
  let defaultOwners = [];
  let line = 1;
  let rules = 0;
  String(text || "")
    .split("\n")
    .forEach((raw, index) => {
      const content = raw.replace(/\s#.*$/, "").trim();
      if (!content || content.startsWith("#")) return;
      rules += 1;
      const [pattern, ...owners] = content.split(/\s+/);
      if (CATCH_ALL.has(pattern) && owners.length) {
        defaultOwners = owners;
        line = index + 1;
      }
    });
  return { defaultOwners, line, rules };
}

function uniqueByName(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function makeTargets(text) {
  const targets = [];
  String(text || "")
    .split("\n")
    .forEach((line, index) => {
      const match = /^([A-Za-z0-9][\w./-]*)\s*:(?![=:])/.exec(line);
      if (match) targets.push({ name: match[1], line: index + 1 });
    });
  return uniqueByName(targets);
}

function justRecipes(text) {
  const recipes = [];
  String(text || "")
    .split("\n")
    .forEach((line, index) => {
      if (/^(set|alias|export|import|mod)\s/.test(line)) return;
      const match = /^@?([A-Za-z0-9_-]+)(?:\s+[^:]*)?:(?!=)/.exec(line);
      if (match) recipes.push({ name: match[1], line: index + 1 });
    });
  return uniqueByName(recipes);
}

function composeServices(text) {
  const lines = String(text || "").split("\n");
  const start = lines.findIndex((line) => /^services:\s*$/.test(line));
  if (start < 0) return [];
  const services = [];
  let indent = null;
  let current = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line)) break;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const depth = line.length - line.trimStart().length;
    if (indent === null) indent = depth;
    const key = /^\s*([\w.-]+):\s*(.*)$/.exec(line);
    if (depth === indent && key) {
      current = { name: key[1], line: index + 1, image: "", build: "" };
      services.push(current);
    } else if (current && key && depth > indent) {
      if (key[1] === "image") current.image = key[2].trim();
      if (key[1] === "build" && key[2].trim()) current.build = key[2].trim();
      if (key[1] === "context" && !current.build) {
        current.build = key[2].trim();
      }
    }
  }
  return services;
}

const RULES = {
  ci: (file) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file) ||
    /^(\.gitlab-ci\.yml|\.circleci\/config\.yml|Jenkinsfile|azure-pipelines\.yml|bitbucket-pipelines\.yml|\.buildkite\/[^/]+)$/.test(
      file,
    ),
  agentContext: (file) =>
    /(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$/.test(file) ||
    /^(llms(-full)?\.txt|\.cursorrules|\.windsurfrules|\.github\/copilot-instructions\.md|\.cursor\/rules\/.+)$/.test(
      file,
    ),
  deploy: (file) =>
    /^([^/]+\/)?(Dockerfile(\.[\w-]+)?|[\w-]+\.dockerfile|(docker-)?compose(\.[\w-]+)?\.ya?ml|docker-compose(\.[\w-]+)?\.ya?ml|fly\.toml|vercel\.json|netlify\.toml|render\.yaml|Procfile|app\.yaml|serverless\.ya?ml|wrangler\.toml|railway\.json)$/.test(
      file,
    ) || /(^|\/)(Chart\.yaml|kustomization\.ya?ml)$/.test(file),
  adrs: (file) =>
    /\.md$/i.test(file) &&
    (/(^|\/)(adr|adrs|decisions|architecture-decisions)\//i.test(file) ||
      /(^|\/)adr[-_]?\d+/i.test(file)),
  docs: (file) => /^docs?\/.+\.(md|mdx|rst)$/i.test(file),
  tests: (file) =>
    /(^|\/)(__tests__|tests?|spec)\/.+\.\w+$/.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /(_test\.(go|py)|_spec\.rb|Tests?\.(java|cs|kt))$/.test(file) ||
    /(^|\/)test_[^/]+\.py$/.test(file),
  entrypoints: (file) =>
    file.split("/").length <= 4 &&
    (/(^|\/)src\/main\.(rs|ts|js|py|go)$/.test(file) ||
      /(^|\/)src\/bin\/[^/]+\.rs$/.test(file) ||
      /^(cmd\/[^/]+\/)?main\.go$/.test(file) ||
      /(^|\/)__main__\.py$/.test(file) ||
      /^(manage|main|app)\.py$/.test(file) ||
      /^(src\/)?(index|server|main)\.[cm]?[jt]s$/.test(file)),
};

function contractKind(file) {
  if (/(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/i.test(file)) {
    return "openapi";
  }
  if (/(^|\/)asyncapi[^/]*\.(ya?ml|json)$/i.test(file)) return "asyncapi";
  if (/\.proto$/.test(file)) return "protobuf";
  if (/\.(graphql|gql)$/.test(file)) return "graphql";
  return "";
}

// Groups repository files into documentation-relevant signals. Output lists are
// sorted by code unit order so generated docs are stable across locales.
function classifyFiles(files) {
  const sorted = [...files].sort();
  const groups = Object.fromEntries(
    Object.keys(RULES).map((key) => [key, sorted.filter(RULES[key])]),
  );
  groups.contracts = sorted
    .map((file) => ({ kind: contractKind(file), file }))
    .filter((item) => item.kind);
  return groups;
}

module.exports = {
  classifyFiles,
  composeServices,
  justRecipes,
  languageFor,
  makeTargets,
  parseCodeowners,
  readmeSummary,
};
