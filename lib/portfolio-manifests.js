const path = require("path");
const { listRepoFiles, readText, toPosix } = require("./portfolio-files");
const {
  readCargoToml,
  readComposerJson,
  readGoMod,
  readPackageJson,
  readPyproject,
  readRequirements,
} = require("./portfolio-manifest-readers");

const MANIFEST_FILES = new Set([
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "composer.json",
]);

// Manifests under these folders describe fixtures, not repository modules.
const FIXTURE_DIR =
  /(^|\/)(test|tests|__tests__|fixtures|__fixtures__|testdata)\//;

function normalizePackageName(ecosystem, name) {
  const value = String(name || "").trim();
  if (ecosystem === "python")
    return value.toLowerCase().replace(/[-_.]+/g, "-");
  if (ecosystem === "cargo") return value.toLowerCase().replace(/_/g, "-");
  if (ecosystem === "go") return value;
  return value.toLowerCase();
}

const ECOSYSTEMS = {
  "package.json": "npm",
  "Cargo.toml": "cargo",
  "pyproject.toml": "python",
  "requirements.txt": "python",
  "go.mod": "go",
  "composer.json": "composer",
};

function invalidManifest(file) {
  return {
    ecosystem: ECOSYSTEMS[path.posix.basename(file)],
    invalid: true,
    parseErrors: 1,
    name: "",
    nameLine: 1,
    description: "",
    license: "",
    members: [],
    bins: [],
    scripts: [],
    dependencies: [],
  };
}

const READERS = {
  "package.json": readPackageJson,
  "Cargo.toml": readCargoToml,
  "pyproject.toml": readPyproject,
  "requirements.txt": readRequirements,
  "go.mod": readGoMod,
  "composer.json": readComposerJson,
};

function manifestDepth(file) {
  return file.split("/").length;
}

// Reads every supported manifest in a repository, root first, skipping
// fixtures. Each manifest keeps its file path and line numbers as evidence.
async function readRepoManifests(repoDir, files) {
  const repoFiles = files || (await listRepoFiles(repoDir));
  const manifestFiles = repoFiles
    .filter((file) => MANIFEST_FILES.has(path.posix.basename(file)))
    .filter((file) => !FIXTURE_DIR.test(file))
    .sort((a, b) => manifestDepth(a) - manifestDepth(b) || a.localeCompare(b));
  const manifests = [];
  for (const file of manifestFiles) {
    const text = await readText(path.join(repoDir, file));
    const parsed =
      READERS[path.posix.basename(file)](file, text) || invalidManifest(file);
    const dir = toPosix(path.posix.dirname(file));
    manifests.push({
      parseErrors: 0,
      ...parsed,
      file,
      dir,
      role: /(^|\/)examples?\//.test(file) ? "example" : "module",
    });
  }
  return manifests;
}

module.exports = {
  MANIFEST_FILES,
  normalizePackageName,
  readRepoManifests,
};
