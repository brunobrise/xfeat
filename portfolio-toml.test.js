const { parseToml } = require("./lib/portfolio-toml");

describe("Portfolio TOML subset parser", () => {
  it("parses Cargo workspace manifests with tables, dotted keys, and inline tables", () => {
    const { data, lines } = parseToml(`
# Workspace root
[workspace]
members = [
  "crates/agent", # core agent
  "crates/cli",
]

[package]
name = "ai4a"
description = "Portable \\"local\\" CLI"
version = "0.3.0"

[dependencies]
serde.workspace = true
ai4a-agent = { path = "crates/agent", version = "0.3" }
shared-proto = { git = "https://github.com/acme/proto.git", branch = "main" }
'quoted-key' = 'literal \\n stays'

[[bin]]
name = "ai4a"
path = "src/main.rs"

[[bin]]
name = "ai4a-bench"
`);

    expect(data.workspace.members).toEqual(["crates/agent", "crates/cli"]);
    expect(data.package).toEqual({
      name: "ai4a",
      description: 'Portable "local" CLI',
      version: "0.3.0",
    });
    expect(data.dependencies.serde).toEqual({ workspace: true });
    expect(data.dependencies["ai4a-agent"]).toEqual({
      path: "crates/agent",
      version: "0.3",
    });
    expect(data.dependencies["shared-proto"].git).toBe(
      "https://github.com/acme/proto.git",
    );
    expect(data.dependencies["quoted-key"]).toBe("literal \\n stays");
    expect(data.bin).toEqual([
      { name: "ai4a", path: "src/main.rs" },
      { name: "ai4a-bench" },
    ]);
    expect(lines.get("package.name")).toBe(10);
    expect(lines.get("dependencies.ai4a-agent")).toBe(16);
    expect(lines.get("bin.0.name")).toBe(21);
  });

  it("parses pyproject metadata with multi-line strings, arrays, and numbers", () => {
    const { data } = parseToml(`
[project]
name = "legi-sync"
description = """Sync French
legal texts."""
requires-python = ">=3.10"
dependencies = ["requests>=2", "lxml"]
optional = false
retries = 3

[project.scripts]
legi-sync = "legi.cli:main"
`);

    expect(data.project.name).toBe("legi-sync");
    expect(data.project.description).toBe("Sync French\nlegal texts.");
    expect(data.project.dependencies).toEqual(["requests>=2", "lxml"]);
    expect(data.project.optional).toBe(false);
    expect(data.project.retries).toBe(3);
    expect(data.project.scripts).toEqual({ "legi-sync": "legi.cli:main" });
  });

  it("tolerates unsupported syntax without throwing", () => {
    const { data, errors } = parseToml(`
[package]
name = "ok"
broken = [1, 2
[next]
value = "still parsed"
`);

    expect(data.package.name).toBe("ok");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects prototype-polluting keys", () => {
    const { data, errors } = parseToml(
      '[__proto__]\ninvalid = true\n\n[package]\nname = "ok"\nconstructor.prototype.polluted = 1\n__proto__.flag = 2\n',
    );

    expect({}.invalid).toBeUndefined();
    expect({}.polluted).toBeUndefined();
    expect({}.flag).toBeUndefined();
    expect(data.package.name).toBe("ok");
    expect(errors.length).toBe(3);
  });
});
