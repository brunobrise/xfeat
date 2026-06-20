function sourceLink(source, prefix = "../../") {
  const line = source.line || 1;
  return `[\`${source.file}:${line}\`](${prefix}${source.file}#L${line})`;
}

function renderReferenceClaims(claims) {
  return [
    "# Claims Reference",
    "",
    "Complete generated claim inventory with source evidence.",
    "",
    "| Claim | Type | Source |",
    "| --- | --- | --- |",
    ...claims.map(
      (claim) =>
        `| ${claim.text} | ${claim.type} | ${sourceLink({ file: claim.file, line: claim.line })} |`,
    ),
    "",
  ].join("\n");
}

function renderReferenceFiles(facts) {
  return [
    "# Files Reference",
    "",
    "Complete source-file inventory scanned by `xfeat scan`.",
    "",
    "| File | Component | Lines | Symbols | Evidence |",
    "| --- | --- | ---: | ---: | --- |",
    ...facts.map(
      (fact) =>
        `| \`${fact.file}\` | ${fact.semanticComponent || fact.component} | ${fact.lineCount} | ${fact.symbols.length} | ${sourceLink({ file: fact.file, line: 1 })} |`,
    ),
    "",
  ].join("\n");
}

function renderReferenceSymbols(components) {
  const rows = components.flatMap((component) =>
    component.publicApis.map(
      (api) =>
        `| \`${api.name}\` | ${api.type} | ${component.name} | ${sourceLink(api)} |`,
    ),
  );
  return [
    "# Symbols Reference",
    "",
    "Complete exported-symbol inventory detected from source.",
    "",
    "| Symbol | Kind | Component | Evidence |",
    "| --- | --- | --- | --- |",
    ...(rows.length ? rows : ["| None detected | - | - | - |"]),
    "",
  ].join("\n");
}

function renderReferenceImportGraph(imports) {
  const rows = imports.map((flow) => {
    const kind =
      flow.type === "dependency" ? "package dependency" : "local import";
    return `| ${flow.fromComponent} | ${flow.toComponent} | ${kind} | \`${flow.spec}\` | ${sourceLink({ file: flow.from, line: flow.line })} | ${sourceLink({ file: flow.to, line: 1 })} |`;
  });
  return [
    "# Import Graph Reference",
    "",
    "Complete cross-file and cross-package edge inventory detected by `xfeat scan`.",
    "",
    "| From | To | Kind | Specifier | Source | Target |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(rows.length ? rows : ["| None detected | - | - | - | - | - |"]),
    "",
  ].join("\n");
}

module.exports = {
  renderReferenceClaims,
  renderReferenceFiles,
  renderReferenceImportGraph,
  renderReferenceSymbols,
};
