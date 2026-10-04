const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const { listRepoFiles } = require("./lib/portfolio-files");
const { tempRoot } = require("./test_files/portfolio-fixture");

describe("Portfolio repository file listing", () => {
  const root = tempRoot("portfolio-files");
  let outside;

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "xfeat-outside-"));
    await fs.writeFile(path.join(outside, "secret.txt"), "outside\n");
    for (const file of [
      "src/main.rs",
      "target/debug/build.rs",
      "node_modules/pkg/index.js",
      "generated/out.js",
      ".env",
      ".env.local",
      ".env.example",
      "README.md",
    ]) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), "x\n");
    }
    await fs.writeFile(path.join(root, ".gitignore"), "generated/\n");
    await fs.symlink(outside, path.join(root, "linked"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("skips ignored, dependency, build, secret, and symlinked paths", async () => {
    const files = await listRepoFiles(root);

    expect(files).toEqual([".gitignore", "README.md", "src/main.rs"]);
  });
});
