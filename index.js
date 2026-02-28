const fs = require('fs/promises');
const path = require('path');
const fg = require('fast-glob');
const ignore = require('ignore');
const babel = require('@babel/parser');
const traverse = require('@babel/traverse').default;
require('dotenv').config();
const { Anthropic } = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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

// 1. Structural Extraction (AST Parsing for JS/TS)
async function extractStructure(filePath) {
  try {
    const code = await fs.readFile(filePath, 'utf8');
    
    // Parse the code using Babel
    const ast = babel.parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript", "decorators-legacy", "exportDefaultFrom"],
      filename: filePath
    });

    const structure = {
      file: filePath,
      classes: [],
      functions: [],
      exports: [],
      imports: []
    };

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

// 2. Semantic Analysis (Claude SDK)
async function extractFeaturesWithClaude(structuralData) {
  const prompt = `
  You are an expert software architect. Analyze the structural footprint of the following codebase module to determine the product-level features it provides.

  Extract features based on patterns. Example: If you see classes like 'UserController' and functions like 'login' or 'register', output a feature like "- **User Authentication**: Login/Registration".
  
  Format your response as a clean Markdown list of high-level features. Do not include introductory text, just the bullet points.

  Structural Data:
  ${JSON.stringify(structuralData, null, 2)}
  `;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 1000,
      temperature: 0.2,
      system: "You are a technical analyst whose only job is to extract human-readable product features from codebase structural footprints. Output ONLY a markdown list of features, no conversational filler.",
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].text;
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

  // Find all JS/TS/JSX/TSX files
  const allFiles = await fg(['**/*.{js,jsx,ts,tsx}'], { 
    cwd: targetDir, 
    absolute: true,
    dot: true
  });

  // Filter based on ignore rules
  const targetFiles = allFiles.filter(f => !ig.ignores(path.relative(targetDir, f)));
  
  console.log(`Found ${targetFiles.length} JavaScript/TypeScript files to parse.`);

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
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\n❌ ERROR: ANTHROPIC_API_KEY environment variable is missing.");
    console.log("Please create a .env file with your Anthropic key to run the semantic extraction step.");
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
      const featuresMd = await extractFeaturesWithClaude(data);
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
