const path = require("path");
const fs = require("fs/promises");
const {
  readRepoManifests,
  normalizePackageName,
} = require("./lib/portfolio-manifests");
const { tempRoot } = require("./test_files/portfolio-fixture");
const { readPackageJson } = require("./lib/portfolio-manifest-readers");

async function write(root, file, body) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), body);
}

describe("Portfolio manifest reader", () => {
  const root = tempRoot("portfolio-manifests");

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reads npm workspaces, bins, scripts, and local dependency specifiers", async () => {
    await write(
      root,
      "package.json",
      JSON.stringify(
        {
          name: "@acme/web",
          description: "Customer billing portal",
          license: "MIT",
          workspaces: { packages: ["packages/*"] },
          bin: { "acme-web": "bin/cli.js" },
          scripts: { dev: "vite", test: "vitest run" },
          dependencies: {
            "@acme/billing-sdk": "^2.1.0",
            "@acme/ui": "file:../ui",
          },
          devDependencies: { vitest: "^3.0.0" },
        },
        null,
        2,
      ),
    );
    await write(
      root,
      "packages/api-client/package.json",
      JSON.stringify({ name: "@acme/api-client" }, null, 2),
    );
    await write(
      root,
      "test/fixtures/sample/package.json",
      JSON.stringify({ name: "fixture-should-be-ignored" }),
    );

    const manifests = await readRepoManifests(root);
    const rootManifest = manifests.find((m) => m.file === "package.json");

    expect(manifests.map((m) => m.name)).toEqual([
      "@acme/web",
      "@acme/api-client",
    ]);
    expect(rootManifest).toMatchObject({
      ecosystem: "npm",
      name: "@acme/web",
      description: "Customer billing portal",
      license: "MIT",
      members: ["packages/*"],
    });
    expect(rootManifest.nameLine).toBe(2);
    expect(rootManifest.bins).toEqual([
      expect.objectContaining({ name: "acme-web", path: "bin/cli.js" }),
    ]);
    expect(rootManifest.scripts).toEqual([
      expect.objectContaining({ name: "dev", command: "vite" }),
      expect.objectContaining({ name: "test", command: "vitest run" }),
    ]);
    expect(rootManifest.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "@acme/billing-sdk",
          kind: "runtime",
          version: "^2.1.0",
        }),
        expect.objectContaining({ name: "@acme/ui", path: "../ui" }),
        expect.objectContaining({ name: "vitest", kind: "dev" }),
      ]),
    );
  });

  it("reads Cargo workspaces with path and git dependencies", async () => {
    await write(
      root,
      "Cargo.toml",
      `[workspace]\nmembers = ["crates/*"]\n\n[workspace.dependencies]\nshared-proto = { git = "https://github.com/acme/proto.git" }\n`,
    );
    await write(
      root,
      "crates/agent/Cargo.toml",
      `[package]\nname = "acme-agent"\ndescription = "Agent runtime"\nlicense = "Apache-2.0"\n\n[dependencies]\nacme-core = { path = "../../../core" }\nserde = "1"\n\n[[bin]]\nname = "acme-agent"\npath = "src/main.rs"\n`,
    );

    const manifests = await readRepoManifests(root);
    const workspace = manifests.find((m) => m.file === "Cargo.toml");
    const agent = manifests.find((m) => m.name === "acme-agent");

    expect(workspace.members).toEqual(["crates/*"]);
    expect(workspace.dependencies).toEqual([
      expect.objectContaining({
        name: "shared-proto",
        git: "https://github.com/acme/proto",
      }),
    ]);
    expect(agent).toMatchObject({
      ecosystem: "cargo",
      dir: "crates/agent",
      description: "Agent runtime",
      license: "Apache-2.0",
      nameLine: 2,
    });
    expect(agent.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "acme-core",
          path: "../../../core",
          line: 7,
        }),
        expect.objectContaining({
          name: "serde",
          kind: "runtime",
          version: "1",
        }),
      ]),
    );
    expect(agent.bins).toEqual([
      expect.objectContaining({ name: "acme-agent", path: "src/main.rs" }),
    ]);
  });

  it("reads Python, Go, and Composer manifests", async () => {
    await write(
      root,
      "pyproject.toml",
      `[project]\nname = "Legi_Sync"\ndescription = "Sync legal texts"\ndependencies = ["requests>=2", "acme-shared[cli]==1.0"]\n\n[project.scripts]\nlegi-sync = "legi.cli:main"\n`,
    );
    await write(
      root,
      "requirements.txt",
      "# pinned\nlxml==5.2\n-e ../acme-utils\ngit+https://github.com/acme/parsers.git#egg=acme-parsers\n",
    );
    await write(
      root,
      "go.mod",
      "module github.com/acme/gateway\n\ngo 1.22\n\nrequire (\n\tgithub.com/acme/auth v1.4.0\n\tgolang.org/x/net v0.20.0\n)\n\nreplace github.com/acme/auth => ../auth\n",
    );
    await write(
      root,
      "composer.json",
      JSON.stringify(
        { name: "acme/cms", require: { "acme/theme": "^1.0" } },
        null,
        2,
      ),
    );

    const manifests = await readRepoManifests(root);
    const python = manifests.find((m) => m.file === "pyproject.toml");
    const requirements = manifests.find((m) => m.file === "requirements.txt");
    const go = manifests.find((m) => m.file === "go.mod");
    const composer = manifests.find((m) => m.file === "composer.json");

    expect(python).toMatchObject({ ecosystem: "python", name: "Legi_Sync" });
    expect(python.dependencies.map((d) => [d.name, d.version])).toEqual([
      ["requests", ">=2"],
      ["acme-shared", "==1.0"],
    ]);
    expect(python.scripts).toEqual([
      expect.objectContaining({ name: "legi-sync", command: "legi.cli:main" }),
    ]);
    expect(requirements.dependencies).toEqual([
      expect.objectContaining({ name: "lxml", line: 2 }),
      expect.objectContaining({ path: "../acme-utils", line: 3 }),
      expect.objectContaining({
        name: "acme-parsers",
        git: "https://github.com/acme/parsers",
        line: 4,
      }),
    ]);
    expect(go).toMatchObject({
      ecosystem: "go",
      name: "github.com/acme/gateway",
    });
    expect(go.dependencies).toEqual([
      expect.objectContaining({
        name: "github.com/acme/auth",
        path: "../auth",
        line: 6,
      }),
      expect.objectContaining({
        name: "golang.org/x/net",
        version: "v0.20.0",
        line: 7,
      }),
    ]);
    expect(composer.dependencies).toEqual([
      expect.objectContaining({ name: "acme/theme" }),
    ]);
  });

  it("reports unparseable manifests instead of dropping them", async () => {
    await write(root, "package.json", "{ broken json");
    await write(root, "Cargo.toml", '[package]\nname = "ok"\nbroken = [1, 2\n');

    const manifests = await readRepoManifests(root);

    expect(manifests).toEqual([
      expect.objectContaining({
        file: "Cargo.toml",
        name: "ok",
        parseErrors: 1,
      }),
      expect.objectContaining({
        file: "package.json",
        invalid: true,
        parseErrors: 1,
        dependencies: [],
      }),
    ]);
  });

  it("normalizes package names per ecosystem", () => {
    expect(normalizePackageName("python", "Legi_Sync.Core")).toBe(
      "legi-sync-core",
    );
    expect(normalizePackageName("cargo", "acme_agent")).toBe("acme-agent");
    expect(normalizePackageName("npm", "@Acme/UI")).toBe("@acme/ui");
    expect(normalizePackageName("go", "github.com/Acme/Auth")).toBe(
      "github.com/Acme/Auth",
    );
  });

  it("never aborts on unexpected manifest shapes", async () => {
    await write(root, "package.json", "null");
    await write(
      root,
      "composer.json",
      JSON.stringify({ name: "acme/tool", bin: "bin/tool" }),
    );
    await write(
      root,
      "pyproject.toml",
      '[project]\nname = "acme-tool"\n\n[project.dependencies]\nrequests = "2"\n',
    );
    await write(root, "go.mod", "x".repeat(1024 * 1024 + 1));

    const manifests = await readRepoManifests(root);
    const byFile = Object.fromEntries(manifests.map((m) => [m.file, m]));

    expect(byFile["package.json"]).toMatchObject({ invalid: true });
    expect(byFile["composer.json"].bins).toEqual([
      expect.objectContaining({ name: "tool", path: "bin/tool" }),
    ]);
    expect(byFile["pyproject.toml"]).toMatchObject({
      name: "acme-tool",
      dependencies: [],
    });
    expect(byFile["go.mod"]).toMatchObject({ invalid: true, tooLarge: true });
  });

  it("drops credentials and URLs from version specs and keeps relative npm paths", async () => {
    await write(
      root,
      "package.json",
      JSON.stringify(
        {
          name: "@acme/web",
          dependencies: {
            "private-lib":
              "git+https://ghp_SECRET123:x-oauth-basic@github.com/acme/private-lib.git",
            "ssh-lib": "git+ssh://git@github.com:acme/ssh-lib.git",
            "ui-kit": "../ui-kit",
            react: "^19.0.0",
          },
        },
        null,
        2,
      ),
    );

    const [manifest] = await readRepoManifests(root);
    const dep = (name) => manifest.dependencies.find((d) => d.name === name);

    expect(JSON.stringify(manifest)).not.toContain("ghp_SECRET123");
    expect(dep("private-lib")).toMatchObject({ version: "" });
    expect(dep("private-lib").git).toBe("https://github.com/acme/private-lib");
    expect(dep("ssh-lib").git).toBe("https://github.com/acme/ssh-lib");
    expect(dep("ui-kit")).toMatchObject({ path: "../ui-kit", version: "" });
    expect(dep("react").version).toBe("^19.0.0");
  });

  it("cites the line of each dependency in multi-line pyproject arrays", async () => {
    await write(
      root,
      "pyproject.toml",
      '[project]\nname = "acme-sync"\ndependencies = [\n  "requests>=2",\n  "acme-common==1.0",\n]\n',
    );

    const [manifest] = await readRepoManifests(root);

    expect(manifest.dependencies.map((d) => [d.name, d.line])).toEqual([
      ["requests", 4],
      ["acme-common", 5],
    ]);
  });

  it("orders manifests by code units, not by locale", async () => {
    await write(
      root,
      "packages/aa/package.json",
      JSON.stringify({ name: "aa" }),
    );
    await write(
      root,
      "packages/Zeta/package.json",
      JSON.stringify({ name: "zeta" }),
    );

    const manifests = await readRepoManifests(root);

    expect(manifests.map((m) => m.dir)).toEqual([
      "packages/Zeta",
      "packages/aa",
    ]);
  });

  it("cites dotted Cargo dependency keys on their own line", async () => {
    await write(
      root,
      "Cargo.toml",
      '[package]\nname = "discord"\n\n[dependencies]\nprotocol.workspace = true\ntui = { path = "../tui" }\n\n[dependencies.state]\npath = "../state"\n',
    );

    const [manifest] = await readRepoManifests(root);

    expect(manifest.dependencies.map((d) => [d.name, d.line])).toEqual([
      ["protocol", 5],
      ["tui", 6],
      ["state", 8],
    ]);
  });
});

describe("npm program names", () => {
  it("names a string bin after the package without its scope, as npm installs it", () => {
    const scoped = readPackageJson(
      "package.json",
      '{"name":"@acme/fmt","bin":"fmt.js"}',
    );
    const plain = readPackageJson(
      "package.json",
      '{"name":"fmt","bin":"a.js"}',
    );
    expect(scoped.bins.map((bin) => bin.name)).toEqual(["fmt"]);
    expect(plain.bins.map((bin) => bin.name)).toEqual(["fmt"]);
  });
});
