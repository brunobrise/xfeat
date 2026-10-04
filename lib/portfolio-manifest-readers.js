const path = require("path");
const { parseToml } = require("./portfolio-toml");
const { lineForIndex } = require("./portfolio-files");

// Per-format manifest readers. Each returns a normalized manifest with line
// numbers for names, scripts, bins, and dependencies, or null when the file
// cannot be parsed at all.

function jsonKeyLine(text, key, afterKey) {
  const start = afterKey ? Math.max(0, text.indexOf(`"${afterKey}"`)) : 0;
  return lineForIndex(text, text.indexOf(`"${key}"`, start));
}

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function npmSpecifier(spec) {
  const value = String(spec || "");
  const local = /^(?:file|link|portal):(.+)$/.exec(value);
  if (local) return { path: local[1] };
  if (/^(\.{1,2}\/|\/|~\/)/.test(value)) return { path: value };
  if (/^workspace:/.test(value)) return { workspace: true };
  const shorthand =
    /^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#.*)?$/.exec(value);
  if (shorthand && !/^[\d^~<>=*]/.test(value)) {
    return { git: `https://github.com/${shorthand[1]}/${shorthand[2]}` };
  }
  const git = /^(?:git\+)?((?:https?|ssh|git):\/\/[^#]+|git@[^#]+)/.exec(value);
  if (git && (/^git/.test(value) || /\.git(#|$)/.test(value))) {
    return { git: git[1] };
  }
  return {};
}

function readPackageJson(file, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data)) return null;
  const dependencies = [];
  const sections = [
    ["dependencies", "runtime"],
    ["peerDependencies", "runtime"],
    ["optionalDependencies", "runtime"],
    ["devDependencies", "dev"],
  ];
  for (const [section, kind] of sections) {
    const entries = isObject(data[section]) ? data[section] : {};
    for (const [name, spec] of Object.entries(entries)) {
      dependencies.push({
        name,
        kind,
        version: typeof spec === "string" ? spec : "",
        line: jsonKeyLine(text, name, section),
        ...npmSpecifier(spec),
      });
    }
  }
  // npm installs a string `bin` under the package name without its scope:
  // `@acme/fmt` becomes the program `fmt`.
  const bin =
    typeof data.bin === "string"
      ? { [String(data.name || "bin").replace(/^@[^/]+\//, "")]: data.bin }
      : isObject(data.bin)
        ? data.bin
        : {};
  const members = Array.isArray(data.workspaces)
    ? data.workspaces
    : data.workspaces?.packages || [];
  return {
    ecosystem: "npm",
    name: data.name || "",
    nameLine: jsonKeyLine(text, "name"),
    description: data.description || "",
    descriptionLine: jsonKeyLine(text, "description"),
    license: typeof data.license === "string" ? data.license : "",
    members,
    bins: Object.entries(bin || {}).map(([name, binPath]) => ({
      name,
      path: binPath,
      line: jsonKeyLine(text, "bin"),
    })),
    scripts: Object.entries(isObject(data.scripts) ? data.scripts : {}).map(
      ([name, command]) => ({
        name,
        command,
        line: jsonKeyLine(text, name, "scripts"),
      }),
    ),
    dependencies,
  };
}

function cargoDependencies(table, prefix, lines, kind) {
  return Object.entries(table || {}).map(([name, spec]) => ({
    name: (spec && spec.package) || name,
    kind,
    version: typeof spec === "string" ? spec : (spec && spec.version) || "",
    line: lines.get(`${prefix}.${name}`) || 1,
    ...(spec && spec.path ? { path: spec.path } : {}),
    ...(spec && spec.git ? { git: spec.git } : {}),
    ...(spec && spec.workspace ? { workspace: true } : {}),
  }));
}

function readCargoToml(file, text) {
  const { data, lines, errors } = parseToml(text);
  const pkg = data.package || {};
  const dependencies = [
    ...cargoDependencies(data.dependencies, "dependencies", lines, "runtime"),
    ...cargoDependencies(
      data["build-dependencies"],
      "build-dependencies",
      lines,
      "build",
    ),
    ...cargoDependencies(
      data["dev-dependencies"],
      "dev-dependencies",
      lines,
      "dev",
    ),
    ...cargoDependencies(
      data.workspace?.dependencies,
      "workspace.dependencies",
      lines,
      "runtime",
    ),
  ];
  return {
    ecosystem: "cargo",
    parseErrors: errors.length,
    name: typeof pkg.name === "string" ? pkg.name : "",
    nameLine: lines.get("package.name") || 1,
    description: typeof pkg.description === "string" ? pkg.description : "",
    descriptionLine: lines.get("package.description") || 1,
    license: typeof pkg.license === "string" ? pkg.license : "",
    members: data.workspace?.members || [],
    bins: (data.bin || []).map((bin, index) => ({
      name: bin.name || pkg.name || "",
      path: bin.path || "",
      line: lines.get(`bin.${index}`) || 1,
    })),
    scripts: [],
    dependencies,
  };
}

function pep508(value, line, kind) {
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(
    value,
  );
  if (!match) return null;
  const direct = /^@\s*(\S+)/.exec(match[3]);
  const version = direct ? "" : match[3].split(";")[0].trim();
  const dep = { name: match[1], kind, version, line };
  if (direct && /^git\+/.test(direct[1])) {
    dep.git = direct[1].replace(/^git\+/, "").replace(/@[^/]*$/, "");
  }
  if (direct && /^file:/.test(direct[1])) {
    dep.path = direct[1].replace(/^file:(\/\/)?/, "");
  }
  return dep;
}

function readPyproject(file, text) {
  const { data, lines, errors } = parseToml(text);
  const project = data.project || {};
  const poetry = data.tool?.poetry || {};
  const depsLine = lines.get("project.dependencies") || 1;
  const depsOffset = text
    .split("\n")
    .slice(0, depsLine - 1)
    .join("\n").length;
  // Each requirement cites its own line inside a multi-line array.
  const lineOf = (value) => {
    const index = text.indexOf(JSON.stringify(String(value)), depsOffset);
    return index >= 0 ? lineForIndex(text, index) : depsLine;
  };
  const requirements = Array.isArray(project.dependencies)
    ? project.dependencies.filter((value) => typeof value === "string")
    : [];
  const dependencies = requirements
    .map((value) => pep508(value, lineOf(value), "runtime"))
    .filter(Boolean);
  for (const [name, spec] of Object.entries(poetry.dependencies || {})) {
    if (name === "python") continue;
    dependencies.push({
      name,
      kind: "runtime",
      version: typeof spec === "string" ? spec : (spec && spec.version) || "",
      line: lines.get(`tool.poetry.dependencies.${name}`) || 1,
      ...(spec && spec.path ? { path: spec.path } : {}),
      ...(spec && spec.git ? { git: spec.git } : {}),
    });
  }
  const scripts = { ...(poetry.scripts || {}), ...(project.scripts || {}) };
  const license = project.license?.text || project.license || poetry.license;
  return {
    ecosystem: "python",
    parseErrors: errors.length,
    name: project.name || poetry.name || "",
    nameLine: lines.get("project.name") || lines.get("tool.poetry.name") || 1,
    description: project.description || poetry.description || "",
    descriptionLine:
      lines.get("project.description") ||
      lines.get("tool.poetry.description") ||
      1,
    license: typeof license === "string" ? license : "",
    members: [],
    bins: [],
    scripts: Object.entries(scripts).map(([name, command]) => ({
      name,
      command: String(command),
      line:
        lines.get(`project.scripts.${name}`) ||
        lines.get(`tool.poetry.scripts.${name}`) ||
        1,
    })),
    dependencies,
  };
}

function readRequirements(file, text) {
  const dependencies = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) return;
    const editable = /^(?:-e|--editable)\s+(\S+)/.exec(line);
    const target = editable ? editable[1] : line;
    if (/^-/.test(target)) return;
    const git = /^git\+(\S+?)(?:@[^#]*)?(?:#egg=([\w.-]+))?$/.exec(target);
    if (git) {
      dependencies.push({
        name: git[2] || path.basename(git[1], ".git"),
        kind: "runtime",
        line: index + 1,
        git: git[1],
      });
    } else if (/^(\.{1,2}\/|\/)/.test(target)) {
      if (target === "." || target === "./") return;
      dependencies.push({
        name: path.basename(target),
        kind: "runtime",
        line: index + 1,
        path: target,
      });
    } else {
      const dep = pep508(target, index + 1, "runtime");
      if (dep) dependencies.push(dep);
    }
  });
  return {
    ecosystem: "python",
    name: "",
    nameLine: 1,
    description: "",
    license: "",
    members: [],
    bins: [],
    scripts: [],
    dependencies,
  };
}

function readGoMod(file, text) {
  const lines = text.split("\n");
  const moduleIndex = lines.findIndex((line) => /^module\s+/.test(line));
  const dependencies = [];
  const replaces = new Map();
  let inRequire = false;
  lines.forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(line)) inRequire = true;
    else if (inRequire && line === ")") inRequire = false;
    const single = /^require\s+(\S+)\s+(\S+)/.exec(line);
    const block = inRequire && /^(\S+)\s+(v\S+)/.exec(line);
    const match = single || block;
    if (match) {
      dependencies.push({
        name: match[1],
        kind: "runtime",
        version: match[2],
        line: index + 1,
      });
    }
    const replace = /^replace\s+(\S+)(?:\s+\S+)?\s+=>\s+(\S+)/.exec(line);
    if (replace) replaces.set(replace[1], replace[2]);
  });
  for (const dep of dependencies) {
    const target = replaces.get(dep.name);
    if (target && /^(\.{1,2}\/|\/)/.test(target)) dep.path = target;
  }
  return {
    ecosystem: "go",
    name: moduleIndex >= 0 ? lines[moduleIndex].split(/\s+/)[1] : "",
    nameLine: moduleIndex + 1 || 1,
    description: "",
    license: "",
    members: [],
    bins: [],
    scripts: [],
    dependencies,
  };
}

function readComposerJson(file, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const dependencies = [];
  for (const [section, kind] of [
    ["require", "runtime"],
    ["require-dev", "dev"],
  ]) {
    for (const [name, version] of Object.entries(data[section] || {})) {
      if (name === "php" || name.startsWith("ext-")) continue;
      dependencies.push({
        name,
        kind,
        version: String(version),
        line: jsonKeyLine(text, name, section),
      });
    }
  }
  return {
    ecosystem: "composer",
    name: data.name || "",
    nameLine: jsonKeyLine(text, "name"),
    description: data.description || "",
    descriptionLine: jsonKeyLine(text, "description"),
    license: typeof data.license === "string" ? data.license : "",
    members: [],
    bins: []
      .concat(data.bin || [])
      .filter((bin) => typeof bin === "string")
      .map((bin) => ({
        name: path.basename(bin),
        path: bin,
        line: jsonKeyLine(text, "bin"),
      })),
    scripts: Object.keys(data.scripts || {}).map((name) => ({
      name,
      command: `composer run ${name}`,
      line: jsonKeyLine(text, name, "scripts"),
    })),
    dependencies,
  };
}

module.exports = {
  readCargoToml,
  readComposerJson,
  readGoMod,
  readPackageJson,
  readPyproject,
  readRequirements,
};
