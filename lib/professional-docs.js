const fs = require("fs/promises");
const path = require("path");
const fg = require("fast-glob");
const ignore = require("ignore");
const {
  renderOverview,
  renderComponent,
  renderOnboarding,
  renderHowTo,
  renderAdrIndex,
  renderReport,
} = require("./professional-docs-renderers");
const referenceRenderers = require("./professional-docs-reference-renderers");
const { extractSymbols, lineForIndex } = require("./professional-docs-symbols");
const { buildSemanticModel } = require("./professional-docs-semantics");
const { MANIFEST_FILES } = require("./portfolio-manifests");
const {
  isInside,
  projectedRealPath,
  realpathOrNull,
} = require("./portfolio-safe-fs");
const {
  OUTSIDE_REPOSITORY,
  createDocWriter,
  initProfessionalDocs,
  readPreviousStatus,
} = require("./professional-docs-writer");

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".php",
  ".sh",
  ".sql",
]);

const DEFAULT_IGNORE = [
  "node_modules/",
  ".git/",
  ".xfeat/",
  "dist/",
  "build/",
  "target/",
  "coverage/",
  "vendor/",
  "venv/",
  ".venv/",
  "__pycache__/",
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function loadIgnore(targetDir) {
  const ig = ignore().add(DEFAULT_IGNORE);
  const gitignore = await readIfExists(path.join(targetDir, ".gitignore"));
  const xfeatignore = await readIfExists(path.join(targetDir, ".xfeatignore"));
  if (gitignore) ig.add(gitignore);
  if (xfeatignore) ig.add(xfeatignore);
  return ig;
}

async function listFiles(targetDir, patterns) {
  const ig = await loadIgnore(targetDir);
  const files = await fg(patterns, {
    cwd: targetDir,
    absolute: false,
    dot: true,
    onlyFiles: true,
  });
  return files
    .map(normalizePath)
    .filter((file) => !ig.ignores(file))
    .sort();
}

async function listSourceFiles(targetDir) {
  const files = await listFiles(targetDir, ["**/*"]);
  return files.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)));
}

async function listMarkdownFiles(targetDir) {
  const files = await listFiles(targetDir, ["README.md", "docs/**/*.md"]);
  return files.filter((file) => file.endsWith(".md"));
}

function componentName(relativePath) {
  const dir = normalizePath(path.dirname(relativePath));
  return dir === "." ? "root" : dir.split("/")[0];
}

function safeDocName(name) {
  return name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "root";
}

async function collectSourceFacts(targetDir) {
  const files = await listSourceFiles(targetDir);
  const realRoot = await projectedRealPath(targetDir);
  const facts = [];
  for (const file of files) {
    // Never read through a link to a file or folder outside the repository.
    const real = await realpathOrNull(path.join(targetDir, file));
    if (!real || !isInside(real, realRoot)) continue;
    const text = await fs.readFile(real, "utf8");
    facts.push({
      file,
      component: componentName(file),
      lineCount: text.split("\n").length,
      symbols: extractSymbols(file, text),
      text,
    });
  }
  return facts;
}

function buildClaims(facts) {
  const claims = [];
  for (const fact of facts) {
    claims.push({
      id: `file:${fact.file}`,
      type: "file",
      text: `${fact.file} belongs to the ${
        fact.semanticComponent || fact.component
      } component.`,
      file: fact.file,
      line: 1,
    });
    for (const symbol of fact.symbols) {
      claims.push({
        id: `symbol:${fact.file}:${symbol.name}`,
        type: symbol.type,
        text: `${symbol.name} is a ${symbol.type} in ${fact.file}.`,
        file: fact.file,
        symbol: symbol.name,
        line: symbol.line,
      });
    }
  }
  return claims;
}

async function scanProfessionalDocs(targetDir = process.cwd()) {
  const writer = createDocWriter(targetDir);
  await initProfessionalDocs(targetDir, writer);
  const facts = await collectSourceFacts(targetDir);
  const semantic = await buildSemanticModel(targetDir, facts);
  const claims = buildClaims(facts);
  const pages = [
    ["docs/architecture/overview.md", renderOverview(facts, claims, semantic)],
    ["docs/onboarding.md", renderOnboarding(semantic)],
    ["docs/adr-index.md", renderAdrIndex(await listMarkdownFiles(targetDir))],
    [
      "docs/reference/claims.md",
      referenceRenderers.renderReferenceClaims(claims),
    ],
    ["docs/reference/files.md", referenceRenderers.renderReferenceFiles(facts)],
    [
      "docs/reference/import-graph.md",
      referenceRenderers.renderReferenceImportGraph(semantic.imports),
    ],
    [
      "docs/reference/symbols.md",
      referenceRenderers.renderReferenceSymbols(semantic.components),
    ],
    ...semantic.components.map((component) => [
      `docs/components/${safeDocName(component.slug)}.md`,
      renderComponent(component),
    ]),
    ...semantic.howTos.map((howTo) => [
      `docs/how-to/${safeDocName(howTo.slug)}.md`,
      renderHowTo(howTo),
    ]),
  ];
  for (const [docPath, body] of pages) await writer.write(docPath, body);

  const documents = writer.written();
  const status = {
    generatedAt: new Date().toISOString(),
    sourceFiles: facts.map((fact) => fact.file),
    documents,
    claims,
    semantic: {
      components: semantic.components.map((component) => component.name),
      howTos: semantic.howTos.map((howTo) => howTo.name),
    },
  };
  await writer.writeState(
    ".xfeat/status.json",
    JSON.stringify(status, null, 2),
  );
  await writer.write(
    "xfeat-report.md",
    renderReport(facts, claims, documents, semantic, writer.skipped()),
  );
  return {
    facts,
    claims,
    documents,
    skipped: writer.skipped(),
    semantic: status.semantic,
  };
}

function looksLikeCodeReference(token) {
  if (!/^[A-Za-z_$][\w$]*$/.test(token)) return false;
  if (token.length < 4) return false;
  if (
    new Set([
      "true",
      "false",
      "null",
      "docs",
      "scan",
      "audit",
      "verify",
      "xfeat",
    ]).has(token)
  ) {
    return false;
  }
  return /^[A-Z]/.test(token) || /[a-z][A-Z]/.test(token) || /[_$]/.test(token);
}

async function auditProfessionalDocs(targetDir = process.cwd(), options = {}) {
  const sourceFacts = await collectSourceFacts(targetDir);
  // Package names cited by generated pages are declared in manifests.
  const manifestFiles = await listFiles(
    targetDir,
    [...MANIFEST_FILES].map((name) => `**/${name}`),
  );
  const manifestTexts = await Promise.all(
    manifestFiles.map((file) => readIfExists(path.join(targetDir, file))),
  );
  const sourceText = [
    ...sourceFacts.map((fact) => fact.text),
    ...manifestTexts,
  ].join("\n");
  const markdownFiles = await listMarkdownFiles(targetDir);
  const staleReferences = [];
  const brokenLinks = [];

  for (const file of markdownFiles) {
    const absoluteFile = path.join(targetDir, file);
    const text = await fs.readFile(absoluteFile, "utf8");
    for (const match of text.matchAll(/`([^`\n]{3,120})`/g)) {
      const token = match[1].trim();
      if (looksLikeCodeReference(token) && !sourceText.includes(token)) {
        staleReferences.push({
          file,
          token,
          line: lineForIndex(text, match.index),
        });
      }
    }
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].trim();
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const cleanTarget = target.split("#")[0];
      if (!cleanTarget) continue;
      const resolved = path.resolve(path.dirname(absoluteFile), cleanTarget);
      if (!(await pathExists(resolved))) {
        brokenLinks.push({
          file,
          target,
          line: lineForIndex(text, match.index),
        });
      }
    }
  }

  return {
    ok: staleReferences.length === 0 && brokenLinks.length === 0,
    changedOnly: Boolean(options.changedOnly),
    markdownFiles,
    staleReferences,
    brokenLinks,
  };
}

async function verifyProfessionalDocs(targetDir = process.cwd()) {
  const findings = [];
  const status = await readPreviousStatus(targetDir);
  if (!status) {
    const exists = await pathExists(path.join(targetDir, ".xfeat/status.json"));
    const type = exists ? "invalid-status" : "missing-status";
    return { ok: false, findings: [{ type, path: ".xfeat/status.json" }] };
  }
  for (const doc of status.documents || []) {
    if (!(await pathExists(path.join(targetDir, doc)))) {
      findings.push({ type: "missing-document", path: doc });
    }
  }
  for (const claim of status.claims || []) {
    const sourcePath = path.join(targetDir, claim.file);
    if (!(await pathExists(sourcePath))) {
      findings.push({
        type: "missing-source",
        path: claim.file,
        claim: claim.id,
      });
    }
  }
  if (!Array.isArray(status.claims) || status.claims.length === 0) {
    findings.push({ type: "missing-claims", path: ".xfeat/status.json" });
  }
  return { ok: findings.length === 0, findings };
}

function commandTarget(args, fallback) {
  return path.resolve(
    args.find((arg) => !arg.startsWith("-")) || fallback || process.cwd(),
  );
}

async function runProfessionalCommand(args, io = {}) {
  const [command, ...rest] = args;
  const stdout =
    io.stdout || ((message) => process.stdout.write(`${message}\n`));
  const stderr =
    io.stderr || ((message) => process.stderr.write(`${message}\n`));
  const targetDir = commandTarget(rest, io.cwd);
  let result;

  if (command === "init") {
    result = await initProfessionalDocs(targetDir);
  } else if (command === "scan") {
    result = await scanProfessionalDocs(targetDir);
  } else if (command === "audit") {
    result = await auditProfessionalDocs(targetDir, {
      changedOnly: rest.includes("--changed"),
    });
  } else if (command === "verify") {
    result = await verifyProfessionalDocs(targetDir);
  } else if (command === "ci") {
    const audit = await auditProfessionalDocs(targetDir, {
      changedOnly: rest.includes("--changed"),
    });
    const verify = await verifyProfessionalDocs(targetDir);
    result = { audit, verify, exitCode: audit.ok && verify.ok ? 0 : 1 };
  } else {
    stderr(`Unknown professional documentation command: ${command}`);
    return { exitCode: 1 };
  }

  const skipped = result.skipped || [];
  // A path that resolves outside the repository means output is incomplete
  // for a reason the user must look at, so it fails the command.
  const refused = skipped.some((item) => item.reason === OUTSIDE_REPOSITORY);
  const exitCode = result.exitCode ?? (result.ok === false || refused ? 1 : 0);
  const output = { command, targetDir, exitCode, ...result };
  // Source text belongs in the repository, not in machine-readable output.
  if (result.facts) {
    output.facts = result.facts.map((fact) => ({
      file: fact.file,
      component: fact.semanticComponent || fact.component,
      lineCount: fact.lineCount,
      symbols: fact.symbols,
    }));
  }
  stdout(JSON.stringify(output, null, 2));
  if (skipped.length) {
    const list = skipped.map((item) => `${item.path} (${item.reason})`);
    const noun = skipped.length === 1 ? "path" : "paths";
    stderr(
      `xfeat ${command} skipped ${skipped.length} ${noun}: ${list.join(", ")}`,
    );
  }
  return output;
}

module.exports = {
  initProfessionalDocs,
  scanProfessionalDocs,
  auditProfessionalDocs,
  verifyProfessionalDocs,
  runProfessionalCommand,
};
