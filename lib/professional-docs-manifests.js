const path = require("path");
const { listRepoFiles, readText } = require("./portfolio-files");
const {
  normalizePackageName,
  readRepoManifests,
} = require("./portfolio-manifests");
const { parseToml } = require("./portfolio-toml");
const { lineForIndex } = require("./professional-docs-symbols");

// Adapts the shared portfolio manifest readers to the single-repository scan:
// one primary manifest per folder, workspace membership, and source
// entrypoints per ecosystem.

const LABELS = {
  npm: "npm",
  cargo: "Cargo",
  python: "Python",
  go: "Go",
  composer: "Composer",
};

function joinDir(dir, entry) {
  return path.posix.normalize(path.posix.join(dir, entry));
}

function globToRegExp(glob) {
  const source = glob
    .replace(/\/+$/, "")
    .split("**")
    .map((part) =>
      part
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]"),
    )
    .join(".*");
  return new RegExp(`^${source}$`);
}

function npmEntrypoints(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const entries = new Set();
  const add = (value) => {
    if (typeof value === "string") {
      const entry = value.replace(/^\.\//, "");
      entries.add(entry);
      if (entry.startsWith("dist/")) {
        entries.add(entry.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"));
        entries.add(entry.replace(/^dist\//, "src/"));
      }
    }
    if (value && typeof value === "object") Object.values(value).forEach(add);
  };
  add(data.main);
  add(data.exports);
  add(data.bin);
  return [...entries];
}

function entrypoints(manifest, text) {
  if (manifest.ecosystem === "npm") return npmEntrypoints(text);
  if (manifest.ecosystem === "cargo") {
    return [
      "src/lib.rs",
      "src/main.rs",
      ...manifest.bins.map((bin) => bin.path).filter(Boolean),
    ];
  }
  if (manifest.ecosystem === "python" && manifest.name) {
    const module = manifest.name.toLowerCase().replace(/[-.]+/g, "_");
    return [
      `src/${module}/__init__.py`,
      `${module}/__init__.py`,
      `src/${module}.py`,
      `${module}.py`,
    ];
  }
  if (manifest.ecosystem === "go" && manifest.name) {
    const parts = manifest.name.split("/");
    // Major-version suffixes (github.com/acme/tool/v2) are not package names.
    const versioned = parts.length > 1 && /^v\d+$/.test(parts.at(-1));
    const last = versioned ? parts.at(-2) : parts.at(-1);
    return ["main.go", `${last}.go`];
  }
  return [];
}

function cargoExcludes(manifest, text) {
  if (manifest.ecosystem !== "cargo") return [];
  const exclude = parseToml(text).data.workspace?.exclude;
  return Array.isArray(exclude)
    ? exclude.filter((entry) => typeof entry === "string")
    : [];
}

function keyLine(text, pattern) {
  const index = text.search(pattern);
  return index >= 0 ? lineForIndex(text, index) : 1;
}

async function adapt(targetDir, manifest) {
  const text = ["npm", "cargo"].includes(manifest.ecosystem)
    ? await readText(path.join(targetDir, manifest.file))
    : "";
  const dir = manifest.dir;
  return {
    file: manifest.file,
    dir,
    ecosystem: manifest.ecosystem,
    label: LABELS[manifest.ecosystem] || manifest.ecosystem,
    name: manifest.name || "",
    // Unnamed manifests (a nested requirements.txt) use their folder path,
    // which is unique, rather than the last folder name, which is not.
    displayName: manifest.name || (dir === "." ? "root" : dir),
    nameLine: manifest.nameLine || 1,
    description: manifest.description || "",
    descriptionLine: manifest.descriptionLine || manifest.nameLine || 1,
    scripts: manifest.scripts || [],
    dependencies: manifest.dependencies || [],
    members: (manifest.members || []).filter(
      (member) => typeof member === "string",
    ),
    excludes: cargoExcludes(manifest, text),
    membersLine: keyLine(text, /^[ \t]*members[ \t]*=|"workspaces"[ \t]*:/m),
    // A Cargo.toml with [workspace] and no [package] declares members only.
    virtual:
      manifest.ecosystem === "cargo" &&
      !manifest.name &&
      /^[ \t]*\[workspace\]/m.test(text),
    entrypoints: entrypoints(manifest, text).map((entry) =>
      joinDir(dir, entry),
    ),
    member: false,
    memberNames: [],
  };
}

function markMembers(manifests) {
  for (const parent of manifests) {
    if (!parent.members.length) continue;
    const include = [];
    const exclude = [];
    for (const raw of parent.members) {
      const negated = raw.startsWith("!");
      const pattern = globToRegExp(joinDir(parent.dir, raw.replace(/^!/, "")));
      (negated ? exclude : include).push(pattern);
    }
    for (const raw of parent.excludes) {
      exclude.push(globToRegExp(joinDir(parent.dir, raw)));
    }
    const members = manifests.filter(
      (manifest) =>
        manifest !== parent &&
        manifest.owner &&
        include.some((re) => re.test(manifest.dir)) &&
        !exclude.some((re) => re.test(manifest.dir)),
    );
    for (const member of members) member.member = true;
    parent.memberNames = members.map((member) => member.displayName).sort();
  }
}

// Reads every supported manifest. Owners are the manifests that own source
// files: the first named manifest per folder, never a virtual workspace.
async function loadManifests(targetDir) {
  const files = await listRepoFiles(targetDir);
  const manifests = [];
  for (const manifest of await readRepoManifests(targetDir, files)) {
    manifests.push(await adapt(targetDir, manifest));
  }
  const byDir = new Map();
  for (const manifest of manifests) {
    const list = byDir.get(manifest.dir) || [];
    list.push(manifest);
    byDir.set(manifest.dir, list);
  }
  const primaries = [];
  for (const list of byDir.values()) {
    const primary = list.find((manifest) => manifest.name) || list[0];
    for (const manifest of list) {
      manifest.primary = manifest === primary;
      manifest.owner = manifest === primary && !manifest.virtual;
    }
    primaries.push([primary, list]);
  }
  // Two packages with one name (an npm and a Cargo "billing") stay apart.
  const owners = manifests.filter((manifest) => manifest.owner);
  for (const owner of owners) {
    const twins = owners.filter(
      (other) => other.displayName === owner.displayName,
    );
    if (twins.length > 1)
      owner.uniqueName = `${owner.displayName} (${owner.dir})`;
  }
  for (const owner of owners) {
    if (owner.uniqueName) owner.displayName = owner.uniqueName;
  }
  for (const [primary, list] of primaries) {
    for (const manifest of list) {
      manifest.componentName = primary.virtual ? "" : primary.displayName;
    }
  }
  markMembers(manifests);
  return manifests;
}

// Runtime dependencies between packages of the same ecosystem become flows.
function dependencyFlows(manifests) {
  const key = (ecosystem, name) =>
    `${ecosystem}:${normalizePackageName(ecosystem, name)}`;
  const targets = new Map(
    manifests
      .filter((manifest) => manifest.owner && manifest.name)
      .map((manifest) => [key(manifest.ecosystem, manifest.name), manifest]),
  );
  const flows = [];
  for (const manifest of manifests) {
    if (manifest.virtual || !manifest.componentName) continue;
    for (const dep of manifest.dependencies) {
      if (dep.kind !== "runtime") continue;
      const target = targets.get(key(manifest.ecosystem, dep.name));
      if (!target || target.displayName === manifest.componentName) continue;
      flows.push({
        from: manifest.file,
        to: target.file,
        spec: dep.name,
        line: dep.line || 1,
        fromComponent: manifest.componentName,
        toComponent: target.displayName,
        type: "dependency",
      });
    }
  }
  return flows;
}

function rootStatement(manifest) {
  const count = manifest.memberNames.length;
  const members = count
    ? ` with ${count} member${count === 1 ? "" : "s"}: ${manifest.memberNames.join(", ")}.`
    : " with no resolved members.";
  if (manifest.virtual) {
    return {
      text: `\`${manifest.file}\` declares a ${manifest.label} workspace${members}`,
      evidence: { file: manifest.file, line: manifest.membersLine },
    };
  }
  if (manifest.name) {
    const workspace = manifest.members.length
      ? ` It declares a workspace${members}`
      : "";
    return {
      text: `Package metadata identifies this repository as \`${manifest.name}\` (${manifest.label}).${workspace}`,
      evidence: { file: manifest.file, line: manifest.nameLine },
    };
  }
  const deps = manifest.dependencies.length;
  return {
    text: `\`${manifest.file}\` declares ${deps} ${manifest.label} dependenc${deps === 1 ? "y" : "ies"} without a package name.`,
    evidence: { file: manifest.file, line: 1 },
  };
}

// Overview statements about package metadata at the repository root.
function packageMetadataStatements(manifests) {
  // A secondary unnamed manifest, such as requirements.txt beside
  // pyproject.toml, adds nothing the primary statement does not say.
  const root = manifests.filter(
    (manifest) =>
      manifest.dir === "." &&
      (manifest.primary || manifest.name || manifest.virtual),
  );
  if (root.length) return root.map(rootStatement);
  if (manifests.length) {
    return [
      {
        text: `No root package metadata detected; ${manifests.length} package manifest${manifests.length === 1 ? "" : "s"} found in subfolders.`,
        evidence: null,
      },
    ];
  }
  return [{ text: "No package metadata detected.", evidence: null }];
}

module.exports = {
  dependencyFlows,
  globToRegExp,
  loadManifests,
  packageMetadataStatements,
};
