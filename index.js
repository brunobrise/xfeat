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

// 2. Semantic Analysis (Claude SDK) with Agent Loop
async function extractFeaturesWithClaude(structuralData, targetDir) {
  const fullPath = path.join(targetDir, structuralData.path);
  const prompt = `
  You are an expert software architect. Analyze the provided codebase module and determine all the exhaustive product-level features it provides.

  You are provided with the structural footprint (classes, functions, exports). 
  CRITICAL INSTRUCTION: You are an agent equipped with a 'view_file' tool. If the structural data is not enough to confidently extract EXHAUSTIVE, detailed features, you MUST call the 'view_file' tool to read the raw source code of the file. Do not guess; read the code if needed.
  
  Format your final response using the following structure:
  1. A clean Markdown list of high-level features (use bullet points).
  2. If the module involves complex logic, state changes, or cross-component interactions (like a server, an API, or a process flow), output a relevant **Mermaid.js diagram** (e.g., Sequence Diagram, State Diagram, or C4 Context Diagram) to visualize how the features work. Wrap the diagram in a \`\`\`mermaid block. If the file is just simple helpers or constants, you can skip the diagram.

  Do not include introductory text. Just the bullet points and the optional diagram.

  Structural Data:
  ${JSON.stringify(structuralData, null, 2)}
  `;

  const modelToUse = 
    process.env.CLAUDE_CODE_SUBAGENT_MODEL ||
    process.env.ANTHROPIC_MODEL || 
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ||
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
    'claude-3-7-sonnet-20250219';

  const tools = [
    {
      name: "view_file",
      description: "Reads the raw content of the file being analyzed.",
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why you need to read the file" }
        },
        required: ["reason"]
      }
    }
  ];

  let messages = [{ role: 'user', content: prompt }];

  try {
    for (let turns = 0; turns < 5; turns++) {
      const response = await anthropic.messages.create({
        model: modelToUse,
        max_tokens: 1500,
        temperature: 0.2,
        system: "You are a technical analyst extracting product features. Use your tools to read code if the structure isn't descriptive enough. When done, output ONLY a markdown list of features.",
        messages: messages,
        tools: tools
      });

      if (response.stop_reason === 'tool_use') {
        console.log(`  -> [Agent] Claude requested tool use: view_file`);
        messages.push({ role: 'assistant', content: response.content });
        
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === 'tool_use' && block.name === 'view_file') {
            try {
              const content = await fs.readFile(fullPath, 'utf8');
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: content
              });
            } catch (err) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: "Error reading file: " + err.message,
                is_error: true
              });
            }
          }
        }
        messages.push({ role: 'user', content: toolResults });
      } else {
        return response.content.find(c => c.type === 'text')?.text || '';
      }
    }
    return "Error: Agent looped too many times without returning features.";
  } catch (err) {
    console.error("Error calling Anthropic API:", err.message);
    throw err;
  }
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

  // 2. Extract semantics via Claude
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error("\n❌ ERROR: Missing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN environment variable.");
    console.log("Please create a .env file with your Anthropic credentials to run the semantic extraction step.");
    console.log("\nHere is the Structural Footprint that *would* be sent to Claude:\n");
    console.log(JSON.stringify(structuralData, null, 2));
    return;
  }

  // 3. Process feature by feature and stream to output
  const outputPath = path.join(process.cwd(), 'FEATURES.md');
  await fs.writeFile(outputPath, '# Codebase Features\n\n', 'utf8');
  console.log(`\nInitializing feature extraction... Writing to ${outputPath}`);
  
  for (const data of structuralData) {
    console.log(`[LLM] Extracting features from ${data.path}...`);
    try {
      const featuresMd = await extractFeaturesWithClaude(data, targetDir);
      if (featuresMd && featuresMd.trim().length > 0) {
        let contentToAppend = `## ${data.path}\n${featuresMd}\n\n`;
        await fs.appendFile(outputPath, contentToAppend, 'utf8');
      }
    } catch (e) {
      console.error(`Failed to extract features for ${data.path}`, e);
    }
  }

  console.log(`\n✅ Feature extraction complete! Saved to ${outputPath}`);
}

main().catch(console.error);
