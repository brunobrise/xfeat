const {
  code,
  firstSentence,
  frontmatter,
  shortSha,
  sortCommands,
  systemNames,
  table,
} = require("./portfolio-links");

const ESSENTIAL = ["setup", "build", "test", "lint", "run"];
const MAX_FALLBACK_COMMANDS = 3;
const LLMS_LIMIT = 8 * 1024;

function percent({ count, total }) {
  return total ? `${Math.round((count / total) * 100)}%` : "n/a";
}

function verifiedAt(repo) {
  if (!repo.git.isRepo) return "no git";
  const sha = code(shortSha(repo.git.head) || "no commits");
  return repo.git.dirty ? `${sha} (uncommitted changes)` : sha;
}

function languages(repo, limit = 3) {
  return (
    repo.languages
      .slice(0, limit)
      .map((language) => language.name)
      .join(", ") || "none detected"
  );
}

function integrationPath(a, b) {
  const [first, second] = [a, b].sort();
  return `integrations/${first}--${second}.md`;
}

function referenceLinks(documents) {
  const pages = [
    ["dependencies.md", "dependencies"],
    ["packages.md", "packages"],
    ["decisions.md", "decisions"],
  ].filter(([file]) => documents.includes(file));
  return pages.map(([file, label]) => `[${label}](${file})`).join(" · ");
}

function renderIndex(model, documents) {
  const edges = model.graph.edges.length;
  const owners = model.coverage.owner;
  const systems = systemNames(model.repos);
  const grouped = systems.length > 1 || systems[0] !== "";
  const rowsFor = (repos) =>
    repos.map((repo) => [
      `[${repo.slug}](repos/${repo.slug}.md)`,
      firstSentence(repo.purpose?.value) || "No purpose found",
      repo.ownership?.value || "none declared",
      repo.status.value,
      languages(repo),
      verifiedAt(repo),
    ]);
  const headers = [
    "Repository",
    "Purpose",
    "Owner",
    "Status",
    "Languages",
    "Verified at",
  ];
  const body = [];
  for (const system of systems) {
    const repos = model.repos.filter(
      (repo) => (repo.systemName?.value || "") === system,
    );
    if (grouped) body.push(`### ${system || "Ungrouped"}`, "");
    body.push(...table(headers, rowsFor(repos)));
  }
  const reference = referenceLinks(documents);
  return [
    ...frontmatter("landscape", model.name),
    `# ${model.name}`,
    "",
    ...(model.description ? [model.description, ""] : []),
    `${model.repos.length} repositories, ${edges} declared dependencies between them, owners declared for ${owners.count} of ${owners.total}. Repository and integration pages link each statement to the line xfeat read it from.`,
    "",
    "## Start Here",
    "",
    ...(documents.includes("learn.md")
      ? [
          "- [Learning path](learn.md): ordered steps with checks for engineers who are new to these repositories.",
        ]
      : []),
    "- [Getting started](getting-started.md): clone order and declared commands.",
    "- [Landscape](landscape.md): which repositories depend on which.",
    "- [Gaps](gaps.md): missing owners, tests, CI, and unresolved names.",
    ...(reference ? [`- Reference: ${reference}.`] : []),
    "",
    "## Repositories",
    "",
    ...body,
  ].join("\n");
}

// One command per essential category keeps onboarding short; repository
// pages keep the full list. Repositories with only other commands show a few.
function essentialCommands(commands) {
  const sorted = sortCommands(commands);
  const picked = ESSENTIAL.map((category) =>
    sorted.find((command) => command.category === category),
  ).filter(Boolean);
  return picked.length ? picked : sorted.slice(0, MAX_FALLBACK_COMMANDS);
}

function renderGettingStarted(model, links) {
  const sections = model.cloneOrder.map((item, index) => {
    const repo = links.bySlug.get(item.slug);
    const deps = model.graph.edges
      .filter((edge) => edge.from === repo.slug)
      .map((edge) => edge.to);
    const commands = essentialCommands(repo.commands);
    const clone = repo.git.remoteUrl
      ? `- Clone: ${code(`git clone ${repo.git.remoteUrl}`)}`
      : "- Clone: none. This repository has no git remote and exists only as a local folder.";
    return [
      `## ${index + 1}. ${repo.slug}`,
      "",
      clone,
      `- Depends on: ${[...new Set(deps)].map((dep) => `[${dep}](repos/${dep}.md)`).join(", ") || "no other repository in this portfolio"}`,
      ...(item.cycle
        ? [
            "- Dependency cycle detected; order within the cycle is alphabetical.",
          ]
        : []),
      `- Details: [repos/${repo.slug}.md](repos/${repo.slug}.md)`,
      "",
      ...(commands.length
        ? table(
            ["Purpose", "Command", "Directory", "Declared in"],
            commands.map((command) => [
              command.category,
              code(command.command),
              code(command.cwd),
              `${command.source} ${links.evidence(command.evidence, ".")}`,
            ]),
          )
        : ["No declared commands. See [gaps](gaps.md).", ""]),
    ];
  });
  return [
    ...frontmatter("tutorial", "Getting Started"),
    "# Getting Started",
    "",
    "Clone repositories in this order: each one comes after the repositories it depends on. Each section shows one command per purpose. Repository pages list every declared command. xfeat copied these commands from the cited files and did not run them.",
    "",
    ...sections.flat(),
  ].join("\n");
}

function edgeRows(edges) {
  return edges.map((edge) => [
    `[${edge.from}](repos/${edge.from}.md)`,
    `[${edge.to}](repos/${edge.to}.md)`,
    edge.kind,
    edge.confidence,
    code(edge.dependency),
    `[details](${integrationPath(edge.from, edge.to)})`,
  ]);
}

function renderLandscape(model, diagram) {
  const connected = new Set(
    model.graph.edges.flatMap((edge) => [edge.from, edge.to]),
  );
  const isolated = model.repos.filter((repo) => !connected.has(repo.slug));
  let diagramLines = [];
  if (diagram.svg) {
    diagramLines = [
      "![Landscape](diagrams/landscape.svg)",
      "",
      "Solid arrows are declared dependencies. Dotted arrows are package-name matches.",
      "",
    ];
  } else if (diagram.puml) {
    diagramLines = [
      `Diagram source: [diagrams/landscape.puml](diagrams/landscape.puml). Render it with ${code("xfeat portfolio scan --render-diagrams")}.`,
      "",
    ];
  } else if (connected.size) {
    diagramLines = [
      `No diagram: ${connected.size} connected repositories exceed the readability limit. Use the table below.`,
      "",
    ];
  }
  return [
    ...frontmatter("landscape", "Landscape"),
    "# Landscape",
    "",
    "Declared dependencies between repositories in this portfolio. xfeat does not detect runtime calls through HTTP, queues, or service registries, so a missing edge does not prove two repositories are independent.",
    "",
    ...diagramLines,
    ...(model.graph.edges.length
      ? table(
          ["From", "To", "Kind", "Confidence", "Dependency", "Details"],
          edgeRows(model.graph.edges),
        )
      : ["No declared dependencies between selected repositories.", ""]),
    ...(isolated.length
      ? [
          "## Repositories Without Declared Dependencies",
          "",
          ...isolated.map((repo) => `- [${repo.slug}](repos/${repo.slug}.md)`),
          "",
        ]
      : []),
  ].join("\n");
}

function renderGaps(model, links) {
  const labels = [
    ["owner", "Owner declared"],
    ["purpose", "Purpose found"],
    ["testCommand", "Declared test command"],
    ["ci", "CI workflow"],
    ["license", "License"],
  ];
  return [
    ...frontmatter("gaps", "Gaps"),
    "# Gaps",
    "",
    "What xfeat could not find. Each gap is a missing declaration, not a judgment about the code.",
    "",
    "## Coverage",
    "",
    ...table(
      ["Signal", "Repositories", "Coverage"],
      labels.map(([key, label]) => [
        label,
        `${model.coverage[key].count} of ${model.coverage[key].total}`,
        percent(model.coverage[key]),
      ]),
    ),
    ...(model.gaps.length
      ? [
          "## By Repository",
          "",
          ...table(
            ["Repository", "Gap", "Detail"],
            model.gaps.map((gap) => [
              `[${gap.repo}](repos/${gap.repo}.md)`,
              gap.code,
              gap.message,
            ]),
          ),
        ]
      : []),
    ...(model.graph.ambiguous.length
      ? [
          "## Ambiguous Package Names",
          "",
          "Several selected repositories provide a package with each of these names, so xfeat draws no edge for them.",
          "",
          ...table(
            ["Consumer", "Dependency", "Ecosystem", "Candidates", "Evidence"],
            model.graph.ambiguous.map((item) => [
              item.from,
              code(item.dependency),
              item.ecosystem,
              item.candidates.join(", "),
              links.evidence(item.consumer, "."),
            ]),
          ),
        ]
      : []),
    "## Detection Limits",
    "",
    "- Edges come from manifests, git submodules, GitHub Actions, and Terraform sources. xfeat does not read HTTP URLs, queues, or service registries.",
    "- Package-name matches do not verify which registry a dependency resolves from.",
    "- xfeat copies commands from CI, scripts, Makefiles, and justfiles. It does not run them.",
    "",
  ].join("\n");
}

function renderLlmsTxt(model, documents) {
  const lines = [
    `# ${model.name}`,
    "",
    `> Link index for ${model.repos.length} repositories documented by xfeat. Facts link to source lines; portfolio.json holds the full model.`,
    "",
    "## Pages",
    "",
    ...documents
      .filter((doc) => doc.endsWith(".md") && !doc.includes("/"))
      .map((doc) => `- [${doc.replace(/\.md$/, "")}](${doc})`),
    "- [portfolio.json](portfolio.json): machine-readable model with evidence hashes",
    "- [checks.json](checks.json): questions with cited answers, for self-tests and agent evaluation",
    "",
    "## Repositories",
    "",
  ];
  // Links only: generated overview prose does not help coding agents, and the
  // limit is in bytes because agents load the file as bytes.
  let size = Buffer.byteLength(lines.join("\n"));
  for (const repo of model.repos) {
    const line = `- [${repo.slug}](repos/${repo.slug}.md)`;
    if (size + Buffer.byteLength(line) + 80 > LLMS_LIMIT) {
      lines.push("- Remaining repositories are listed in portfolio.json.");
      break;
    }
    lines.push(line);
    size += Buffer.byteLength(line) + 1;
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  integrationPath,
  renderGaps,
  renderGettingStarted,
  renderIndex,
  renderLandscape,
  renderLlmsTxt,
  verifiedAt,
};
