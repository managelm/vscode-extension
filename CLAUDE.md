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

- `package.json` — VS Code extension manifest (chat participant, LM tools, settings).
- `src/extension.ts` — Activation entry point, registers participant and tools.
- `src/participant.ts` — `@managelm` Copilot Chat participant with agentic tool loop.
- `src/tools.ts` — Language Model tool implementations (list agents, run tasks, etc.).
- `src/api.ts` — ManageLM portal REST API client.
- `icon.png` — Extension icon.

## Coding practices

- Keep the code as clean as possible.
- The extension uses the VS Code Chat and Language Model APIs.
- All API calls go through src/api.ts with proper error handling.
- Action tools (runTask, approve, audit, scan) use prepareInvocation for user confirmation.
- Never store API keys in code; they come from VS Code settings.
