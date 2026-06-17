#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const diagramsDir = path.resolve(
  process.argv[2] || "examples/diagrams/019e9799c745d04d",
);

const pumlFiles = fs
  .readdirSync(diagramsDir)
  .filter((file) => file.endsWith(".puml"))
  .sort()
  .map((file) => path.join(diagramsDir, file));

if (pumlFiles.length === 0) {
  throw new Error(`No PlantUML files found in ${diagramsDir}`);
}

const render = spawnSync("plantuml", ["-tsvg", ...pumlFiles], {
  stdio: "inherit",
});

if (render.status !== 0) {
  process.exit(render.status || 1);
}

const whiteCanvas =
  '<rect data-xfeat-white-canvas="true" fill="#FFFFFF" height="100%" width="100%" x="0" y="0"/>';

const svgFiles = fs
  .readdirSync(diagramsDir)
  .filter((file) => file.endsWith(".svg"))
  .sort();

for (const file of svgFiles) {
  const svgPath = path.join(diagramsDir, file);
  let svg = fs.readFileSync(svgPath, "utf8");

  svg = svg.replace(
    /<rect data-xfeat-white-canvas="true" fill="#FFFFFF" height="100%" width="100%" x="0" y="0"\/>/g,
    "",
  );

  if (!svg.includes("background:#FFFFFF;")) {
    throw new Error(`${file} is missing the PlantUML white background style`);
  }

  if (!svg.includes("<defs")) {
    throw new Error(`${file} has no <defs> marker for white-canvas insertion`);
  }

  svg = svg.replace(
    /(<defs(?:\s[^>]*)?\/>|<defs(?:\s[^>]*)?>[\s\S]*?<\/defs>)/,
    `$1${whiteCanvas}`,
  );
  fs.writeFileSync(svgPath, svg);
}

console.log(`Rendered and normalized ${pumlFiles.length} PlantUML diagrams.`);
