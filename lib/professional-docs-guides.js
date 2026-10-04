const { sourceLink } = require("./professional-docs-renderers");

// Onboarding and how-to pages for `xfeat scan`: ordered first steps and
// task guides, each step one instruction (STE-lite rule 5.2).

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
      ? `1. Read the README for purpose and project scope (evidence: ${sourceLink(
          semantic.readme.evidence,
          "../",
        )}).`
      : "1. Skip the README, because this repository has none.",
    rootManifests.length
      ? `2. Read root package metadata for scripts and workspace shape (evidence: ${metadataLinks}).`
      : "2. Skip package metadata, because the repository root has none.",
    "3. Read the architecture overview.",
    "4. Open the component page for the area you change.",
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
    "xfeat built this task guide from package metadata and repository tests.",
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
    "1. Run `npm install` if you did not install the dependencies.",
    `2. Run \`${howTo.command}\` from the repository root.`,
    "3. Review failures before you change generated documentation.",
    "4. Regenerate docs with `xfeat scan`.",
    "5. Check the docs with `xfeat audit --changed`.",
    "6. Verify the evidence with `xfeat verify`.",
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

module.exports = { renderHowTo, renderOnboarding };
