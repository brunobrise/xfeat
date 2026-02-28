const fs = require('fs/promises');
const path = require('path');
const fg = require('fast-glob');
const ignore = require('ignore');
const traverse = require('@babel/traverse').default;
const babel = require('@babel/parser');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Anthropic } = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
  authToken: process.env.ANTHROPIC_AUTH_TOKEN || "",
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
});

// Helper: Read and parse .gitignore
async function getIgnores(targetDir) {
  const ig = ignore().add(['node_modules', '.git', 'dist', 'build', '*.min.js']);
  try {
    const gitignoreContent = await fs.readFile(path.join(targetDir, '.gitignore'), 'utf8');
    ig.add(gitignoreContent);
  } catch (err) {
    // No .gitignore found, proceed with defaults
  }
  return ig;
}

// 1. Structural Extraction (AST Parsing for JS/TS, Regex for Python)
async function extractStructure(filePath) {
  try {
    const code = await fs.readFile(filePath, 'utf8');
    const ext = path.extname(filePath);

    const structure = {
      file: filePath,
      classes: [],
      functions: [],
      exports: [],
      imports: []
    };

    if (ext === '.py') {
      // Python Regex Heuristics
      const classRegex = /^\s*class\s+([A-Za-z0-9_]+)/gm;
      const defRegex = /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)/gm;
      const importRegex = /^\s*(?:import|from)\s+([A-Za-z0-9_\.]+)/gm;

      let match;
      while ((match = classRegex.exec(code)) !== null) structure.classes.push(match[1]);
      while ((match = defRegex.exec(code)) !== null) {
          // Ignore magic methods like __init__ to keep the list clean
          if (!match[1].startsWith('__')) {
            structure.functions.push(match[1]);
          }
      }
      while ((match = importRegex.exec(code)) !== null) structure.imports.push(match[1]);
      
      return structure;
    }

    // Parse JS/TS code using Babel
    const ast = babel.parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "decorators-legacy", "exportDefaultFrom"],
      filename: filePath
    });


    // Traverse AST to pull out interesting structural bits
    traverse(ast, {
      ClassDeclaration(path) {
        if (path.node.id) {
          structure.classes.push(path.node.id.name);
        }
      },
      FunctionDeclaration(path) {
        if (path.node.id) {
          structure.functions.push(path.node.id.name);
        }
      },
      ExportNamedDeclaration(path) {
        if (path.node.declaration) {
           if (path.node.declaration.declarations) {
               path.node.declaration.declarations.forEach(d => {
                   if (d.id && d.id.name) structure.exports.push(d.id.name);
               });
           } else if (path.node.declaration.id) {
               structure.exports.push(path.node.declaration.id.name);
           }
        }
      },
      ImportDeclaration(path) {
        structure.imports.push(path.node.source.value);
      }
    });

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

  const tools = [{
    name: "view_file",
    description: "Reads the raw content of the file being analyzed.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"]
    }
  }];

  let messages = [{ role: 'user', content: prompt }];

  const modelToUse = process.env.CLAUDE_CODE_SUBAGENT_MODEL || process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';

  try {
    for (let turns = 0; turns < 5; turns++) {
      const response = await anthropic.messages.create({
        model: modelToUse,
        max_tokens: 1500,
        temperature: 0.2,
        system: "You are a technical analyst extracting product features. Use your tools to read code if the structure isn't descriptive enough. Output ONLY the overview and markdown list of features.",
        messages: messages,
        tools: tools
      });

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === 'tool_use' && block.name === 'view_file') {
            try {
              const content = await fs.readFile(fullPath, 'utf8');
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: content });
            } catch (err) {
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "Error: " + err.message, is_error: true });
            }
          }
        }
        messages.push({ role: 'user', content: toolResults });
      } else {
        return response.content.find(c => c.type === 'text')?.text || '';
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
  ${fileSummaries.map(f => `### File: ${f.path}\n${f.features}`).join('\n\n')}
  `;

  const modelToUse = process.env.CLAUDE_CODE_SUBAGENT_MODEL || process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';

  const response = await anthropic.messages.create({
    model: modelToUse,
    max_tokens: 2000,
    temperature: 0.2,
    system: "You are a Lead Software Architect. Synthesize low-level file features into a cohesive high-level component summary with a Mermaid diagram.",
    messages: [{ role: 'user', content: prompt }]
  });

  return response.content[0].text;
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
    ${Object.entries(componentSummaries).map(([dir, summary]) => `### Component: ${dir}\n${summary}`).join('\n\n')}
    `;
  
    const modelToUse = process.env.CLAUDE_CODE_SUBAGENT_MODEL || process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';
  
    const response = await anthropic.messages.create({
      model: modelToUse,
      max_tokens: 2500,
      temperature: 0.2,
      system: "You are a Chief Software Architect. Produce a master architecture and feature document based on component analyses.",
      messages: [{ role: 'user', content: prompt }]
    });
  
    return response.content[0].text;
}

// Main Runner
async function main() {
  const targetDir = process.argv[2] || process.cwd();
  console.log(`Scanning repository: ${targetDir}`);

  // Get ignore rules
  const ig = await getIgnores(targetDir);

  // Find all supported files (JS/TS and Python)
  const allFiles = await fg(['**/*.{js,jsx,ts,tsx,py}'], { 
    cwd: targetDir, 
    absolute: true,
    dot: true
  });

  // Filter based on ignore rules
  const targetFiles = allFiles.filter(f => !ig.ignores(path.relative(targetDir, f)));
  
  console.log(`Found ${targetFiles.length} source files (.js/.ts/.py) to parse.`);

  if (targetFiles.length === 0) {
    console.log("No valid files found to analyze.");
    return;
  }

  // 1. Extract structural data
  const structuralData = [];
  for (const file of targetFiles) {
    // Only analyze files from the codebase (skip our own index.js if running locally)
    if (file.endsWith('index.js') && __dirname === targetDir) continue;

    console.log(`Parsing AST: ${file}...`);
    const data = await extractStructure(file);
    if (data && (data.classes.length > 0 || data.functions.length > 0 || data.exports.length > 0)) {
        structuralData.push({
            // Simplify file path for the LLM prompt
            path: path.relative(targetDir, file),
            ...data
        });
    }
  }

  if (structuralData.length === 0) {
      console.log("No structural data found after AST parsing.");
      return;
  }

  // --- PIPELINE EXECUTION --- 

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error("\n❌ ERROR: Missing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN environment variable.");
    return;
  }

  const outputPath = path.join(process.cwd(), 'FEATURES.md');
  const fileAnalyses = [];

  console.log(`\n--- STAGE 1: Micro Analysis (File Level) ---`);
  for (const data of structuralData) {
    console.log(`[File] Analyzing ${data.path}...`);
    try {
      const featuresMd = await extractFeaturesWithClaude(data, targetDir);
      fileAnalyses.push({
          path: data.path,
          dir: path.dirname(data.path),
          features: featuresMd
      });
    } catch (e) {
      console.error(`Failed to analyze ${data.path}`, e);
    }
  }

  console.log(`\n--- STAGE 2: Macro Analysis (Component Level) ---`);
  // Group files by directory
  const directories = {};
  for (const file of fileAnalyses) {
      if (!directories[file.dir]) directories[file.dir] = [];
      directories[file.dir].push(file);
  }

  const componentSummaries = {};
  for (const [dir, files] of Object.entries(directories)) {
      console.log(`[Component] Synthesizing ${dir} (${files.length} files)...`);
      try {
          const summary = await extractComponentSummary(dir, files);
          componentSummaries[dir] = summary;
      } catch (e) {
          console.error(`Failed to synthesize component ${dir}`, e);
      }
  }

  console.log(`\n--- STAGE 3: Global Architecture Mapping ---`);
  console.log(`[Global] Synthesizing final architecture...`);
  const globalArchitecture = await extractGlobalArchitecture(componentSummaries);

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

  await fs.writeFile(outputPath, finalDocument, 'utf8');
  console.log(`\n✅ Codebase mapping complete! Saved to ${outputPath}`);
}

main().catch(console.error);
