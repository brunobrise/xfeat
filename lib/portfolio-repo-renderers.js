const { code, frontmatter, sortCommands, table } = require("./portfolio-links");
const { integrationPath, verifiedAt } = require("./portfolio-renderers");
const { byText } = require("./portfolio-util");

const MAX_SHARED_DEPENDENCIES = 100;
const REPO_DIR = "repos";
const INTEGRATION_DIR = "integrations";

function sourceCell(item, links, pageDir) {
  if (!item) return "";
  if (item.label === "manifest") return "portfolio manifest";
  const link = links.evidence(item.evidence, pageDir);
  return item.label === "derived" ? `derived ${link}`.trim() : link;
}

function section(title, lines) {
  return lines.length ? [`## ${title}`, "", ...lines] : [];
}

function factRows(repo, links) {
  const rows = [];
  const add = (field, item, value) => {
    if (item)
      rows.push([
        field,
        value ?? item.value,
        sourceCell(item, links, REPO_DIR),
      ]);
  };
  add("Owner", repo.ownership);
  add(
    "Status",
    repo.status,
    repo.status.reason
      ? `${repo.status.value}: ${repo.status.reason}`
      : repo.status.value,
  );
  add("System", repo.systemName);
  if (repo.git.remoteUrl)
    rows.push(["Repository", repo.git.remoteUrl, "git remote"]);
  if (repo.git.isRepo) {
    rows.push([
      "Verified at",
      `${verifiedAt(repo)} on ${code(repo.git.branch)}`,
      "git",
    ]);
  }
  if (repo.languages.length) {
    rows.push([
      "Languages",
      repo.languages.map((l) => `${l.name} (${l.files} files)`).join(", "),
      "file scan",
    ]);
  }
  rows.push(["Test files", String(repo.tests), "file scan"]);
  if (repo.license)
    rows.push([
      "License",
      code(repo.license.file),
      links.evidence(repo.license.evidence, REPO_DIR),
    ]);
  return rows;
}

function namedManifests(repo) {
  return repo.manifests.filter((m) => !m.invalid && m.name);
}

function moduleRows(repo, links) {
  const modules = namedManifests(repo);
  if (modules.length < 2) return [];
  const described = modules.some((m) => m.description);
  return table(
    [
      "Name",
      "Ecosystem",
      "Path",
      "Role",
      ...(described ? ["Description"] : []),
      "Source",
    ],
    modules.map((m) => [
      code(m.name),
      m.ecosystem,
      code(m.dir),
      m.role,
      ...(described ? [m.description] : []),
      links.evidence(m.evidence, REPO_DIR),
    ]),
  );
}

function interfaceRows(repo, links) {
  // Workspaces list their packages under Modules; avoid repeating them here.
  const listPackages = namedManifests(repo).length < 2;
  const rows = [
    ...repo.bins.map((bin) => [
      "CLI",
      code(bin.name),
      bin.target ? code(bin.target) : "",
      links.evidence(bin.evidence, REPO_DIR),
    ]),
    ...repo.contracts.map((c) => [
      c.kind,
      code(c.package || c.file),
      code(c.file),
      links.evidence(c.evidence, REPO_DIR),
    ]),
    ...repo.manifests
      .filter((m) => !m.invalid && m.name && m.role === "module")
      .filter(() => listPackages)
      .map((m) => [
        `${m.ecosystem} package`,
        code(m.name),
        code(m.file),
        links.evidence(m.evidence, REPO_DIR),
      ]),
  ];
  return table(["Kind", "Name", "Location", "Source"], rows);
}

function edgeTable(edges, direction, links) {
  return table(
    ["Repository", "Kind", "Confidence", "Dependency", "Evidence"],
    edges.map((edge) => {
      const other = direction === "out" ? edge.to : edge.from;
      return [
        `[${other}](${other}.md)`,
        `[${edge.kind}](../${integrationPath(edge.from, edge.to)})`,
        edge.confidence,
        code(edge.dependency),
        links.evidence(edge.consumer, REPO_DIR),
      ];
    }),
  );
}

function documentationLines(repo, links) {
  const lines = [];
  if (repo.readme)
    lines.push(
      `- README: ${links.file(repo.slug, repo.readme.file, REPO_DIR)}`,
    );
  if (repo.docs.length)
    lines.push(`- ${repo.docs.length} Markdown files under ${code("docs/")}.`);
  for (const adr of repo.adrs)
    lines.push(`- Decision record: ${links.file(repo.slug, adr, REPO_DIR)}`);
  for (const file of repo.agentContext)
    lines.push(`- Agent context: ${links.file(repo.slug, file, REPO_DIR)}`);
  return lines.length ? [...lines, ""] : [];
}

function runtimeLines(repo, links) {
  return [
    ...repo.deploy.map(
      (file) =>
        `- Deployment descriptor: ${links.file(repo.slug, file, REPO_DIR)}`,
    ),
    ...repo.services.map((service) => {
      const detail = service.image
        ? `image ${code(service.image)}`
        : service.build
          ? `built from ${code(service.build)}`
          : "";
      return `- Compose service ${code(service.name)}${detail ? `, ${detail}` : ""}: ${links.evidence(service.evidence, REPO_DIR)}`;
    }),
  ].concat(repo.deploy.length || repo.services.length ? [""] : []);
}

function renderRepoPage(repo, model, links) {
  const out = model.graph.edges.filter((edge) => edge.from === repo.slug);
  const into = model.graph.edges.filter((edge) => edge.to === repo.slug);
  const purpose = repo.purpose
    ? [
        repo.purpose.value,
        "",
        `Source: ${sourceCell(repo.purpose, links, REPO_DIR)}`,
        "",
      ]
    : ["No README summary or description found. See [gaps](../gaps.md).", ""];
  return [
    ...frontmatter("repository", repo.slug),
    `# ${repo.slug}`,
    "",
    ...purpose,
    ...table(["Field", "Value", "Source"], factRows(repo, links)),
    ...section("Modules", moduleRows(repo, links)),
    ...section("Interfaces", interfaceRows(repo, links)),
    ...section(
      "Commands",
      table(
        ["Purpose", "Command", "Directory", "Declared in"],
        sortCommands(repo.commands).map((c) => [
          c.category,
          code(c.command),
          code(c.cwd),
          `${c.source} ${links.evidence(c.evidence, REPO_DIR)}`,
        ]),
      ),
    ),
    ...section("Depends On", edgeTable(out, "out", links)),
    ...section("Used By", edgeTable(into, "in", links)),
    ...section("Runtime And Deployment", runtimeLines(repo, links)),
    ...section("Documentation", documentationLines(repo, links)),
    ...section(
      "Maintainer Note",
      repo.notes ? [repo.notes, "", "Source: portfolio manifest", ""] : [],
    ),
    ...section(
      "Gaps",
      repo.gaps
        .map((gap) => `- ${gap.code}: ${gap.message}`)
        .concat(repo.gaps.length ? [""] : []),
    ),
  ].join("\n");
}

function integrationPairs(model) {
  const pairs = new Map();
  for (const edge of model.graph.edges) {
    const file = integrationPath(edge.from, edge.to);
    if (!pairs.has(file)) pairs.set(file, []);
    pairs.get(file).push(edge);
  }
  return [...pairs.entries()].sort(([a], [b]) => byText(a, b));
}

function renderIntegration(file, edges, model, links) {
  const [a, b] = file
    .replace(`${INTEGRATION_DIR}/`, "")
    .replace(/\.md$/, "")
    .split("--");
  const contracts = model.graph.sharedContracts.filter(
    (c) => c.repos.includes(a) && c.repos.includes(b),
  );
  const nameMatch = edges.some((edge) => edge.confidence === "name-match");
  return [
    ...frontmatter("integration", `${a} and ${b}`),
    `# ${a} and ${b}`,
    "",
    `How [${a}](../repos/${a}.md) and [${b}](../repos/${b}.md) depend on each other, with evidence from both sides.`,
    "",
    ...table(
      [
        "Consumer",
        "Provider",
        "Kind",
        "Confidence",
        "Dependency",
        "Consumer evidence",
        "Provider evidence",
      ],
      edges.map((edge) => [
        edge.from,
        edge.to,
        edge.kind,
        edge.confidence,
        code(edge.dependency),
        links.evidence(edge.consumer, INTEGRATION_DIR),
        edge.provider
          ? links.evidence(edge.provider, INTEGRATION_DIR)
          : "matched by git remote",
      ]),
    ),
    ...(nameMatch
      ? [
          "Name match only: the dependency name equals a package this portfolio provides. Confirm the registry source; a public package with the same name would match too.",
          "",
        ]
      : []),
    ...section(
      "Shared Contracts",
      table(
        ["Kind", "Package", "Evidence"],
        contracts.map((c) => [
          c.kind,
          code(c.name),
          c.evidence.map((e) => links.evidence(e, INTEGRATION_DIR)).join(" "),
        ]),
      ),
    ),
  ].join("\n");
}

// Groups usages by declared version; each repository name links to the line
// that declares the dependency, so every usage keeps its evidence.
function versionGroups(usages, links) {
  const groups = new Map();
  for (const usage of usages) {
    const version = usage.version || "unspecified";
    if (!groups.has(version)) groups.set(version, []);
    groups.get(version).push(usage);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(
      ([version, items]) =>
        `${code(version)}: ${items
          .map((u) => `[${u.repo}](${links.evidenceUrl(u.evidence, ".")})`)
          .join(", ")}`,
    )
    .join("<br>");
}

function renderDependencies(model, links) {
  const shared = model.graph.sharedDependencies.slice(
    0,
    MAX_SHARED_DEPENDENCIES,
  );
  return [
    ...frontmatter("reference", "Dependencies"),
    "# Dependencies",
    "",
    `${model.graph.edges.length} dependencies between selected repositories are listed on the [landscape](landscape.md).`,
    "",
    ...section("Shared External Dependencies", [
      "External packages used by more than one repository. Drift means the declared version ranges differ.",
      "",
      ...table(
        ["Package", "Ecosystem", "Drift", "Declared versions"],
        shared.map((dep) => [
          code(dep.name),
          dep.ecosystem,
          dep.drift ? "yes" : "no",
          versionGroups(dep.usages, links),
        ]),
      ),
      ...(model.graph.sharedDependencies.length > shared.length
        ? [
            `Showing ${shared.length} of ${model.graph.sharedDependencies.length}; portfolio.json lists all.`,
            "",
          ]
        : []),
    ]),
    ...section(
      "Shared Contracts",
      table(
        ["Kind", "Package", "Repositories", "Evidence"],
        model.graph.sharedContracts.map((c) => [
          c.kind,
          code(c.name),
          c.repos.join(", "),
          c.evidence.map((e) => links.evidence(e, ".")).join(" "),
        ]),
      ),
    ),
  ].join("\n");
}

function renderPackages(model, links) {
  return [
    ...frontmatter("reference", "Packages"),
    "# Packages",
    "",
    "Where each package or module name in this portfolio is defined. Names provided by several repositories are ambiguous.",
    "",
    ...table(
      ["Package", "Ecosystem", "Provided by", "Evidence"],
      model.graph.packages.map((pkg) => [
        code(pkg.name),
        pkg.ecosystem,
        `${pkg.repos.map((r) => `[${r}](repos/${r}.md)`).join(", ")}${pkg.repos.length > 1 ? " (ambiguous)" : ""}`,
        pkg.evidence.map((e) => links.evidence(e, ".")).join(" "),
      ]),
    ),
  ].join("\n");
}

function renderDecisions(model, links) {
  const rows = model.repos.flatMap((repo) =>
    repo.adrs.map((adr) => [
      `[${repo.slug}](repos/${repo.slug}.md)`,
      links.file(repo.slug, adr, "."),
    ]),
  );
  return [
    ...frontmatter("reference", "Decisions"),
    "# Decisions",
    "",
    "Architecture decision records found in selected repositories, linked in place.",
    "",
    ...table(["Repository", "Record"], rows),
  ].join("\n");
}

module.exports = {
  integrationPairs,
  renderDecisions,
  renderDependencies,
  renderIntegration,
  renderPackages,
  renderRepoPage,
};
