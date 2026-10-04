const {
  normalizeSvg,
  renderLandscapePuml,
} = require("./lib/portfolio-diagrams");

function model(edges, count = 2) {
  const repos = Array.from({ length: count }, (_, index) => ({
    slug: `repo-${index}`,
    systemName: index === 0 ? { value: "billing" } : null,
  }));
  return { repos, graph: { edges } };
}

describe("Portfolio diagrams", () => {
  it("draws declared edges solid and name matches dotted, grouped by system", () => {
    const puml = renderLandscapePuml(
      model([
        {
          from: "repo-0",
          to: "repo-1",
          kind: "go-module",
          confidence: "declared",
        },
        {
          from: "repo-1",
          to: "repo-0",
          kind: "package-name",
          confidence: "name-match",
        },
      ]),
    );

    expect(puml).toContain('package "billing" {');
    expect(puml).toContain("repo_repo_0 --> repo_repo_1 : go-module");
    expect(puml).toContain("repo_repo_1 ..> repo_repo_0 : package-name");
    expect(puml).toContain("skinparam backgroundColor #FFFFFF");
  });

  it("skips the diagram when there are no edges or too many connected nodes", () => {
    expect(renderLandscapePuml(model([]))).toBe("");
    const edges = Array.from({ length: 16 }, (_, index) => ({
      from: "repo-0",
      to: `repo-${index + 1}`,
      kind: "go-module",
      confidence: "declared",
    }));
    expect(renderLandscapePuml(model(edges, 17))).toBe("");
  });

  it("adds a white canvas once and reports PlantUML warning text", () => {
    const first = normalizeSvg("<svg><defs/><g></g></svg>");
    const second = normalizeSvg(first.svg);

    expect(first.svg).toBe(
      '<svg><defs/><rect data-xfeat-white-canvas="true" fill="#FFFFFF" height="100%" width="100%" x="0" y="0"/><g></g></svg>',
    );
    expect(second.svg).toBe(first.svg);
    expect(first.warning).toBe("");
    expect(
      normalizeSvg("<svg><defs/>Please use '!option handwritten true'</svg>")
        .warning,
    ).toMatch(/warning text/);
  });
});
