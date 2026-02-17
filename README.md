# Forerunner — Halo Infinite Stat Tracker MCP App

A Model Context Protocol (MCP) app that surfaces your Halo Infinite match stats and career progression. Built with on the [MCP Apps](https://github.com/anthropics/ext-apps) foundation for rich interactive views, [@dendotdev/grunt](https://gruntapi.com) for Halo Infinite API access, and [@dendotdev/conch](https://github.com/dend/conch) for Xbox Live authentication.

## What It Does

Forerunner exposes three MCP tools that an LLM can call:

- **`halo_authenticate`** — Runs the Xbox Live OAuth flow in your browser. Tokens are encrypted and persisted locally (`tokens.bin`), so you only sign in once.
- **`halo_match_stats`** — Fetches your last match: outcome, map, mode, K/D/A, accuracy, damage stats, and earned medals with sprite icons.
- **`halo_career`** — Fetches your career rank progression: current rank with icon, XP progress within the rank, and overall progress toward Hero.

Each stats tool returns a JSON payload that a bundled single-file React app renders as a dark, Halo-styled dashboard with sharp edges, uppercase labels, and difficulty-tinted medal tiles.

## Prerequisites

- **Node.js** 18+
- **An Azure Entra (Azure AD) application** for Xbox Live OAuth

### Creating an Azure Entra Application

1. Go to [Azure Portal — App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Set a name (e.g., "Forerunner")
4. Under **Supported account types**, select **Personal Microsoft accounts only**
5. Under **Redirect URI**, select **Mobile and desktop applications** and enter:
   ```
   http://localhost:8787/callback
   ```
6. Click **Register**
7. Copy the **Application (client) ID**

No client secret is needed — this is a public client application using PKCE.

## Getting Started

```sh
# Clone and install
git clone <repo-url>
cd forerunner-mcp-app
npm install

# Configure your Azure client ID
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "clientId": "your-client-id-here",
  "redirectUri": "http://localhost:8787/callback"
}
```

Build:

```sh
npm run build
```

## Usage with Claude Desktop

Add to your Claude Desktop MCP server configuration:

```json
{
  "mcpServers": {
    "halo-stats": {
      "command": "npx",
      "args": ["tsx", "main.ts", "--stdio"],
      "cwd": "/path/to/forerunner-mcp-app"
    }
  }
}
```

Then ask Claude something like _"Show me my last Halo match"_ or _"What's my career rank?"_. The first time, Claude will call `halo_authenticate` to trigger sign-in, then fetch and display your stats.

## Usage with VS Code

Add to your VS Code settings JSON (`settings.json` or workspace `.vscode/settings.json`):

```json
{
  "mcp": {
    "servers": {
      "halo-stats": {
        "command": "npx",
        "args": ["tsx", "main.ts", "--stdio"],
        "cwd": "/path/to/forerunner-mcp-app"
      }
    }
  }
}
```

## Development

```sh
# Vite watch + server with hot reload
npm run dev

# Or run the server directly
npm run serve
```

The server starts on `http://localhost:3001/mcp` by default (HTTP transport). Use `--stdio` for stdio transport.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
