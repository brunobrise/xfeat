# 🔍 Code Features Extractor

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)

**Code Features Extractor** is an automated, AI-driven CLI engine that deeply analyzes your codebase to extract product-level features, component architectures, and global system scopes. By combining precise AST-based structural parsing (via `web-tree-sitter`) with the reasoning capabilities of Anthropic's Claude 3.7 Sonnet, this tool auto-generates comprehensive, human-readable documentation of what your code *actually* does.

## 🌟 Key Features

- **AST-Powered Parsing:** Fast and accurate structural footprint generation (classes, functions, exports, imports) for modern ecosystem languages. 
- **Agentic Source Code Reading:** Rather than guessing based off function identifiers, the AI utilizes a specialized `view_file` tool to selectively dive into the raw source code wherever AST context is insufficient.
- **Automated Mermaid Diagrams:** Visually maps out how files interact at macro and global architecture levels.
- **Structured Markdown Deliverables:** Produces a neat, hierarchical `FEATURES.md` report encompassing everything from the executive summary to granular file logic.
- **Smart Directory Traversal:** Adheres to your local `.gitignore` rules to avoid processing build artifacts and generic dependencies.

## 🏗 How It Works

The engine executes in an expanding 3-stage pipeline:

1. **Micro Analysis (File-Level):** 
   - Identifies granular structural signatures across source files.
   - Leverages an LLM sub-agent loop to request file contents as needed.
   - Outputs 1-2 sentence overviews alongside high-level feature bullet points for each file.

2. **Macro Analysis (Component-Level):** 
   - Groups files logically by their enclosing directory.
   - Synthesizes isolated file summaries into a curated **Component Summary**.
   - Generates localized [Mermaid.js](https://mermaid.js.org/) flow/architecture diagrams per directory.

3. **Global Analysis (System-Level):**
   - Ties localized component summaries together into a master architecture overview.
   - Documents the core pillars and overarching domain of the application.
   - Renders a highly-abstracted global Mermaid architecture diagram representing the entire system interaction.

## 📦 Installation

Ensure you have [Node.js](https://nodejs.org/) installed, then clone the repository and install dependencies:

```bash
git clone https://github.com/brunobrise/code-features-extract.git
cd code-features-extract
npm install
```

## ⚙️ Configuration

Create a `.env` file at the root of the project to define your API authorization:

```env
# Required: Your Anthropic API Key
ANTHROPIC_API_KEY="sk-ant-..."

# Optional Environment Overrides
ANTHROPIC_AUTH_TOKEN=""
ANTHROPIC_BASE_URL=""
CLAUDE_CODE_SUBAGENT_MODEL="claude-3-7-sonnet-20250219"
```

## 🚀 Usage

You can scan the immediate working directory, or pass a relative/absolute path to dynamically scan another repository on your machine.

### Scan Current Directory
```bash
npm start
```

### Scan Remote Directory Path
```bash
node index.js /path/to/your/custom/project
```

### Development Tooling
For developers contributing to this tool, standard npm scripts are available:
- `npm run dev` — Hot-reloads the analysis script using Nodemon.
- `npm run lint` — Analyzes the source using ESLint against best practices.
- `npm run format` — Standardizes code styling uniformly with Prettier.

## 📂 Expected Output

The script concludes by generating a structured `FEATURES.md` record at your execution root. Inside, you can expect:
1. **Global Architecture Overview** *(Executive Summary, Application Pillars, Main System Diagram)*
2. **Component Breakdown** *(Directory-by-Directory Insights, Narrow Context Diagrams)*
3. **File-Level Details** *(Deeply granular feature lists)*

## 🌐 Supported Languages
The foundational Tree-sitter AST parser natively understands:
- JavaScript (`.js`, `.jsx`)
- TypeScript (`.ts`, `.tsx`)
- Python (`.py`)

## 📄 License
This tooling is open-sourced under the **ISC** License.

---
*Built organically with the [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) and [Tree-sitter](https://tree-sitter.github.io/tree-sitter/).*
