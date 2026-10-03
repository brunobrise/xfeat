// Extractors for references that can point at another repository in the
// selection: GitHub Actions, Terraform modules, protobuf packages, and the
// Backstage catalog descriptor a repository may already maintain.

function eachLine(text, visit) {
  String(text || "")
    .split("\n")
    .forEach((line, index) => visit(line, index + 1));
}

function unquote(value) {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function actionUses(text) {
  const refs = [];
  eachLine(text, (line, lineNumber) => {
    const match = /^\s*(?:-\s+)?uses:\s*(.+?)\s*(?:#.*)?$/.exec(line);
    if (!match) return;
    const value = unquote(match[1]);
    if (value.startsWith("./") || value.startsWith("docker://")) return;
    const ref = /^([\w.-]+)\/([\w.-]+)(?:\/[^@]*)?@/.exec(value);
    if (ref) refs.push({ ref: `${ref[1]}/${ref[2]}`, line: lineNumber });
  });
  return refs;
}

function remoteForReference(ref) {
  return `https://github.com/${ref}`;
}

function terraformSources(text) {
  const sources = [];
  eachLine(text, (line, lineNumber) => {
    const match = /^\s*source\s*=\s*"([^"]+)"/.exec(line);
    if (!match) return;
    let source = match[1].replace(/^git::/, "");
    source = source.split("?")[0].replace(/([^:])\/\/.*$/, "$1");
    if (/^(github\.com|gitlab\.com|bitbucket\.org)\//.test(source)) {
      source = `https://${source}`;
    }
    if (/^(https?|ssh):\/\//.test(source) || /^git@/.test(source)) {
      sources.push({ source, line: lineNumber });
    }
  });
  return sources;
}

function protoPackage(text) {
  let found = null;
  eachLine(text, (line, lineNumber) => {
    const match = /^\s*package\s+([\w.]+)\s*;/.exec(line);
    if (match && !found) found = { name: match[1], line: lineNumber };
  });
  return found;
}

const CATALOG_FIELDS = {
  metadata: ["name", "description"],
  spec: ["type", "lifecycle", "owner", "system"],
};

// Reads the first YAML document of catalog-info.yaml. Only flat scalar fields
// under `metadata` and `spec` are needed, so no YAML dependency is required.
function parseCatalogInfo(text) {
  const result = {};
  let section = "";
  const lines = String(text || "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^---\s*$/.test(line) && index > 0) break;
    const top = /^([A-Za-z]+):\s*$/.exec(line);
    if (top) {
      section = top[1];
      continue;
    }
    if (/^\S/.test(line)) {
      section = "";
      continue;
    }
    const field = /^ {2}([A-Za-z]+):\s*(\S.*)$/.exec(line);
    if (field && (CATALOG_FIELDS[section] || []).includes(field[1])) {
      result[field[1]] = { value: unquote(field[2]), line: index + 1 };
    }
  }
  return result;
}

module.exports = {
  actionUses,
  parseCatalogInfo,
  protoPackage,
  remoteForReference,
  terraformSources,
};
