## Git workflow

- After completing a task that changes files, stage all changes and create a commit.
- Use an imperative, descriptive message (max ~72 chars).
- Do not commit if tests fail; fix first.
- Do not ask for confirmations for git commits and push.

## Build & deploy

- `npm run build` compiles TypeScript to `dist/`.
- `npm run package` creates a `.vsix` package for distribution.
- `./package.sh` bumps version, builds, and creates a versioned `.vsix`.
- `./deploy.sh` tags, pushes to origin + GitHub, and creates a GitHub release with the `.vsix` attached.
- Version is read from `package.json`. Bump it before deploying a new release.
- GitHub repo: https://github.com/managelm/vscode-extension

## Extension structure

- `package.json` — VS Code extension manifest (chat participant, settings).
- `src/extension.ts` — Activation entry point, registers participant.
- `src/participant.ts` — `@managelm` Copilot Chat participant with the agentic tool loop.
- `src/tools.ts` — Tool schema definitions (`TOOL_DEFS`).
- `src/executor.ts` — Tool executor: dispatches LM tool calls to the API client.
- `src/api.ts` — ManageLM portal REST API client.
- `icon.png` — Extension icon.

## Coding practices

- Keep the code as clean as possible.
- Tool schemas live in src/tools.ts; the executor calls the API directly (not via vscode.lm.tools).
- All API calls go through src/api.ts with proper error handling.
- Never store API keys in code; they come from VS Code settings.

## Versioning

- Version is in `package.json`. Bump it before deploying a new release.
- No separate changelog file — release notes go in the GitHub release description.
