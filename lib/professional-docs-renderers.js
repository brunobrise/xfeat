const { packageMetadataStatements } = require("./professional-docs-manifests");
const { blockquote } = require("./portfolio-links");

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
    return `- ${flow.fromComponent} declares a runtime dependency on this component. Evidence: ${sourceLink(
      { file: flow.from, line: flow.line },
      "../../",
    )}.`;
  }
  if (direction === "out") {
    return `- Calls code in ${flow.toComponent} from ${sourceLink(
      { file: flow.from, line: flow.line },
      "../../",
    )} to ${sourceLink({ file: flow.to, line: 1 }, "../../")}.`;
  }
  return `- ${flow.fromComponent} uses this component through ${sourceLink(
    { file: flow.from, line: flow.line },
    "../../",
  )}.`;
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
  // The summary is quoted source text from the README or the manifest, and
  // the evidence comes from the same source as the quote.
  const fromReadme = Boolean(semantic.readme?.summary);
  const purposeSource = fromReadme ? "README" : "manifest";
  const purposeSummary = fromReadme
    ? semantic.readme.summary
    : rootManifest?.description || "";
  const purposeEvidence = fromReadme
    ? semantic.readme.evidence
    : rootManifest && {
        file: rootManifest.file,
        line: rootManifest.descriptionLine,
      };
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
        `- ${api.component} exports \`${api.name}\`. Evidence: ${sourceLink(api, "../../")}.`,
    );
  return [
    "# Architecture Overview",
    "",
    "Explains what this repository is for, how its components connect, and which public APIs it exposes, with source evidence for each statement.",
    "",
    "## System Purpose",
    "",
    ...(purposeSummary
      ? [
          `- ${purposeTitle}, as its ${purposeSource} describes it (evidence: ${sourceLink(purposeEvidence, "../../")}):`,
          "",
          ...blockquote(purposeSummary, "  "),
          "",
        ]
      : [`- ${purposeTitle}: no README summary or manifest description.`]),
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

// A manifest description is the package author's text: quoted, not reworded.
function ownershipLine(manifest, name) {
  const description = manifest.description.trim();
  if (description) {
    return [
      `- Owns the \`${name}\` package, as its manifest describes it (evidence: ${sourceLink({ file: manifest.file, line: manifest.descriptionLine }, "../../")}):`,
      "",
      ...blockquote(description, "  "),
      "",
    ].join("\n");
  }
  return `- Owns the \`${name}\` package under \`${manifest.dir}\`. Its manifest declares no description. Evidence: ${sourceLink({ file: manifest.file, line: manifest.nameLine }, "../../")}.`;
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
  sourceLink,
  renderOverview,
  renderComponent,
  renderAdrIndex,
  renderReport,
};
