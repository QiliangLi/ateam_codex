# Repository Guidelines

## Project Structure & Module Organization
- `docs/`: Project narrative and design lessons.
- CLI utilities:
  - `ai-cli.js`: Unified CLI runner with session, timeout, and retry logic.
  - `run-a2a.js`: A2A routing demo (worklist routing + MCP/prompt injection).
  - `callback-server.js`: HTTP callback server for MCP messages.
  - `cat-cafe-mcp.js`: MCP server used by Claude CLI.
- Helpers:
  - `a2a-mentions.js`, `a2a-registry.js`, `cats.js`, `mcp-prompt.js`
- Minimal demos: `minimal-claude.js`, `minimal-codex.js`, `minimal-gemini.js`
- `test-resume.sh`: Smoke test for resume behavior.

## Build, Test, and Development Commands
- Install dependencies:
  ```bash
  npm install
  ```
- Run A2A demo (requires callback server):
  ```bash
  node callback-server.js
  CAT_CAFE_API_URL=http://localhost:3200 \
  CAT_CAFE_INVOCATION_ID=... \
  CAT_CAFE_CALLBACK_TOKEN=... \
  node run-a2a.js --cats opus,codex,gemini --thread demo "你的问题"
  ```
- Run CLI runner:
  ```bash
  node ai-cli.js claude "你好"
  ```
- Tests: none configured (`npm test` exits with error).

## Coding Style & Naming Conventions
- Language: Node.js (CommonJS). Prefer `const`/`let`, early returns, and small helpers.
- Indentation: 2 spaces.
- File naming: kebab-case for scripts (`run-a2a.js`), simple module names for helpers.

## Testing Guidelines
- No automated tests yet. If adding tests, document the runner and add an `npm test` script.
- For scripts, provide a manual verification step (example command) in PR notes.

## Commit & Pull Request Guidelines
- No strict convention in repo history. Use clear, imperative summaries (e.g., `Add A2A routing demo`).
- PRs should include:
  - Brief description of behavior changes.
  - How to run the demo or reproduce the change.
  - Any new environment variables or dependencies.

## Security & Configuration Tips
- Callback auth uses `CAT_CAFE_INVOCATION_ID` + `CAT_CAFE_CALLBACK_TOKEN`. Treat as secrets.
- Keep CLI credentials in the CLI tools themselves (e.g., `claude`, `codex`, `gemini`).
- Avoid hard-coding tokens in scripts; prefer environment variables.
