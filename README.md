# ManageLM — VS Code Extension

Manage your Linux servers directly from VS Code Copilot Chat using natural
language.

ManageLM connects Copilot Chat to your infrastructure through a secure
cloud portal and lightweight agents running on your servers. Ask
`@managelm` to check system status, manage packages, configure services,
run security audits, and more — across one server or an entire fleet.

## Installation

### From the VS Code Marketplace

Search for **ManageLM** in the Extensions panel, or:

```bash
code --install-extension managelm.managelm
```

### From VSIX

Download the `.vsix` from [GitHub Releases](https://github.com/managelm/vscode-extension/releases) and install:

```bash
code --install-extension managelm-1.0.0.vsix
```

## Setup

1. Install the extension
2. Open **Settings** (`Cmd+,` / `Ctrl+,`) and search for **ManageLM**
3. Set your **API Key** (from Portal > Settings > MCP & API)
4. (Optional) If self-hosting, set your **Portal URL**

## Usage

Open Copilot Chat and type `@managelm` followed by your request:

```
@managelm show me all my servers

@managelm check disk usage on web-prod-1

@managelm install nginx on all servers in the staging group

@managelm run a security audit on db-primary

@managelm which servers have CPU above 80%?

@managelm list running services on lb-01

@managelm approve the new server that just enrolled
```

The extension provides 13 tools to Copilot Chat:

| Tool | Description |
|------|-------------|
| **List Servers** | List all agents with status, health, and OS info |
| **Server Details** | Detailed info for a single server |
| **Run Task** | Execute a skill-based task on a server |
| **Task Status** | Check status of a running or completed task |
| **Task History** | Recent tasks for a server |
| **Approve Agent** | Approve a pending agent enrollment |
| **List Skills** | Available skills in your account |
| **Server Skills** | Skills assigned to a specific server |
| **Security Findings** | View security audit results |
| **Server Inventory** | View installed packages, services, containers |
| **Run Security Audit** | Start a security audit |
| **Run Inventory Scan** | Start an inventory scan |
| **Account Info** | Account plan, members, and usage |

## How It Works

```
VS Code Copilot Chat          ManageLM Portal           Agent (on host)
┌──────────────────┐    REST API    ┌──────────────┐    WebSocket    ┌──────────┐
│ @managelm check  │ ──────────► │  Portal API  │ ──────────► │  Agent   │
│ disk on web-01   │              │  /api/tasks  │              │  (LLM)   │
│                  │ ◄────────── │              │ ◄────────── │          │
│ Disk: 41% used   │    Result    └──────────────┘    Result    └──────────┘
└──────────────────┘
```

1. You type a natural language request in Copilot Chat
2. Copilot's LM decides which ManageLM tools to call
3. The extension calls the ManageLM portal REST API
4. The portal dispatches the task to the agent on your server
5. The agent executes it and returns the result
6. Copilot formats and presents the response

## Requirements

- **VS Code 1.99+** with GitHub Copilot Chat
- **ManageLM Portal** — your hosted control plane ([managelm.com](https://www.managelm.com))
- **ManageLM Agent** — installed on each managed Linux server
- **API Key** — from Portal > Settings > MCP & API

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch

# Package as .vsix
npm run package
```

## Links

- [ManageLM Website](https://www.managelm.com)
- [Documentation](https://www.managelm.com/doc/)
- [GitHub](https://github.com/managelm/vscode-extension)

## License

[MIT](LICENSE)
