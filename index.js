const fs = require("fs/promises");
const path = require("path");
const fg = require("fast-glob");
const ignore = require("ignore");
const { Parser, Language } = require("web-tree-sitter");
require("dotenv").config({ path: path.join(__dirname, ".env") });
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
    "node_modules",
    ".git",
    "dist",
    "build",
    "*.min.js",
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

// Language Registry matches extensions to node modules (user can simply `npm install` to add AST support)
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
  ".cpp": "tree-sitter-cpp/tree-sitter-cpp.wasm",
  ".rb": "tree-sitter-ruby/tree-sitter-ruby.wasm",
  ".php": "tree-sitter-php/tree-sitter-php.wasm",
  ".cs": "tree-sitter-c-sharp/tree-sitter-c-sharp.wasm",
  ".swift": "tree-sitter-swift/tree-sitter-swift.wasm",
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
  require("dotenv").config({ path: path.join(__dirname, ".env") });

  await initTreeSitter();
  const targetDir = process.argv[2] || process.cwd();
  console.log(`Scanning repository: ${targetDir}`);

  // Allow custom extensions via CLI: --exts=.go,.ts,.py
  let extensionsFilter = [
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
  ];
  const extArg = process.argv.find((arg) => arg.startsWith("--exts="));
  if (extArg) {
    extensionsFilter = extArg
      .split("=")[1]
      .split(",")
      .map((e) => e.replace(".", ""));
  }

  // Get ignore rules
  const ig = await getIgnores(targetDir);

  // Find all supported files
  const globPattern = `**/*.{${extensionsFilter.join(",")}}`;
  const allFiles = await fg([globPattern], {
    cwd: targetDir,
    absolute: true,
    dot: true,
  });

  // Filter based on ignore rules
  const targetFiles = allFiles.filter(
    (f) => !ig.ignores(path.relative(targetDir, f)),
  );

  console.log(`Found ${targetFiles.length} source files to analyze.`);

  if (targetFiles.length === 0) {
    console.log("No valid files found to analyze.");
    return;
  }

  // 1. Extract structural data
  const structuralData = [];
  for (const file of targetFiles) {
    // Only analyze files from the codebase (skip our own index.js if running locally)
    if (file.endsWith("index.js") && __dirname === targetDir) continue;

    console.log(`Analyzing file structure: ${file}...`);
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
      // Graceful Fallback for missing AST or empty extractions (LLM must read whole file)
      structuralData.push({
        path: path.relative(targetDir, file),
        classes: [],
        functions: [],
        exports: [],
        imports: [],
        note: "AST parsing unavailable. You MUST use view_file to extract features.",
      });
    }
  }

  if (structuralData.length === 0) {
    console.log("No valid structural data found.");
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

  // --- PIPELINE EXECUTION ---

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error(
      "\n❌ ERROR: Missing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN environment variable.",
    );
    return;
  }

  const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT || "5", 10);

  console.log(`\n--- STAGE 1: Micro Analysis (File Level) ---`);
  console.log(`Using concurrency limit: ${CONCURRENCY_LIMIT}`);

  const fileAnalysesRaw = await pMap(
    structuralData,
    async (data) => {
      // Check cache first
      if (cache.fileAnalyses[data.path]) {
        console.log(`[File] Skipping ${data.path} (Already in cache)`);
        return cache.fileAnalyses[data.path];
      }

      console.log(`[File] Analyzing ${data.path}...`);
      try {
        const featuresMd = await extractFeaturesWithClaude(data, targetDir);
        const result = {
          path: data.path,
          dir: path.dirname(data.path),
          features: featuresMd,
        };

        // Save to cache immediately
        cache.fileAnalyses[data.path] = result;
        await saveCache();

        return result;
      } catch (e) {
        console.error(`Failed to analyze ${data.path}`, e);
        return null;
      }
    },
    CONCURRENCY_LIMIT,
  );

  const fileAnalyses = fileAnalysesRaw.filter(Boolean);

  console.log(`\n--- STAGE 2: Macro Analysis (Component Level) ---`);
  // Group files by directory
  const directories = {};
  for (const file of fileAnalyses) {
    if (!directories[file.dir]) directories[file.dir] = [];
    directories[file.dir].push(file);
  }

  const componentSummaries = {};
  const dirEntries = Object.entries(directories);

  await pMap(
    dirEntries,
    async ([dir, files]) => {
      // Check cache first
      if (cache.componentSummaries[dir]) {
        console.log(`[Component] Skipping ${dir} (Already in cache)`);
        componentSummaries[dir] = cache.componentSummaries[dir];
        return;
      }

      console.log(`[Component] Synthesizing ${dir} (${files.length} files)...`);
      try {
        const summary = await extractComponentSummary(dir, files);
        componentSummaries[dir] = summary;

        // Save to cache immediately
        cache.componentSummaries[dir] = summary;
        await saveCache();
      } catch (e) {
        console.error(`Failed to synthesize component ${dir}`, e);
      }
    },
    CONCURRENCY_LIMIT,
  );

  console.log(`\n--- STAGE 3: Global Architecture Mapping ---`);
  let globalArchitecture = cache.globalArchitecture;
  if (globalArchitecture) {
    console.log(`[Global] Skipping global architecture (Already in cache)`);
  } else {
    console.log(`[Global] Synthesizing final architecture...`);
    globalArchitecture = await extractGlobalArchitecture(componentSummaries);
    cache.globalArchitecture = globalArchitecture;
    await saveCache();
  }

  // --- FINAL ASSEMBLY ---
  console.log(`\nWriting final report to ${outputPath}...`);

  let finalDocument = `# Codebase Architecture & Feature Map\n\n`;
  finalDocument += `${globalArchitecture}\n\n`;
  finalDocument += `---\n\n## Component Breakdown\n\n`;

  for (const [dir, summary] of Object.entries(componentSummaries)) {
    finalDocument += `### Directory: \`${dir}\`\n${summary}\n\n`;
  }

  finalDocument += `---\n\n## File-Level Details\n\n`;
  for (const file of fileAnalyses) {
    finalDocument += `#### \`${file.path}\`\n${file.features}\n\n`;
  }

  await fs.writeFile(outputPath, finalDocument, "utf8");
  console.log(`\n✅ Codebase mapping complete! Saved to ${outputPath}`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  getIgnores,
  initTreeSitter,
  extractStructure,
  extractFeaturesWithClaude,
  extractComponentSummary,
  extractGlobalArchitecture,
  main,
};
