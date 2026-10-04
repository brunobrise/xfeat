const { packageMetadataStatements } = require("./professional-docs-manifests");

function sourceLink(source, prefix = "../") {
  if (!source) return "source unavailable";
  const line = source.line || 1;
  return `[\`${source.file}:${line}\`](${prefix}${source.file}#L${line})`;
}

function flowScore(flow) {
  if (flow.type === "dependency") return 100;
  if (/\/src\//.test(flow.from) && !/(^|\/)test\//.test(flow.from)) return 60;
  if (!/(^|\/)(test|tests|examples)\//.test(flow.from)) return 30;
  return 0;
}

function renderFlow(flow, prefix = "../../") {
  if (flow.type === "dependency") {
    return `- ${flow.fromComponent} declares a package dependency on ${flow.toComponent}. Evidence: ${sourceLink(
      { file: flow.from, line: flow.line },
      prefix,
    )}.`;
  }
  return `- ${flow.fromComponent} imports ${flow.toComponent} through ${sourceLink(
    { file: flow.from, line: flow.line },
    prefix,
  )} and resolves to ${sourceLink({ file: flow.to, line: 1 }, prefix)}.`;
}

function renderComponentFlow(flow, direction) {
  if (flow.type === "dependency" && direction === "out") {
    return `- Declares runtime dependency on ${flow.toComponent}. Evidence: ${sourceLink(
      { file: flow.from, line: flow.line },
      "../../",
    )}.`;
  }
  if (flow.type === "dependency") {
    return `- Required by ${flow.fromComponent}. Evidence: ${sourceLink(
      { file: flow.from, line: flow.line },
      "../../",
    )}.`;
  }
  if (direction === "out") {
    return `- Calls into ${flow.toComponent} from ${sourceLink(
      { file: flow.from, line: flow.line },
      "../../",
    )} to ${sourceLink({ file: flow.to, line: 1 }, "../../")}.`;
  }
  return `- Used by ${flow.fromComponent} through ${sourceLink(
    { file: flow.from, line: flow.line },
    "../../",
  )}.`;
}

function sentence(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function namedRootManifest(manifests = []) {
  return manifests.find((manifest) => manifest.dir === "." && manifest.name);
}

function renderOverview(facts, claims, semantic = {}) {
  const components = semantic.components || [];
  const manifests = semantic.manifests || [];
  const rootManifest = namedRootManifest(manifests);
  const purposeTitle =
    semantic.readme?.title || rootManifest?.name || "Repository";
  const purposeSummary =
    semantic.readme?.summary ||
    rootManifest?.description ||
    "No README summary detected.";
  const metadata = packageMetadataStatements(manifests).map((statement) =>
    statement.evidence
      ? `- ${statement.text} Evidence: ${sourceLink(statement.evidence, "../../")}.`
      : `- ${statement.text}`,
  );
  const componentRows = components.map((component) => {
    const description =
      component.manifest?.description || "Source-backed component";
    const evidence = component.manifest
      ? sourceLink(
          {
            file: component.manifest.file,
            line: component.manifest.nameLine,
          },
          "../../",
        )
      : sourceLink({ file: component.facts[0]?.file || "", line: 1 }, "../../");
    return `| ${component.name} | ${description} | ${component.facts.length} | ${component.publicApis.length} | ${evidence} |`;
  });
  const flows = (semantic.imports || [])
    .filter((flow) => flow.fromComponent !== flow.toComponent)
    .sort((a, b) => flowScore(b) - flowScore(a))
    .slice(0, 12)
    .map((flow) => renderFlow(flow, "../../"));
  const publicApis = components
    .flatMap((component) =>
      component.publicApis
        .slice(0, 4)
        .map((api) => ({ ...api, component: component.name })),
    )
    .slice(0, 20)
    .map(
      (api) =>
        `- \`${api.name}\` is exported by ${api.component}. Evidence: ${sourceLink(api, "../../")}.`,
    );
  return [
    "# Architecture Overview",
    "",
    "Explains what this repository is for, how its components fit together, and which public APIs it exposes, with source evidence for each statement.",
    "",
    "## System Purpose",
    "",
    `- ${purposeTitle}: ${sentence(purposeSummary)} Evidence: ${sourceLink(
      semantic.readme?.evidence ||
        (rootManifest && {
          file: rootManifest.file,
          line: rootManifest.descriptionLine,
        }),
      "../../",
    )}.`,
    ...metadata,
    "",
    "## Component Map",
    "",
    "| Component | Responsibility Signal | Files | Public APIs | Evidence |",
    "| --- | --- | ---: | ---: | --- |",
    ...componentRows,
    "",
    "## Runtime Flow",
    "",
    ...(flows.length
      ? flows
      : ["- No cross-component local imports detected from scanned source."]),
    "",
    "## Key Public APIs",
    "",
    ...(publicApis.length
      ? publicApis
      : ["- No exported public APIs detected."]),
    "",
    "## Evidence Summary",
    "",
    `- Source files: ${facts.length}`,
    `- Grounded claims: ${claims.length}`,
    "- Complete claims: [reference/claims.md](../reference/claims.md)",
    "- Complete source files: [reference/files.md](../reference/files.md)",
    "- Complete import graph: [reference/import-graph.md](../reference/import-graph.md)",
    "- Complete exported symbols: [reference/symbols.md](../reference/symbols.md)",
    "",
    "## Claim Evidence",
    "",
    "| Claim | Source |",
    "| --- | --- |",
    ...claims.slice(0, 25).map((claim) => {
      const source = `${claim.file}:${claim.line}`;
      return `| ${claim.text} | \`${source}\` |`;
    }),
    "",
  ].join("\n");
}

function ownershipLine(manifest, name) {
  const description = manifest.description.trim().replace(/\.+$/, "");
  if (description) {
    return `- Owns ${description}. Evidence: ${sourceLink({ file: manifest.file, line: manifest.descriptionLine }, "../../")}.`;
  }
  return `- Owns the \`${name}\` package under \`${manifest.dir}\`; its manifest declares no description. Evidence: ${sourceLink({ file: manifest.file, line: manifest.nameLine }, "../../")}.`;
}

function renderComponent(component) {
  const responsibilities = [
    component.manifest
      ? ownershipLine(component.manifest, component.name)
      : `- Owns source under \`${component.dir}\`. Evidence: ${sourceLink(
          { file: component.facts[0]?.file || "", line: 1 },
          "../../",
        )}.`,
    component.publicApis.length
      ? `- Exposes public APIs including ${component.publicApis
          .slice(0, 5)
          .map((api) => `\`${api.name}\``)
          .join(
            ", ",
          )}. Evidence: ${sourceLink(component.publicApis[0], "../../")}.`
      : "- No exported public APIs detected in scanned source.",
  ];
  const apiRows = component.publicApis.map(
    (api) => `| \`${api.name}\` | ${api.type} | ${sourceLink(api, "../../")} |`,
  );
  const fileRows = component.importantFiles.map(
    (file) =>
      `| \`${file.file}\` | ${file.reason} | ${sourceLink(file, "../../")} |`,
  );
  const flowsOut = component.flowsOut
    .sort((a, b) => flowScore(b) - flowScore(a))
    .map((flow) => renderComponentFlow(flow, "out"));
  const flowsIn = component.flowsIn
    .sort((a, b) => flowScore(b) - flowScore(a))
    .map((flow) => renderComponentFlow(flow, "in"));
  const excerpts = component.importantFiles
    .filter((file) => file.excerpt)
    .flatMap((file) => [
      `### \`${file.file}\``,
      "",
      `Evidence: ${sourceLink(file, "../../")}.`,
      "",
      "```text",
      file.excerpt.replace(/`/g, "'"),
      "```",
      "",
    ]);

  return [
    `# Component: ${component.name}`,
    "",
    "Reference for this component: responsibilities, public APIs, important files, and data flow, with source evidence.",
    "",
    "## Responsibilities",
    "",
    ...responsibilities,
    "",
    "## Public APIs",
    "",
    "| API | Kind | Evidence |",
    "| --- | --- | --- |",
    ...(apiRows.length ? apiRows : ["| None detected | - | - |"]),
    "",
    "## Important Files",
    "",
    "| File | Why It Matters | Evidence |",
    "| --- | --- | --- |",
    ...fileRows,
    "",
    "## Data Flow",
    "",
    ...(flowsOut.length || flowsIn.length
      ? [...flowsOut, ...flowsIn]
      : ["- No cross-component local imports detected for this component."]),
    "",
    "## Source Excerpts",
    "",
    ...(excerpts.length ? excerpts : ["No source excerpts available.", ""]),
  ].join("\n");
}

function renderOnboarding(semantic = {}) {
  const rootManifests = (semantic.manifests || []).filter(
    (manifest) => manifest.dir === "." && (manifest.name || manifest.virtual),
  );
  const npmRoot = rootManifests.find(
    (manifest) => manifest.file === "package.json",
  );
  const firstFiles = (semantic.components || [])
    .flatMap((component) => component.importantFiles.slice(0, 2))
    .sort(
      (a, b) => (b.score || 0) - (a.score || 0) || a.file.localeCompare(b.file),
    )
    .slice(0, 12);
  const commands = (npmRoot?.scripts || [])
    .filter((script) =>
      ["build", "test", "check", "lint", "dev", "start"].includes(script.name),
    )
    .map(
      (script) =>
        `- \`npm run ${script.name}\` from ${sourceLink({ file: npmRoot.file, line: script.line }, "../")}.`,
    );
  const metadataLinks = rootManifests
    .map((manifest) =>
      sourceLink(
        {
          file: manifest.file,
          line: manifest.virtual ? manifest.membersLine : manifest.nameLine,
        },
        "../",
      ),
    )
    .join(", ");
  return [
    "# Onboarding",
    "",
    "A first reading path and first commands for a new contributor, with source evidence.",
    "",
    "## Start Here",
    "",
    semantic.readme?.evidence
      ? `1. Read the README for purpose and project scope. Evidence: ${sourceLink(
          semantic.readme.evidence,
          "../",
        )}.`
      : "1. No README detected.",
    rootManifests.length
      ? `2. Read root package metadata for scripts and workspace shape. Evidence: ${metadataLinks}.`
      : "2. No root package metadata detected.",
    "3. Follow the architecture overview, then open component docs for the area you change.",
    "",
    "## First Files To Read",
    "",
    ...firstFiles.map(
      (file) =>
        `- \`${file.file}\` - ${file.reason}. Evidence: ${sourceLink(file, "../")}.`,
    ),
    "",
    "## First Commands",
    "",
    ...(npmRoot
      ? [
          "- `npm install` to install dependencies.",
          ...(commands.length
            ? commands
            : ["- No common npm scripts detected."]),
        ]
      : ["- No root package.json scripts detected."]),
    "",
    "## Review Checklist",
    "",
    "- Confirm component ownership before changing behavior.",
    "- Run `xfeat audit --changed` before merging documentation changes.",
    "- Run `xfeat verify` after regenerating docs.",
    "",
  ].join("\n");
}

function renderHowTo(howTo) {
  const testEvidence = howTo.testFiles.map(
    (file) =>
      `| Test file | \`${file}\` | ${sourceLink({ file, line: 1 }, "../../")} |`,
  );
  return [
    `# ${howTo.title}`,
    "",
    "Task guide built from package metadata and repository tests.",
    "",
    "## Goal",
    "",
    `Run \`${howTo.command}\` to execute \`${howTo.rawCommand}\`. Evidence: ${sourceLink(
      howTo.evidence,
      "../../",
    )}.`,
    "",
    "## Steps",
    "",
    "1. Install dependencies with `npm install` if they are not installed.",
    `2. Run \`${howTo.command}\` from the repository root.`,
    "3. Review failures before changing generated documentation.",
    "4. Regenerate docs with `xfeat scan`, then run `xfeat audit --changed` and `xfeat verify`.",
    "",
    "## Evidence",
    "",
    "| Source | Detail | Link |",
    "| --- | --- | --- |",
    `| Package script | \`${howTo.rawCommand}\` | ${sourceLink(howTo.evidence, "../../")} |`,
    ...testEvidence,
    "",
  ].join("\n");
}

function renderAdrIndex(markdownFiles) {
  const adrFiles = markdownFiles.filter((file) =>
    /(^|\/)adr[-_]?|architecture-decision/i.test(file),
  );
  const rows = adrFiles.length
    ? adrFiles.map((file) => `- [${file}](../${file})`)
    : ["- No ADR files detected yet."];
  return [
    "# ADR Index",
    "",
    "Architecture decision records detected in this repository.",
    "",
    ...rows,
    "",
  ].join("\n");
}

function renderReport(facts, claims, docs, semantic = {}, skipped = []) {
  return [
    "# xfeat Report",
    "",
    "Summary of the last `xfeat scan` run.",
    "",
    `- Source files: ${facts.length}`,
    `- Grounded claims: ${claims.length}`,
    `- Documents: ${docs.length}`,
    `- Semantic components: ${(semantic.components || []).length}`,
    `- How-to guides: ${(semantic.howTos || []).length}`,
    `- Skipped files: ${skipped.length}`,
    ...(skipped.length
      ? [
          "",
          "## Skipped Files",
          "",
          "Existing files at generated paths that `xfeat scan` left untouched:",
          "",
          ...skipped.map((item) => `- \`${item.path}\` (${item.reason})`),
        ]
      : []),
    "",
  ].join("\n");
}

module.exports = {
  renderOverview,
  renderComponent,
  renderOnboarding,
  renderHowTo,
  renderAdrIndex,
  renderReport,
};
