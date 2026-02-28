const path = require("path");
const fs = require("fs/promises");
const { getIgnores, initTreeSitter, extractStructure } = require("./index");

describe("Code Features Extractor Unit Tests", () => {
  const testDir = path.join(__dirname, "__test_workspace__");

  beforeAll(async () => {
    // Create a temporary workspace for testing
    await fs.mkdir(testDir, { recursive: true });

    // Create a fake .gitignore
    await fs.writeFile(
      path.join(testDir, ".gitignore"),
      "ignored_folder/\n*.log\n",
    );

    // Create some fake code files
    await fs.writeFile(
      path.join(testDir, "sample.js"),
      `
      import { someLib } from 'some-lib';
      export class MyClass {
        myMethod() {}
      }
      export function myFunction() {}
      `,
    );

    await fs.writeFile(
      path.join(testDir, "sample.py"),
      `
from math import sqrt
class PythonClass:
    def py_method(self):
        pass
def py_function():
    pass
      `,
    );

    await fs.writeFile(
      path.join(testDir, "sample.rs"),
      `
      use std::collections::HashMap;
      pub struct MyRustStruct {
          field: i32,
      }
      impl MyRustStruct {
          pub fn rs_method(&self) {}
      }
      pub fn rs_function() {}
      `,
    );

    await fs.writeFile(path.join(testDir, "unsupported.txt"), "Hello world");

    // Initialize TreeSitter before testing extraction
    await initTreeSitter();
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("getIgnores", () => {
    it("should parse .gitignore and include defaults", async () => {
      const ig = await getIgnores(testDir);

      // Defaults
      expect(ig.ignores("node_modules")).toBe(true);
      expect(ig.ignores(".git")).toBe(true);

      // Custom rules
      expect(ig.ignores("ignored_folder/file.js")).toBe(true);
      expect(ig.ignores("test.log")).toBe(true);

      // Non-ignored
      expect(ig.ignores("src/main.js")).toBe(false);
      expect(ig.ignores("index.js")).toBe(false);
    });

    it("should handle missing .gitignore by returning defaults", async () => {
      const emptyDir = path.join(__dirname, "__empty_test_dir__");
      await fs.mkdir(emptyDir, { recursive: true });

      const ig = await getIgnores(emptyDir);
      expect(ig.ignores("node_modules")).toBe(true);
      expect(ig.ignores(".git")).toBe(true);
      expect(ig.ignores("test.log")).toBe(false); // custom rule should be false

      await fs.rm(emptyDir, { recursive: true, force: true });
    });
  });

  describe("extractStructure", () => {
    it("should extract AST structure for JavaScript files", async () => {
      const jsFilePath = path.join(testDir, "sample.js");
      const structure = await extractStructure(jsFilePath);

      expect(structure).not.toBeNull();
      expect(structure.file).toBe(jsFilePath);
      expect(structure.classes).toContain("MyClass");
      expect(structure.functions).toContain("myMethod");
      expect(structure.functions).toContain("myFunction");
      expect(structure.exports).toContain("MyClass");
      expect(structure.exports).toContain("myFunction");
      expect(structure.imports).toContain("'some-lib'");
    });

    it("should extract AST structure for Python files", async () => {
      const pyFilePath = path.join(testDir, "sample.py");
      const structure = await extractStructure(pyFilePath);

      expect(structure).not.toBeNull();
      expect(structure.file).toBe(pyFilePath);
      expect(structure.classes).toContain("PythonClass");
      expect(structure.functions).toContain("py_method");
      expect(structure.functions).toContain("py_function");
      expect(structure.imports).toContain("math");
    });

    it("should extract AST structure for Rust files", async () => {
      const rsFilePath = path.join(testDir, "sample.rs");
      const structure = await extractStructure(rsFilePath);

      expect(structure).not.toBeNull();
      expect(structure.file).toBe(rsFilePath);
      expect(structure.classes).toContain("MyRustStruct");
      expect(structure.functions).toContain("rs_method");
      expect(structure.functions).toContain("rs_function");
    });

    it("should return null for unsupported file extensions", async () => {
      const txtFilePath = path.join(testDir, "unsupported.txt");
      const structure = await extractStructure(txtFilePath);
      expect(structure).toBeNull();
    });

    it("should return null (graceful failure) when parsing a nonexistent file", async () => {
      const nonexistentPath = path.join(testDir, "does-not-exist.js");
      const structure = await extractStructure(nonexistentPath);
      expect(structure).toBeNull();
    });
  });
});
