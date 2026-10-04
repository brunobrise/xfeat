const fs = require("fs/promises");
const path = require("path");
const ignore = require("ignore");
const { toPosix } = require("./portfolio-files");
const { sha256 } = require("./portfolio-util");

const DEFAULT_OUTPUT = "xfeat-portfolio";
const REPO_TEXT_FIELDS = [
  "name",
  "description",
  "system",
  "owner",
  "lifecycle",
  "notes",
];

async function statOrNull(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

function slugify(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/^@/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "repo"
  );
}

function matcher(patterns) {
  return patterns && patterns.length ? ignore().add(patterns) : null;
}

// Finds immediate child folders of `fromDir` that are git repositories
// (a `.git` folder, or a `.git` file for worktrees and submodules).
async function discoverRepos(fromDir, options = {}) {
  const include = matcher(options.include);
  const exclude = matcher(options.exclude);
  const entries = await fs.readdir(fromDir, { withFileTypes: true });
  const repos = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (include && !include.ignores(entry.name)) continue;
    if (exclude && exclude.ignores(entry.name)) continue;
    const dir = path.join(fromDir, entry.name);
    if (await statOrNull(path.join(dir, ".git"))) repos.push(dir);
  }
  return repos.sort();
}

function validateManifest(data, manifestPath) {
  const problems = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    problems.push("root must be an object");
  } else {
    if (!Array.isArray(data.repos)) problems.push("repos must be an array");
    for (const key of ["name", "description", "output"]) {
      if (data[key] !== undefined && typeof data[key] !== "string") {
        problems.push(`${key} must be a string`);
      }
    }
    (data.repos || []).forEach((repo, index) => {
      if (!repo || typeof repo.path !== "string") {
        problems.push(`repos[${index}].path must be a string`);
      }
      for (const key of REPO_TEXT_FIELDS) {
        if (repo && repo[key] !== undefined && typeof repo[key] !== "string") {
          problems.push(`repos[${index}].${key} must be a string`);
        }
      }
      if (repo && repo.tags !== undefined && !Array.isArray(repo.tags)) {
        problems.push(`repos[${index}].tags must be an array`);
      }
    });
  }
  if (problems.length) {
    throw new Error(
      `Invalid portfolio manifest ${manifestPath}: ${problems.join("; ")}`,
    );
  }
}

async function readManifest(manifestPath) {
  let data;
  let text = "";
  try {
    text = await fs.readFile(manifestPath, "utf8");
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid portfolio manifest ${manifestPath}: ${error.message}`,
    );
  }
  validateManifest(data, manifestPath);
  // The hash lets `verify` notice owners or systems edited after a scan.
  return { data, hash: sha256(text) };
}

function assignSlugs(repos) {
  const counts = new Map();
  for (const repo of repos) {
    const slug = slugify(repo.name);
    counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  const used = new Set();
  for (const repo of repos) {
    let slug = slugify(repo.name);
    if (counts.get(slug) > 1) {
      slug = slugify(`${path.basename(path.dirname(repo.path))}-${repo.name}`);
    }
    let unique = slug;
    for (let n = 2; used.has(unique); n += 1) unique = `${slug}-${n}`;
    used.add(unique);
    repo.slug = unique;
  }
  return repos;
}

async function resolveRepo(entry, baseDir, manifestIndex) {
  const repoPath = path.resolve(baseDir, entry.path);
  const stat = await statOrNull(repoPath);
  if (!stat) throw new Error(`Repository path not found: ${repoPath}`);
  if (!stat.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repoPath}`);
  }
  const realPath = await fs.realpath(repoPath);
  return {
    name: entry.name || path.basename(realPath),
    path: realPath,
    owner: entry.owner || "",
    description: entry.description || "",
    system: entry.system || "",
    lifecycle: entry.lifecycle || "",
    notes: entry.notes || "",
    tags: entry.tags || [],
    manifestIndex,
  };
}

// Builds the repository selection from a manifest file, explicit paths, or a
// discovered parent folder. The selection is the reviewable contract for
// which repositories a portfolio scan may read; nothing outside it is read.
async function loadPortfolioSelection(options = {}) {
  const cwd = options.cwd || process.cwd();
  let manifest = { repos: [] };
  let manifestHash = "";
  let baseDir = cwd;
  let manifestPath = "";
  if (options.manifest) {
    manifestPath = path.resolve(cwd, options.manifest);
    const read = await readManifest(manifestPath);
    manifest = read.data;
    manifestHash = read.hash;
    baseDir = path.dirname(manifestPath);
  }
  const entries = manifest.repos.map((repo, index) => ({ ...repo, index }));
  for (const repoPath of options.paths || []) {
    entries.push({ path: path.resolve(cwd, repoPath), index: null });
  }
  if (options.from) {
    const discovered = await discoverRepos(path.resolve(cwd, options.from), {
      include: options.include,
      exclude: options.exclude,
    });
    for (const repoPath of discovered) {
      entries.push({ path: repoPath, index: null });
    }
  }

  const repos = [];
  const seen = new Set();
  for (const entry of entries) {
    const base = entry.index === null ? cwd : baseDir;
    const repo = await resolveRepo(entry, base, entry.index);
    if (seen.has(repo.path)) continue;
    seen.add(repo.path);
    repos.push(repo);
  }
  if (!repos.length) {
    throw new Error(
      "No repositories selected. Pass repository paths, --from <dir>, or --manifest <file>.",
    );
  }

  const output = options.out || manifest.output || DEFAULT_OUTPUT;
  return {
    name: manifest.name || options.name || "Repository Portfolio",
    description: manifest.description || "",
    manifestPath,
    manifestHash,
    outDir: path.resolve(options.out ? cwd : baseDir, output),
    repos: assignSlugs(repos),
  };
}

async function writePortfolioManifest(manifestPath, repoPaths, options = {}) {
  if (await statOrNull(manifestPath)) {
    return { created: false, manifestPath };
  }
  const baseDir = path.dirname(manifestPath);
  const body = {
    name: options.name || "Repository Portfolio",
    description: options.description || "",
    output: options.output || DEFAULT_OUTPUT,
    repos: repoPaths.map((repoPath) => ({
      path: toPosix(path.relative(baseDir, repoPath)) || ".",
    })),
  };
  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(body, null, 2)}\n`);
  return { created: true, manifestPath, repos: body.repos.length };
}

module.exports = {
  DEFAULT_OUTPUT,
  discoverRepos,
  loadPortfolioSelection,
  slugify,
  writePortfolioManifest,
};
