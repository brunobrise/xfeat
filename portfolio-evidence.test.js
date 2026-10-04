const path = require("path");
const fs = require("fs/promises");
const {
  checkEvidence,
  evidenceReader,
  lineHash,
} = require("./lib/portfolio-evidence");
const { tempRoot } = require("./test_files/portfolio-fixture");

describe("Portfolio evidence hashes", () => {
  const root = tempRoot("portfolio-evidence");
  const file = path.join(root, "package.json");

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      file,
      '{\n  "name": "@acme/web",\n  "description": "Billing portal"\n}\n',
    );
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("hashes trimmed line content so indentation changes stay fresh", () => {
    expect(lineHash('  "name": "@acme/web",')).toBe(
      lineHash('"name": "@acme/web",'),
    );
    expect(lineHash("a")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("cites a line and reports it fresh, moved, changed, or missing", async () => {
    const reader = evidenceReader(root, "web");
    const evidence = await reader.cite("package.json", 2);

    expect(evidence).toEqual({
      repo: "web",
      file: "package.json",
      line: 2,
      hash: lineHash('"name": "@acme/web",'),
    });
    expect(await checkEvidence(root, evidence)).toEqual({ state: "fresh" });

    await fs.writeFile(
      file,
      '{\n  "private": true,\n  "name": "@acme/web",\n  "description": "Billing portal"\n}\n',
    );
    expect(await checkEvidence(root, evidence)).toEqual({
      state: "moved",
      line: 3,
    });

    await fs.writeFile(file, '{\n  "name": "@acme/portal"\n}\n');
    expect(await checkEvidence(root, evidence)).toEqual({ state: "changed" });

    await fs.rm(file);
    expect(await checkEvidence(root, evidence)).toEqual({ state: "missing" });
  });

  it("clamps out-of-range lines and skips files above the size limit", async () => {
    const reader = evidenceReader(root, "web");
    expect((await reader.cite("package.json", 99)).line).toBe(5);

    await fs.writeFile(
      path.join(root, "huge.txt"),
      "x".repeat(1024 * 1024 + 1),
    );
    expect((await reader.text("huge.txt")).length).toBe(0);
  });
});
