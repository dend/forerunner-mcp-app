# Forerunner — Halo Infinite Stat Tracker MCP App

A Model Context Protocol (MCP) app that displays your last Halo Infinite match stats and career progression in a rich React UI. Built with [@dendotdev/grunt](https://gruntapi.com) for Halo Infinite API access and [@dendotdev/conch](https://github.com/dend/conch) for Xbox Live authentication.

## Prerequisites

- **Node.js** 18+
- **An Azure Entra (Azure AD) application** — this is required for Xbox Live OAuth

### Creating an Azure Entra Application

1. Go to the [Azure Portal — App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Set a name (e.g., "Forerunner")
4. Under **Supported account types**, select **Personal Microsoft accounts only**
5. Under **Redirect URI**, select **Mobile and desktop applications** and enter:
   ```
   http://localhost:8787/callback
   ```
6. Click **Register**
7. Copy the **Application (client) ID** — you'll need this next

No client secret is needed. This is a public client application.

## Setup

```sh
# Install dependencies
npm install

# Copy the example config and fill in your client ID
cp config.example.json config.json
```

Edit `config.json` with your Azure Entra application client ID:

```json
{
  "clientId": "your-client-id-here",
  "redirectUri": "http://localhost:8787/callback"
}
```

## Build

```sh
npm run build
```

## Usage with Claude Desktop

Add this to your Claude Desktop MCP server configuration:

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

### Tools

**`halo-authenticate`** — Authenticates with Xbox Live and Halo Infinite. On first run, it opens a browser sign-in flow. Tokens are encrypted and stored locally in `tokens.bin`, so subsequent runs reuse or refresh them automatically.

**`halo-stats`** — Fetches your last match stats and career progression, displayed in a two-tab React dashboard:

- **Last Match** — Outcome, map, mode, K/D/A, accuracy, damage, medals
- **Career** — Current rank, XP progress, overall progress to Hero, rank tier ladder

Call `halo-authenticate` first, then `halo-stats`.

## Development

```sh
# Run Vite watch + server concurrently
npm run dev

# Or run the server directly
npm run serve
```

The server starts on `http://localhost:3001/mcp` by default (HTTP transport). Use `--stdio` for stdio transport.

## How It Works

```
Host calls tool -> Server fetches Halo data -> Returns JSON -> React UI renders dashboard
```

1. `halo-authenticate` handles the Xbox Live OAuth flow (via `@dendotdev/conch`) and exchanges tokens up to a Halo Infinite Spartan token (via `@dendotdev/grunt`)
2. `halo-stats` uses the authenticated client to fetch match history, match stats, career rank, rank definitions, and medal metadata in parallel
3. The React UI receives the tool result and renders it in a two-tab dashboard

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
