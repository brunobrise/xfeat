#!/usr/bin/env node
const fs = require("fs/promises");
const path = require("path");
const fg = require("fast-glob");
const ignore = require("ignore");
const { Parser, Language } = require("web-tree-sitter");
const { Listr } = require("listr2");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });
const { Anthropic } = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
  authToken: process.env.ANTHROPIC_AUTH_TOKEN || "",
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  maxRetries: 5, // built-in exponential backoff for limits
});

// Helper: Read and parse .gitignore
async function getIgnores(targetDir) {
  const ig = ignore().add([
    "node_modules/",
    "bower_components/",
    "vendor/",
    "venv/",
    ".venv/",
    "env/",
    "__pycache__/",
    ".tox/",
    "target/",
    "packages/",
    ".gradle/",
    ".git/",
    "dist/",
    "build/",
    "out/",
    "*.min.js",
    "android/",
    "ios/",
    ".next/",
    "nextjs/",
    "coverage/",
    "tmp/",
    "temp/",
    ".expo/",
  ]);
  try {
    const gitignoreContent = await fs.readFile(
      path.join(targetDir, ".gitignore"),
      "utf8",
    );
    ig.add(gitignoreContent);
  } catch (err) {
    // No .gitignore found, proceed with defaults
  }
  return ig;
}

let parser;

const languageRegistry = {
  ".js": "tree-sitter-javascript/tree-sitter-javascript.wasm",
  ".jsx": "tree-sitter-javascript/tree-sitter-javascript.wasm",
  ".ts": "tree-sitter-typescript/tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-typescript/tree-sitter-typescript.wasm",
  ".py": "tree-sitter-python/tree-sitter-python.wasm",
  ".go": "tree-sitter-go/tree-sitter-go.wasm",
  ".rs": "tree-sitter-rust/tree-sitter-rust.wasm",
  ".java": "tree-sitter-java/tree-sitter-java.wasm",
  ".c": "tree-sitter-c/tree-sitter-c.wasm",
  ".h": "tree-sitter-c/tree-sitter-c.wasm",
  ".cpp": "tree-sitter-cpp/tree-sitter-cpp.wasm",
  ".hpp": "tree-sitter-cpp/tree-sitter-cpp.wasm",
  ".rb": "tree-sitter-ruby/tree-sitter-ruby.wasm",
  ".php": "tree-sitter-php/tree-sitter-php.wasm",
  ".cs": "tree-sitter-c-sharp/tree-sitter-c-sharp.wasm",
  ".swift": "tree-sitter-swift/tree-sitter-swift.wasm",
  ".sh": "tree-sitter-bash/tree-sitter-bash.wasm",
  ".bash": "tree-sitter-bash/tree-sitter-bash.wasm",
  ".json": "tree-sitter-json/tree-sitter-json.wasm",
  ".yaml": "tree-sitter-yaml/tree-sitter-yaml.wasm",
  ".yml": "tree-sitter-yaml/tree-sitter-yaml.wasm",
  ".toml": "tree-sitter-toml/tree-sitter-toml.wasm",
  ".html": "tree-sitter-html/tree-sitter-html.wasm",
  ".css": "tree-sitter-css/tree-sitter-css.wasm",
  ".sql": "tree-sitter-sql/tree-sitter-sql.wasm",
};

const loadedLanguages = {};

async function initTreeSitter() {
  await Parser.init();
  parser = new Parser();
}

async function getLanguageForExtension(ext) {
  if (loadedLanguages[ext]) return loadedLanguages[ext];
  if (!languageRegistry[ext]) return null;

  try {
    const wasmPath = require.resolve(languageRegistry[ext]);
    const lang = await Language.load(wasmPath);
    loadedLanguages[ext] = lang;
    return lang;
  } catch (err) {
    // If the node module isn't installed, fail gracefully to LLM reading.
    return null;
  }
}

// Helper: Concurrency mapping
async function pMap(array, mapper, concurrency = 5) {
  const results = new Array(array.length);
  let currentIndex = 0;
  const worker = async () => {
    while (currentIndex < array.length) {
      const index = currentIndex++;
      results[index] = await mapper(array[index], index);
    }
  };
  const workers = Array.from(
    { length: Math.min(concurrency, array.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// 1. Structural Extraction (Tree-sitter)
async function extractStructure(filePath) {
  try {
    const code = await fs.readFile(filePath, "utf8");
    const ext = path.extname(filePath);

    const lang = await getLanguageForExtension(ext);
    if (!lang) {
      // Fallback: No AST parser available, LLM will must read the entire file
      return null;
    }

    parser.setLanguage(lang);

    const structure = {
      file: filePath,
      classes: [],
      functions: [],
      exports: [],
      imports: [],
    };

    const tree = parser.parse(code);

    function traverseNode(node) {
      const type = node.type.toLowerCase();

      const isClass =
        type.includes("class") ||
        type.includes("struct") ||
        type.includes("interface");
      const isFunction =
        type.includes("function") ||
        type.includes("method") ||
        type.includes("def_") ||
        type === "func_literal";
      const isExport = type.includes("export");
      const isImport =
        type.includes("import") ||
        type.includes("use_") ||
        type.includes("include");

      if (isClass) {
        const nameNode =
          node.childForFieldName("name") ||
          node.children.find((c) => c.type === "identifier");
        if (nameNode) structure.classes.push(nameNode.text);
      }

      if (isFunction) {
        const nameNode =
          node.childForFieldName("name") ||
          node.children.find((c) => c.type === "identifier");
        if (nameNode && !nameNode.text.startsWith("__")) {
          structure.functions.push(nameNode.text);
        }
      }

      if (isExport) {
        const decl = node.childForFieldName("declaration");
        if (decl && decl.childForFieldName("name")) {
          structure.exports.push(decl.childForFieldName("name").text);
        } else {
          const id = node.children.find((c) => c.type === "identifier");
          if (id) structure.exports.push(id.text);
        }
      }

      if (isImport) {
        const source =
          node.childForFieldName("source") ||
          node.childForFieldName("module_name");
        if (source) {
          structure.imports.push(source.text);
        } else {
          const stringNode = node.children.find((c) =>
            c.type.includes("string"),
          );
          if (stringNode) structure.imports.push(stringNode.text);
        }
      }

      for (const child of node.namedChildren) {
        traverseNode(child);
      }
    }

    traverseNode(tree.rootNode);

    structure.classes = [...new Set(structure.classes)];
    structure.functions = [...new Set(structure.functions)];
    structure.exports = [...new Set(structure.exports)];
    structure.imports = [...new Set(structure.imports)];

    return structure;
  } catch (err) {
    console.error(`Error parsing ${filePath}:`, err.message);
    return null;
  }
}

// --- LLM Stages ---

// Stage 0: AI File Pre-filtering
async function prefilterFilesWithClaude(filePaths, targetDir) {
  const CHUNK_SIZE = 1000;
  const chunks = [];
  for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
    chunks.push({
      index: Math.floor(i / CHUNK_SIZE),
      files: filePaths.slice(i, i + CHUNK_SIZE),
    });
  }

  const modelToUse =
    process.env.CLAUDE_CODE_SUBAGENT_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    "claude-3-7-sonnet-20250219";

  const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT || "5", 10);

  const chunkResults = await pMap(
    chunks,
    async (chunk) => {
      const relativePaths = chunk.files.map((f) => path.relative(targetDir, f));

      const prompt = `
      You are an expert software architect. You are given a list of file paths from a codebase.
      Your task is to filter this list by identifying and EXCLUDING any boilerplate, trivial configuration, auto-generated files, lock files, empty files, non-functional UI assets, or generic/non-core test files that would not contribute meaningfully to a high-level architectural summary of the core system.
      
      Return ONLY a raw JSON array of strings containing the file paths that should be KEPT. 
      Do not include any explanations, markdown formatting, or backticks. Just the raw JSON array.
      
      File paths (Chunk ${chunk.index + 1} of ${chunks.length}):
      ${JSON.stringify(relativePaths, null, 2)}
      `;

      let attempt = 0;
      const explicitMaxRetries = 2;
      let chunkKeptFiles = chunk.files; // Default to keeping all if it fails

      while (attempt <= explicitMaxRetries) {
        try {
          const response = await anthropic.messages.create({
            model: modelToUse,
            max_tokens: 8000,
            temperature: 0.1,
            system:
              "You are a technical analyst. You must return ONLY a raw JSON array of strings (file paths to retain). No markdown formatting.",
            messages: [{ role: "user", content: prompt }],
          });

          let text =
            response.content.find((c) => c.type === "text")?.text || "[]";
          text = text
            .replace(/^\s*```(json)?/i, "")
            .replace(/```\s*$/i, "")
            .trim();

          const keptFilesRelative = JSON.parse(text);
          if (!Array.isArray(keptFilesRelative)) {
            throw new Error("AI did not return an array.");
          }

          const keptFilesAbsolute = keptFilesRelative.map((p) =>
            path.resolve(targetDir, p),
          );
          chunkKeptFiles = chunk.files.filter((f) =>
            keptFilesAbsolute.includes(path.resolve(f)),
          );
          break;
        } catch (err) {
          if (err.status === 429 && attempt < explicitMaxRetries) {
            attempt++;
            const delay = Math.min(
              Math.pow(2, attempt) * 2000 + Math.random() * 1000,
              30000,
            );
            console.warn(
              `\n⚠️  [AI Pre-filtering] API Rate Limit hit (429). Retrying in ${Math.round(delay / 1000)}s... (Attempt ${attempt}/${explicitMaxRetries})`,
            );
            await new Promise((res) => setTimeout(res, delay));
          } else if (
            attempt < explicitMaxRetries &&
            err.name === "SyntaxError"
          ) {
            attempt++;
          } else {
            console.warn(
              `\n⚠️  AI filtering failed for chunk ${chunk.index + 1}, falling back to all files in chunk.`,
              err.message,
            );
            break;
          }
        }
      }
      return chunkKeptFiles;
    },
    CONCURRENCY_LIMIT,
  );

  let allKeptFiles = [];
  for (const res of chunkResults) {
    allKeptFiles = allKeptFiles.concat(res);
  }
  return allKeptFiles;
}

// Stage 1: File-Level (Micro)
async function extractFeaturesWithClaude(structuralData, targetDir) {
  const fullPath = path.join(targetDir, structuralData.path);
  const prompt = `
  You are an expert software architect. Analyze the provided codebase module and determine its exhaustive product-level features.

  You are provided with the structural footprint (classes, functions, exports). 
  CRITICAL INSTRUCTION: You are an agent equipped with a 'view_file' tool. If the structural data is not enough to confidently extract EXHAUSTIVE, detailed features, you MUST call the 'view_file' tool to read the raw source code of the file. Do not guess.
  
  Format your final response using the following structure:
  1. A brief 1-2 sentence overview of what this module does.
  2. A clean Markdown list of high-level features (use bullet points).

  Structural Data:
  ${JSON.stringify(structuralData, null, 2)}
  `;

  const tools = [
    {
      name: "view_file",
      description: "Reads the raw content of the file being analyzed.",
      input_schema: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
  ];

  let messages = [{ role: "user", content: prompt }];

  const modelToUse =
    process.env.CLAUDE_CODE_SUBAGENT_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    "claude-3-7-sonnet-20250219";

  try {
    for (let turns = 0; turns < 5; turns++) {
      let response;
      let attempt = 0;
      const explicitMaxRetries = 3;
      while (attempt <= explicitMaxRetries) {
        try {
          response = await anthropic.messages.create({
            model: modelToUse,
            max_tokens: 1500,
            temperature: 0.2,
            system:
              "You are a technical analyst extracting product features. Use your tools to read code if the structure isn't descriptive enough. Output ONLY the overview and markdown list of features.",
            messages: messages,
            tools: tools,
          });
          break;
        } catch (err) {
          if (err.status === 429 && attempt < explicitMaxRetries) {
            attempt++;
            const delay = Math.min(
              Math.pow(2, attempt) * 2000 + Math.random() * 1000,
              30000,
            );
            console.warn(
              `\n⚠️  [File: ${structuralData.path}] API Rate Limit hit (429). Retrying in ${Math.round(delay / 1000)}s... (Attempt ${attempt}/${explicitMaxRetries})`,
            );
            await new Promise((res) => setTimeout(res, delay));
          } else {
            throw err;
          }
        }
      }

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === "tool_use" && block.name === "view_file") {
            try {
              const content = await fs.readFile(fullPath, "utf8");
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: content,
              });
            } catch (err) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: "Error: " + err.message,
                is_error: true,
              });
            }
          }
        }
        messages.push({ role: "user", content: toolResults });
      } else {
        return response.content.find((c) => c.type === "text")?.text || "";
      }
    }
    return "Error: Agent looped too many times.";
  } catch (err) {
    console.error("Error calling Anthropic API:", err.message);
    throw err;
  }
}

// Stage 2: Component-Level (Macro)
async function extractComponentSummary(dirName, fileSummaries) {
  const prompt = `
  You are an expert software architect. You are looking at a specific directory/component of a codebase: \`${dirName}\`
  
  Below are the granular feature summaries for the individual files inside this directory.
  Your job is to synthesize these file-level details into a high-level **Component Summary**. 

  1. What is the overarching purpose of this component?
  2. What are the core macro-features it provides to the broader system?
  3. Generate a relevant Mermaid.js diagram (e.g., C4 Context, Sequence, or State) showing how the files in this component interact or what flow they represent.
  CRITICAL INSTRUCTION: When creating Mermaid diagrams, you MUST wrap node labels in double quotes if they contain any special characters (like parentheses, brackets, or strange punctuation). For example, use \`NodeID["Text with (parentheses)"]\` instead of \`NodeID[Text with (parentheses)]\`.

  File Summaries:
  ${fileSummaries.map((f) => `### File: ${f.path}\n${f.features}`).join("\n\n")}
  `;

  const modelToUse =
    process.env.CLAUDE_CODE_SUBAGENT_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    "claude-3-7-sonnet-20250219";

  let attempt = 0;
  const explicitMaxRetries = 3;
  while (attempt <= explicitMaxRetries) {
    try {
      const response = await anthropic.messages.create({
        model: modelToUse,
        max_tokens: 2000,
        temperature: 0.2,
        system:
          "You are a Lead Software Architect. Synthesize low-level file features into a cohesive high-level component summary with a Mermaid diagram.",
        messages: [{ role: "user", content: prompt }],
      });
      return response.content[0].text;
    } catch (err) {
      if (err.status === 429 && attempt < explicitMaxRetries) {
        attempt++;
        const delay = Math.min(
          Math.pow(2, attempt) * 2000 + Math.random() * 1000,
          30000,
        );
        console.warn(
          `\n⚠️  [Component: ${dirName}] API Rate Limit hit (429). Retrying in ${Math.round(delay / 1000)}s... (Attempt ${attempt}/${explicitMaxRetries})`,
        );
        await new Promise((res) => setTimeout(res, delay));
      } else {
        throw err;
      }
    }
  }
}

// Stage 3: Global Overview
async function extractGlobalArchitecture(componentSummaries) {
  const prompt = `
    You are an expert software architect. You have analyzed various components of a codebase.
    Synthesize the following component summaries into a **Global Architecture Overview** for the entire repository.
  
    1. Write an Executive Summary of what the entire codebase does.
    2. Outline the major pillars/domains of the application.
    3. Generate a high-level Mermaid.js Architecture Diagram showing how the main components interact.
    CRITICAL INSTRUCTION: When creating Mermaid diagrams, you MUST wrap node labels in double quotes if they contain any special characters (like parentheses, brackets, or strange punctuation). For example, use \`NodeID["Text with (parentheses)"]\` instead of \`NodeID[Text with (parentheses)]\`.
  
    Component Summaries:
    ${Object.entries(componentSummaries)
      .map(([dir, summary]) => `### Component: ${dir}\n${summary}`)
      .join("\n\n")}
    `;

  const modelToUse =
    process.env.CLAUDE_CODE_SUBAGENT_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    "claude-3-7-sonnet-20250219";

  let attempt = 0;
  const explicitMaxRetries = 3;
  while (attempt <= explicitMaxRetries) {
    try {
      const response = await anthropic.messages.create({
        model: modelToUse,
        max_tokens: 2500,
        temperature: 0.2,
        system:
          "You are a Chief Software Architect. Produce a master architecture and feature document based on component analyses.",
        messages: [{ role: "user", content: prompt }],
      });
      return response.content[0].text;
    } catch (err) {
      if (err.status === 429 && attempt < explicitMaxRetries) {
        attempt++;
        const delay = Math.min(
          Math.pow(2, attempt) * 2000 + Math.random() * 1000,
          30000,
        );
        console.warn(
          `\n⚠️  [Global Architecture] API Rate Limit hit (429). Retrying in ${Math.round(delay / 1000)}s... (Attempt ${attempt}/${explicitMaxRetries})`,
        );
        await new Promise((res) => setTimeout(res, delay));
      } else {
        throw err;
      }
    }
  }
}

// Main Runner
async function main() {
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });

  await initTreeSitter();
  const targetDir = process.argv[2] || process.cwd();
  console.log(`Scanning repository: ${targetDir}`);

  // Allow custom extensions via CLI: --exts=.go,.ts,.py
  let extensionsFilter = [
    // Core languages
    "js",
    "jsx",
    "ts",
    "tsx",
    "py",
    "go",
    "rs",
    "java",
    "c",
    "cpp",
    "h",
    "hpp",
    "rb",
    "php",
    "cs",
    "swift",
    "kt",
    "m",

    // Shell & Scripts
    "sh",
    "bash",
    "zsh",
    "bat",
    "ps1",
    "cmd",
    "awk",
    "sed",

    // Web & UI
    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",
    "vue",
    "svelte",
    "astro",
    "twig",
    "ejs",
    "pug",

    // Configuration & Data
    "json",
    "json5",
    "yaml",
    "yml",
    "toml",
    "ini",
    "env",
    "xml",
    "csv",
    "tsv",

    // Data & Query
    "sql",
    "graphql",
    "gql",
    "prisma",

    // Documentation
    "md",
    "mdx",
    "txt",

    // Infrastructure & DevOps
    "tf",
    "tfvars",
    "hcl",
    "bicep",

    // Other popular languages
    "dart",
    "scala",
    "groovy",
    "lua",
    "perl",
    "pl",
    "pm",
    "r",
    "hs",
    "elm",
    "clj",
    "erl",
    "ex",
    "exs",
    "fs",
    "fsi",
    "fsx",
    "vb",
    "vbs",
  ];

  let fileBasenames = [
    "Dockerfile",
    "Makefile",
    "docker-compose.yml",
    "docker-compose.yaml",
    ".gitignore",
    ".dockerignore",
    ".eslintignore",
    ".prettierignore",
  ];

  const extArg = process.argv.find((arg) => arg.startsWith("--exts="));
  if (extArg) {
    extensionsFilter = extArg
      .split("=")[1]
      .split(",")
      .map((e) => e.replace(".", ""));
    fileBasenames = []; // Only use extensions if explicitly provided
  }

  // Get ignore rules
  const ig = await getIgnores(targetDir);

  // Find all supported files
  let allFiles = [];
  if (extArg) {
    const globPattern = `**/*.{${extensionsFilter.join(",")}}`;
    allFiles = await fg([globPattern], {
      cwd: targetDir,
      absolute: true,
      dot: true,
    });
  } else {
    // Generate glob pattern for extensions
    const globPatternExts = `**/*.{${extensionsFilter.join(",")}}`;
    // Generate glob patterns for specific standard filenames
    const filenamePatterns = fileBasenames.map((name) => `**/${name}`);

    allFiles = await fg([globPatternExts, ...filenamePatterns], {
      cwd: targetDir,
      absolute: true,
      dot: true,
    });
  }

  // Filter based on ignore rules
  const targetFiles = allFiles.filter(
    (f) => !ig.ignores(path.relative(targetDir, f)),
  );

  console.log(`Found ${targetFiles.length} source files to analyze.`);

  if (targetFiles.length === 0) {
    console.log("No valid files found to analyze.");
    return;
  }

  // --- CONFIRMATION ENQUIRER ---
  const { Confirm } = require("enquirer");
  const prompt = new Confirm({
    name: "proceed",
    message: `Ready to analyze ${targetFiles.length} files. Should we run AI Pre-filtering (Stage 0) before continuing?`,
  });

  let useAiFilter = false;
  try {
    useAiFilter = await prompt.run();
  } catch (err) {
    console.log("Aborted.");
    return;
  }

  // --- CACHE INITIALIZATION ---
  const folderName = path.basename(path.resolve(targetDir));
  const outputPath = path.join(process.cwd(), `${folderName}-features.md`);
  const cachePath = path.join(
    process.cwd(),
    `.extract-cache-${folderName}.json`,
  );

  const clearCacheArg = process.argv.includes("--clear-cache");
  let cache = {
    fileAnalyses: {},
    componentSummaries: {},
    globalArchitecture: null,
  };

  if (clearCacheArg) {
    console.log("🧹 --clear-cache flag detected. Starting fresh.");
  } else {
    try {
      const cacheData = await fs.readFile(cachePath, "utf8");
      cache = JSON.parse(cacheData);
      console.log(`♻️  Loaded existing cache from ${cachePath}`);
    } catch (e) {
      // If no cache file exists, it will naturally start fresh
    }
  }

  // Helper to save cache atomically
  const saveCache = async () => {
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
  };

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error(
      "\n❌ ERROR: Missing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN environment variable.",
    );
    return;
  }

  const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT || "5", 10);

  const tasks = new Listr(
    [
      {
        title: "STAGE 0: AI File Pre-filtering",
        skip: () => !useAiFilter,
        task: async (ctx, task) => {
          task.output = `Analyzing ${targetFiles.length} files...`;

          if (targetFiles.length === 0) {
            ctx.filteredFiles = [];
            task.title = "STAGE 0: AI File Pre-filtering (No files to filter)";
            return;
          }

          const filtered = await prefilterFilesWithClaude(
            targetFiles,
            targetDir,
          );
          const removedCount = targetFiles.length - filtered.length;

          ctx.filteredFiles = filtered;
          task.title = `STAGE 0: AI File Pre-filtering (Removed ${removedCount} trivial files)`;
        },
      },
      {
        title: "Analyzing File Structure",
        task: async (ctx, task) => {
          const structuralData = [];
          let completed = 0;
          const filesToAnalyze = ctx.filteredFiles || targetFiles;
          const total = filesToAnalyze.length;

          for (const file of filesToAnalyze) {
            if (file.endsWith("index.js") && __dirname === targetDir) {
              completed++;
              continue;
            }

            task.output = `${path.relative(targetDir, file)} (${completed}/${total})`;
            const data = await extractStructure(file);

            if (
              data &&
              (data.classes.length > 0 ||
                data.functions.length > 0 ||
                data.exports.length > 0)
            ) {
              structuralData.push({
                path: path.relative(targetDir, file),
                ...data,
              });
            } else {
              structuralData.push({
                path: path.relative(targetDir, file),
                classes: [],
                functions: [],
                exports: [],
                imports: [],
                note: "AST parsing unavailable. You MUST use view_file to extract features.",
              });
            }
            completed++;
          }

          if (structuralData.length === 0) {
            throw new Error("No valid structural data found.");
          }
          ctx.structuralData = structuralData;
        },
      },
      {
        title: "STAGE 1: Micro Analysis (File Level)",
        task: async (ctx, task) => {
          let completed = 0;
          const total = ctx.structuralData.length;
          task.output = `Completed 0/${total} files`;

          const fileAnalysesRaw = await pMap(
            ctx.structuralData,
            async (data) => {
              if (cache.fileAnalyses[data.path]) {
                completed++;
                task.output = `Completed ${completed}/${total} files`;
                return cache.fileAnalyses[data.path];
              }

              try {
                const featuresMd = await extractFeaturesWithClaude(
                  data,
                  targetDir,
                );
                const result = {
                  path: data.path,
                  dir: path.dirname(data.path),
                  features: featuresMd,
                };

                // Save to cache immediately
                cache.fileAnalyses[data.path] = result;
                await saveCache();

                completed++;
                task.output = `Completed ${completed}/${total} files`;
                return result;
              } catch (e) {
                completed++;
                task.output = `Failed to analyze ${data.path}`;
                return null;
              }
            },
            CONCURRENCY_LIMIT,
          );

          ctx.fileAnalyses = fileAnalysesRaw.filter(Boolean);
        },
      },
      {
        title: "STAGE 2: Macro Analysis (Component Level)",
        task: async (ctx, task) => {
          const directories = {};
          for (const file of ctx.fileAnalyses) {
            if (!directories[file.dir]) directories[file.dir] = [];
            directories[file.dir].push(file);
          }

          const componentSummaries = {};
          const dirEntries = Object.entries(directories);
          let completed = 0;
          const total = dirEntries.length;
          task.output = `Completed 0/${total} components`;

          await pMap(
            dirEntries,
            async ([dir, files]) => {
              if (cache.componentSummaries[dir]) {
                componentSummaries[dir] = cache.componentSummaries[dir];
                completed++;
                task.output = `Completed ${completed}/${total} components`;
                return;
              }

              try {
                const summary = await extractComponentSummary(dir, files);
                componentSummaries[dir] = summary;

                cache.componentSummaries[dir] = summary;
                await saveCache();

                completed++;
                task.output = `Completed ${completed}/${total} components`;
              } catch (e) {
                completed++;
                task.output = `Failed to synthesize component ${dir}`;
              }
            },
            CONCURRENCY_LIMIT,
          );
          ctx.componentSummaries = componentSummaries;
        },
      },
      {
        title: "STAGE 3: Global Architecture Mapping",
        task: async (ctx, task) => {
          let globalArchitecture = cache.globalArchitecture;
          if (!globalArchitecture) {
            globalArchitecture = await extractGlobalArchitecture(
              ctx.componentSummaries,
            );
            cache.globalArchitecture = globalArchitecture;
            await saveCache();
          }
          ctx.globalArchitecture = globalArchitecture;
        },
      },
      {
        title: "Final Assembly",
        task: async (ctx, task) => {
          let finalDocument = `# Codebase Architecture & Feature Map\n\n`;
          finalDocument += `${ctx.globalArchitecture}\n\n`;
          finalDocument += `---\n\n## Component Breakdown\n\n`;

          for (const [dir, summary] of Object.entries(ctx.componentSummaries)) {
            finalDocument += `### Directory: \`${dir}\`\n${summary}\n\n`;
          }

          finalDocument += `---\n\n## File-Level Details\n\n`;
          for (const file of ctx.fileAnalyses) {
            finalDocument += `#### \`${file.path}\`\n${file.features}\n\n`;
          }

          await fs.writeFile(outputPath, finalDocument, "utf8");
          task.title = `Codebase mapping complete! Saved to ${outputPath}`;
        },
      },
    ],
    {
      rendererOptions: {
        collapseSubtasks: false,
      },
    },
  );

  try {
    await tasks.run();
  } catch (err) {
    console.error("An error occurred during execution:", err.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  getIgnores,
  initTreeSitter,
  extractStructure,
  prefilterFilesWithClaude,
  extractFeaturesWithClaude,
  extractComponentSummary,
  extractGlobalArchitecture,
  main,
};
