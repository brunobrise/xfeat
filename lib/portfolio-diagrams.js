const fs = require("fs/promises");
const path = require("path");
const { spawnSync } = require("child_process");
const { systemNames } = require("./portfolio-links");

const MAX_DIAGRAM_NODES = 15;
const WHITE_CANVAS =
  '<rect data-xfeat-white-canvas="true" fill="#FFFFFF" height="100%" width="100%" x="0" y="0"/>';
const PLANTUML_WARNINGS = /Please use|Syntax Error|Cannot find|Error line/i;

function plantumlId(slug) {
  return `repo_${slug.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function renderLandscapePuml(model) {
  const connected = new Set(
    model.graph.edges.flatMap((edge) => [edge.from, edge.to]),
  );
  if (!connected.size || connected.size > MAX_DIAGRAM_NODES) return "";
  const repos = model.repos.filter((repo) => connected.has(repo.slug));
  const systems = systemNames(repos);
  const lines = [
    "@startuml",
    "skinparam backgroundColor #FFFFFF",
    "skinparam shadowing false",
    "skinparam defaultFontName Helvetica",
    "skinparam rectangle {",
    "  BorderColor #486581",
    "  FontColor #102A43",
    "  BackgroundColor #F0F4F8",
    "}",
    "skinparam arrowColor #334E68",
    "left to right direction",
    "",
  ];
  for (const system of systems) {
    const members = repos.filter(
      (repo) => (repo.systemName?.value || "") === system,
    );
    if (system) lines.push(`package "${system}" {`);
    for (const repo of members) {
      lines.push(
        `${system ? "  " : ""}rectangle "${repo.slug}" as ${plantumlId(repo.slug)}`,
      );
    }
    if (system) lines.push("}");
  }
  lines.push("");
  const seen = new Set();
  for (const edge of model.graph.edges) {
    const key = `${edge.from}->${edge.to}:${edge.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const arrow = edge.confidence === "declared" ? "-->" : "..>";
    lines.push(
      `${plantumlId(edge.from)} ${arrow} ${plantumlId(edge.to)} : ${edge.kind}`,
    );
  }
  lines.push("@enduml", "");
  return lines.join("\n");
}

// Adds an explicit white canvas so viewers that ignore the root CSS
// background still show a white diagram, and reports PlantUML warning text.
function normalizeSvg(svg) {
  const warning = PLANTUML_WARNINGS.test(svg)
    ? "PlantUML warning text found in diagrams/landscape.svg."
    : "";
  if (svg.includes("data-xfeat-white-canvas")) return { svg, warning };
  const normalized = svg.replace(
    /(<defs(?:\s[^>]*)?\/>|<defs(?:\s[^>]*)?>[\s\S]*?<\/defs>)/,
    `$1${WHITE_CANVAS}`,
  );
  return { svg: normalized, warning };
}

function plantumlAvailable() {
  const result = spawnSync("plantuml", ["-version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

async function renderLandscapeSvg(outDir) {
  const puml = path.join(outDir, "diagrams", "landscape.puml");
  const result = spawnSync("plantuml", ["-tsvg", puml], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    return {
      rendered: false,
      warning: "plantuml failed to render diagrams/landscape.svg.",
    };
  }
  const svgPath = puml.replace(/\.puml$/, ".svg");
  const { svg, warning } = normalizeSvg(await fs.readFile(svgPath, "utf8"));
  await fs.writeFile(svgPath, svg, "utf8");
  return { rendered: true, warning };
}

module.exports = {
  normalizeSvg,
  plantumlAvailable,
  renderLandscapePuml,
  renderLandscapeSvg,
};
