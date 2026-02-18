---
name: create-mcp-app
description: This skill should be used when the user asks to "create an MCP App", "add a UI to an MCP tool", "build an interactive MCP View", "scaffold an MCP App", or needs guidance on MCP Apps SDK patterns, UI-resource registration, MCP App lifecycle, or host integration. Provides comprehensive guidance for building MCP Apps with interactive UIs.
---

# Create MCP App

Build interactive UIs that run inside MCP-enabled hosts like Claude Desktop. An MCP App combines an MCP tool with an HTML resource to display rich, interactive content.

## Core Concept: Tool + Resource

Every MCP App requires two parts linked together:

1. **Tool** - Called by the LLM/host, returns data
2. **Resource** - Serves the bundled HTML UI that displays the data
3. **Link** - The tool's `_meta.ui.resourceUri` references the resource

```
Host calls tool → Server returns result → Host renders resource UI → UI receives result
```

## Quick Start Decision Tree

### Framework Selection

| Framework | SDK Support | Best For |
|-----------|-------------|----------|
| React | `useApp` hook provided | Teams familiar with React |
| Vanilla JS | Manual lifecycle | Simple apps, no build complexity |
| Vue/Svelte/Preact/Solid | Manual lifecycle | Framework preference |

### Project Context

**Adding to existing MCP server:**
- Import `registerAppTool`, `registerAppResource` from SDK
- Add tool registration with `_meta.ui.resourceUri`
- Add resource registration serving bundled HTML

**Creating new MCP server:**
- Set up server with transport (stdio or HTTP)
- Register tools and resources
- Configure build system with `vite-plugin-singlefile`

## Getting Reference Code

Clone the SDK repository for working examples and API documentation:

```bash
git clone --branch "v$(npm view @modelcontextprotocol/ext-apps version)" --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
```

### Framework Templates

Learn and adapt from `/tmp/mcp-ext-apps/examples/basic-server-{framework}/`:

| Template | Key Files |
|----------|-----------|
| `basic-server-vanillajs/` | `server.ts`, `src/mcp-app.ts`, `mcp-app.html` |
| `basic-server-react/` | `server.ts`, `src/mcp-app.tsx` (uses `useApp` hook) |
| `basic-server-vue/` | `server.ts`, `src/App.vue` |
| `basic-server-svelte/` | `server.ts`, `src/App.svelte` |
| `basic-server-preact/` | `server.ts`, `src/mcp-app.tsx` |
| `basic-server-solid/` | `server.ts`, `src/mcp-app.tsx` |

Each template includes:
- Complete `server.ts` with `registerAppTool` and `registerAppResource`
- Client-side app with all lifecycle handlers
- `vite.config.ts` with `vite-plugin-singlefile`
- `package.json` with all required dependencies
- `.gitignore` excluding `node_modules/` and `dist/`

### API Reference (Source Files)

Read JSDoc documentation directly from `/tmp/mcp-ext-apps/src/`:

| File | Contents |
|------|----------|
| `src/app.ts` | `App` class, handlers (`ontoolinput`, `ontoolresult`, `onhostcontextchanged`, `onteardown`), lifecycle |
| `src/server/index.ts` | `registerAppTool`, `registerAppResource`, tool visibility options |
| `src/spec.types.ts` | All type definitions: `McpUiHostContext`, CSS variable keys, display modes |
| `src/styles.ts` | `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` |
| `src/react/useApp.tsx` | `useApp` hook for React apps |
| `src/react/useHostStyles.ts` | `useHostStyles`, `useHostStyleVariables`, `useHostFonts` hooks |

### Advanced Examples

| Example | Pattern Demonstrated |
|---------|---------------------|
| `examples/shadertoy-server/` | **Streaming partial input** + visibility-based pause/play (best practice for large inputs) |
| `examples/wiki-explorer-server/` | `callServerTool` for interactive data fetching |
| `examples/system-monitor-server/` | Polling pattern with interval management |
| `examples/video-resource-server/` | Binary/blob resources |
| `examples/sheet-music-server/` | `ontoolinput` - processing tool args before execution completes |
| `examples/threejs-server/` | `ontoolinputpartial` - streaming/progressive rendering |
| `examples/map-server/` | `updateModelContext` - keeping model informed of UI state |
| `examples/transcript-server/` | `updateModelContext` + `sendMessage` - background context updates + user-initiated messages |
| `examples/basic-host/` | Reference host implementation using `AppBridge` |

## Critical Implementation Notes

### Adding Dependencies

Use `npm install` to add dependencies rather than manually writing version numbers:

```bash
npm install @modelcontextprotocol/ext-apps @modelcontextprotocol/sdk zod
```

This lets npm resolve the latest compatible versions. Never specify version numbers from memory.

### TypeScript Server Execution

Use `tsx` as a devDependency for running TypeScript server files:

```bash
npm install -D tsx
```

```json
"scripts": {
  "serve": "tsx server.ts"
}
```

Note: The SDK examples use `bun` but generated projects should use `tsx` for broader compatibility.

### Handler Registration Order

Register ALL handlers BEFORE calling `app.connect()`:

```typescript
const app = new App({ name: "My App", version: "1.0.0" });

// Register handlers first
app.ontoolinput = (params) => { /* handle input */ };
app.ontoolresult = (result) => { /* handle result */ };
app.onhostcontextchanged = (ctx) => { /* handle context */ };
app.onteardown = async () => { return {}; };

// Then connect
await app.connect();
```

### Tool Visibility

Control who can access tools via `_meta.ui.visibility`:

```typescript
// Default: visible to both model and app
_meta: { ui: { resourceUri, visibility: ["model", "app"] } }

// UI-only (hidden from model) - for refresh buttons, form submissions
_meta: { ui: { resourceUri, visibility: ["app"] } }

// Model-only (app cannot call)
_meta: { ui: { resourceUri, visibility: ["model"] } }
```

### Host Styling Integration

**Vanilla JS** - Use helper functions:
```typescript
import { applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from "@modelcontextprotocol/ext-apps";

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
};
```

**React** - Use hooks:
```typescript
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";

const { app } = useApp({ appInfo, capabilities, onAppCreated });
useHostStyles(app); // Injects CSS variables to document, making var(--*) available
```

**Using variables in CSS** - After applying, use `var()`:
```css
.container {
  background: var(--color-background-secondary);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  border-radius: var(--border-radius-md);
}
.code {
  font-family: var(--font-mono);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  color: var(--color-text-secondary);
}
.heading {
  font-size: var(--font-heading-lg-size);
  font-weight: var(--font-weight-semibold);
}
```

Key variable groups: `--color-background-*`, `--color-text-*`, `--color-border-*`, `--font-sans`, `--font-mono`, `--font-text-*-size`, `--font-heading-*-size`, `--border-radius-*`. See `src/spec.types.ts` for full list.

### Safe Area Handling

Always respect `safeAreaInsets`:

```typescript
app.onhostcontextchanged = (ctx) => {
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
};
```

### Streaming Partial Input

For large tool inputs, use `ontoolinputpartial` to show progress during LLM generation. The partial JSON is healed (always valid), enabling progressive UI updates.

**Spec:** [ui/notifications/tool-input-partial](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#streaming-tool-input)

```typescript
app.ontoolinputpartial = (params) => {
  const args = params.arguments; // Healed partial JSON - always valid, fields appear as generated
  // Use args directly for progressive rendering
};

app.ontoolinput = (params) => {
  // Final complete input - switch from preview to full render
};
```

**Use cases:**
| Pattern | Example |
|---------|---------|
| Code preview | Show streaming code in `<pre>`, render on complete (`examples/shadertoy-server/`) |
| Progressive form | Fill form fields as they stream in |
| Live chart | Add data points to chart as array grows |
| Partial render | Render incomplete structured data (tables, lists, trees) |

**Simple pattern (code preview):**
```typescript
app.ontoolinputpartial = (params) => {
  codePreview.textContent = params.arguments?.code ?? "";
  codePreview.style.display = "block";
  canvas.style.display = "none";
};
app.ontoolinput = (params) => {
  codePreview.style.display = "none";
  canvas.style.display = "block";
  render(params.arguments);
};
```

### Visibility-Based Resource Management

Pause expensive operations (animations, WebGL, polling) when view scrolls out of viewport:

```typescript
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      animation.play(); // or: startPolling(), shaderToy.play()
    } else {
      animation.pause(); // or: stopPolling(), shaderToy.pause()
    }
  });
});
observer.observe(document.querySelector(".main"));
```

### Fullscreen Mode

Request fullscreen via `app.requestDisplayMode()`. Check availability in host context:

```typescript
let currentMode: "inline" | "fullscreen" = "inline";

app.onhostcontextchanged = (ctx) => {
  // Check if fullscreen available
  if (ctx.availableDisplayModes?.includes("fullscreen")) {
    fullscreenBtn.style.display = "block";
  }
  // Track current mode
  if (ctx.displayMode) {
    currentMode = ctx.displayMode;
    container.classList.toggle("fullscreen", currentMode === "fullscreen");
  }
};

async function toggleFullscreen() {
  const newMode = currentMode === "fullscreen" ? "inline" : "fullscreen";
  const result = await app.requestDisplayMode({ mode: newMode });
  currentMode = result.mode;
}
```

**CSS pattern** - Remove border radius in fullscreen:
```css
.main { border-radius: var(--border-radius-lg); overflow: hidden; }
.main.fullscreen { border-radius: 0; }
```

See `examples/shadertoy-server/` for complete implementation.

## Common Mistakes to Avoid

1. **Handlers after connect()** - Register ALL handlers BEFORE calling `app.connect()`
2. **Missing single-file bundling** - Must use `vite-plugin-singlefile`
3. **Forgetting resource registration** - Both tool AND resource must be registered
4. **Missing resourceUri link** - Tool must have `_meta.ui.resourceUri`
5. **Ignoring safe area insets** - Always handle `ctx.safeAreaInsets`
6. **No text fallback** - Always provide `content` array for non-UI hosts
7. **Hardcoded styles** - Use host CSS variables for theme integration
8. **No streaming for large inputs** - Use `ontoolinputpartial` to show progress during generation

## Testing

### Using basic-host

Test MCP Apps locally with the basic-host example:

```bash
# Terminal 1: Build and run your server
npm run build && npm run serve

# Terminal 2: Run basic-host (from cloned repo)
cd /tmp/mcp-ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3001/mcp"]' npm run start
# Open http://localhost:8080
```

Configure `SERVERS` with a JSON array of your server URLs (default: `http://localhost:3001/mcp`).

### Debug with sendLog

Send debug logs to the host application (rather than just the iframe's dev console):

```typescript
await app.sendLog({ level: "info", data: "Debug message" });
await app.sendLog({ level: "error", data: { error: err.message } });
```

## Halo Infinite API Integration Guide

Reference patterns for building MCP Apps that integrate with the Halo Infinite API. Uses `@dendotdev/grunt` (Halo API client) and `@dendotdev/conch` (Xbox Live auth).

### Authentication

**Token chain**: OAuth (Azure Entra) → Xbox User Token → Xbox XSTS Token → Halo XSTS Token → Spartan Token

```typescript
import { XboxAuthenticationClient, hasAccessToken, hasToken, getUserHash } from '@dendotdev/conch';
import { HaloAuthenticationClient, HaloInfiniteClient, isSuccess } from '@dendotdev/grunt';

// 1. OAuth — browser sign-in, capture code via local HTTP callback server
const xboxClient = new XboxAuthenticationClient();
const authUrl = xboxClient.generateAuthUrl(clientId, redirectUri);
// open browser → user signs in → capture auth code from redirect

// 2. Exchange code for tokens
const oauthToken = await xboxClient.requestOAuthToken(clientId, code, redirectUri);
const userToken = await xboxClient.requestUserToken(oauthToken.access_token);
const xboxXstsToken = await xboxClient.requestXstsToken(userToken.Token);

// 3. Extract XUID + build XBL token (needed for People Hub gamertag lookups)
const xuid = xboxXstsToken.DisplayClaims?.xui?.[0]?.xid;
const userHash = getUserHash(xboxXstsToken);
const xblToken = xboxClient.getXboxLiveV3Token(userHash, xboxXstsToken.Token);

// 4. Get Spartan token (for Halo API calls)
const relyingParty = HaloAuthenticationClient.getRelyingParty();
const haloXstsToken = await xboxClient.requestXstsToken(userToken.Token, relyingParty as 'http://xboxlive.com');
const haloAuthClient = new HaloAuthenticationClient();
const spartanTokenResponse = await haloAuthClient.getSpartanToken(haloXstsToken.Token);

// 5. Create client — MUST fetch clearance token for some endpoints to work
let client = new HaloInfiniteClient({ spartanToken: spartanTokenResponse.token, xuid });
const clearanceResult = await client.settings.getActiveClearance('1.13');
if (isSuccess(clearanceResult) && clearanceResult.result.FlightConfigurationId) {
  client = new HaloInfiniteClient({
    spartanToken: spartanTokenResponse.token,
    xuid,
    clearanceToken: clearanceResult.result.FlightConfigurationId,
  });
}
```

**Token refresh**: Use `xboxClient.refreshOAuthToken(clientId, refreshToken, redirectUri)` to get new tokens without re-opening the browser. Spartan tokens last ~1 hour; refresh 5 minutes before expiry.

**Token storage**: Encrypt with AES-256-GCM. Derive key from `hostname() + userInfo().username` via scrypt for machine-bound storage. Store `refreshToken`, `spartanToken`, `spartanTokenExpiry`, `xuid`, and `xblToken`.

### Gamertag → XUID Resolution

To look up another player, resolve their gamertag via Xbox People Hub (requires `xblToken`):

```typescript
async function resolveGamertagToXuid(gamertag: string, xblToken: string): Promise<string> {
  const url = `https://peoplehub.xboxlive.com/users/me/people/search/decoration/detail,preferredColor?q=${encodeURIComponent(gamertag)}&maxItems=25`;
  const res = await fetch(url, {
    headers: {
      'Authorization': xblToken,
      'x-xbl-contract-version': '3',
      'Content-Type': 'application/json',
      'Accept-Language': 'en-us',
    },
  });
  const data = await res.json() as { people?: Array<{ xuid?: string; gamertag?: string }> };
  const match = data.people?.find(p => p.gamertag?.toLowerCase() === gamertag.toLowerCase()) ?? data.people?.[0];
  if (!match?.xuid) throw new Error(`Could not resolve gamertag "${gamertag}"`);
  return match.xuid;
}
```

### grunt Type System

The `@dendotdev/grunt` library exports typed interfaces (`MatchStats`, `MatchHistoryResponse`, `Player`, `CoreStats`, `Medal`, `MedalMetadata`, `PlayerServiceRecord`, `CareerRank`, `RewardTrack`, etc.). The API returns **PascalCase** field names matching these types. Use them directly — no dynamic property access needed.

**All API calls** return `HaloApiResult<T>`. Always check before accessing `.result`:

```typescript
if (isSuccess(result) || isNotModified(result)) {
  const data = result.result; // typed
}
```

**Known type ↔ API mismatches** — two fields where grunt types don't match the actual API:

```typescript
// 1. CoreStats: type says HeadshotKills, API returns Headshots
type ApiCoreStats = CoreStats & { Headshots?: number };
// Access: core?.Headshots ?? core?.HeadshotKills ?? 0

// 2. MedalMetadata: type says SpriteSheet at top level, API nests under Sprites.Small
type ApiMedalMetadata = MedalMetadata & {
  Sprites?: { Small?: { Path?: string; Columns?: number; Size?: number } };
};
// Access: meta?.Sprites?.Small?.Path (NOT meta?.SpriteSheet?.Path)
```

**DisplayString fields** (`RankTitle`, `Medal.Name`, `Medal.Description`): Access value via `.Value`:

```typescript
rankDef.RankTitle?.Value   // → "Captain"
medal.Name?.Value          // → "Double Kill"
```

### Match Stats

**API call chain**:

```typescript
import type { MatchHistoryResponse, MatchStats } from '@dendotdev/grunt';

// 1. Get match history (last N matches)
const historyResult = await client.stats.getMatchHistory(xuid, 0, 1, MatchType.All);
const history = historyResult.result as MatchHistoryResponse;
const matchId = history?.Results?.[0]?.MatchId ?? '';

// 2. Get full match details + medal definitions in parallel
const [matchResult, medalResult] = await Promise.all([
  client.stats.getMatchStats(matchId),
  client.gameCms.getMedalMetadata(),
]);
const match = matchResult.result as MatchStats;
const medalMeta = medalResult.result as ApiMedalMetadata;
```

**Finding the current player** — `PlayerId` is `"xuid(1234567890)"` format, NOT the bare XUID:

```typescript
const me = match.Players?.find(p => p.PlayerId === `xuid(${xuid})`);
// Bots have PlayerId starting with "bid"
```

**Navigating the stats tree**:

```typescript
const core = me?.PlayerTeamStats?.[0]?.Stats?.CoreStats as ApiCoreStats | undefined;
const kills = core?.Kills ?? 0;
const deaths = core?.Deaths ?? 0;
const accuracy = core?.ShotsFired ? Math.round((core.ShotsHit! / core.ShotsFired) * 1000) / 10 : 0;
const earnedMedals = core?.Medals ?? [];
```

**Resolving map/mode/playlist names** — `MatchInfo.MapVariant`, `.UgcGameVariant`, `.Playlist` are `GenericAsset` refs with `AssetId`/`VersionId` but `PublicName` is often empty. Resolve via UGC Discovery:

```typescript
const mapInfo = match.MatchInfo?.MapVariant;
if (mapInfo?.AssetId && mapInfo?.VersionId) {
  const res = await client.ugcDiscovery.getMap(mapInfo.AssetId, mapInfo.VersionId);
  const mapName = res.result?.PublicName ?? 'Unknown Map';
}
// Similarly: client.ugcDiscovery.getUgcGameVariant(assetId, versionId)
// And: client.ugcDiscovery.getPlaylistWithoutVersion(assetId)
```

### Service Record

```typescript
import { LifecycleMode } from '@dendotdev/grunt';
import type { PlayerServiceRecord } from '@dendotdev/grunt';

const result = await client.stats.getPlayerServiceRecordByXuid(xuid, LifecycleMode.Matchmade);
const sr = result.result as PlayerServiceRecord;

// Top-level fields
const matchesCompleted = sr.MatchesCompleted ?? 0;
const wins = sr.Wins ?? 0;
const losses = sr.Losses ?? 0;
const ties = sr.Ties ?? 0;
const timePlayed = sr.TimePlayed ?? ''; // ISO 8601 duration, e.g. "P3DT4H12M"

// Combat stats via CoreStats
const core = sr.CoreStats as ApiCoreStats | undefined;
const kills = core?.Kills ?? 0;
const kda = core?.AverageKDA ?? core?.KDA ?? 0; // AverageKDA for service records, KDA for matches
```

### Career Ranks

**API call chain**:

```typescript
import type { CareerRank, RewardTrack } from '@dendotdev/grunt';

const [rankResult, defsResult] = await Promise.all([
  client.economy.getPlayerCareerRank([xuid], 'careerRank1'),
  client.gameCms.getCareerRanks('careerRank1'),
]);

const rewardTrack: RewardTrack = rankResult.result?.RewardTracks?.[0]?.Result;
const rankDefs: CareerRank[] = defsResult.result?.Ranks ?? []; // 272 rank definitions
```

**Rank indexing** — the API is 0-indexed, rank definitions are 1-based:

```typescript
const rawRank = rewardTrack.CurrentProgress?.Rank ?? 0;    // 0-indexed; 272 = Hero
const partialProgress = rewardTrack.CurrentProgress?.PartialProgress ?? 0; // XP into current rank
const isHero = rawRank === 272;
const currentRank = isHero ? 272 : rawRank + 1;            // convert to 1-based for definition lookup
```

**Rank definition fields**:

```typescript
const rankDef = rankDefs.find(r => r.Rank === currentRank);
rankDef.TierType       // "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond" | "Onyx" | "Hero"
rankDef.RankTitle      // DisplayString — access .Value → "Captain"
rankDef.RankGrade      // tier number (e.g. 3 for "Captain III")
rankDef.XpRequiredForRank
rankDef.RankLargeIcon  // CMS path for rank icon PNG
```

**Title display**: `"{TierType} {RankTitle.Value} {RankGrade}"` (e.g. "Gold Captain 3"), except Hero which is just `"Hero"`.

**Computing progression**:

```typescript
// XP earned to date = sum of XpRequiredForRank for all ranks below current + partial progress
let xpEarnedToDate = partialProgress;
for (const rd of rankDefs) {
  if ((rd.Rank ?? 0) < currentRank) xpEarnedToDate += rd.XpRequiredForRank ?? 0;
}

// Total XP across all 272 ranks
let totalXpRequired = 0;
for (const rd of rankDefs) totalXpRequired += rd.XpRequiredForRank ?? 0;

const rankProgress = xpRequired > 0 ? partialProgress / xpRequired : isHero ? 1 : 0;
const overallProgress = totalXpRequired > 0 ? xpEarnedToDate / totalXpRequired : 0;
```

**Next rank** (for showing upcoming rank in UI):

```typescript
const nextRankDef = isHero ? null : rankDefs.find(r => r.Rank === currentRank + 1);
// nextRankDef has the same fields: TierType, RankTitle, RankGrade, RankLargeIcon, etc.
// XP remaining: (currentRankDef.XpRequiredForRank - partialProgress)
```

**Career impact (delta between two snapshots)** — take a snapshot before and after a match to compute XP earned and whether a rank-up occurred:

```typescript
interface RankSnapshot {
  currentRank: number;
  isHero: boolean;
  tierType: string;
  rankTitle: string;
  rankTier: number;
  partialProgress: number;
  xpRequired: number;
  rankProgress: number;
}
// rankedUp = post.currentRank > pre.currentRank
// xpEarned = (post total XP earned to date) - (pre total XP earned to date)
```

### CMS Images

**Rank icons** — fetch via `gameCms.getImage()`, returns `Uint8Array`. Convert to data URL for embedding in payloads:

```typescript
async function fetchIconAsDataUrl(client, iconPath: string): Promise<string | null> {
  if (!iconPath) return null;
  // Known CMS bug: fix incorrect path for one rank
  if (iconPath === 'career_rank/CelebrationMoment/219_Cadet_Onyx_III.png') {
    iconPath = 'career_rank/CelebrationMoment/19_Cadet_Onyx_III.png';
  }
  const result = await client.gameCms.getImage(iconPath);
  if (isSuccess(result) && result.result) {
    const b64 = Buffer.from(result.result).toString('base64');
    return `data:image/png;base64,${b64}`;
  }
  return null;
}

// Fetch current + next rank icons in parallel
const [currentIcon, nextIcon] = await Promise.all([
  fetchIconAsDataUrl(client, currentRankDef?.RankLargeIcon ?? ''),
  nextRankDef ? fetchIconAsDataUrl(client, nextRankDef.RankLargeIcon ?? '') : null,
]);
```

**Medal sprite sheet** — all medal icons are in a single sprite sheet, not individual images:

```typescript
const meta = medalResult.result as ApiMedalMetadata;
const spritePath = meta?.Sprites?.Small?.Path;
const spriteColumns = meta?.Sprites?.Small?.Columns ?? 16;
const spriteSize = meta?.Sprites?.Small?.Size ?? 72;

// Fetch the sprite sheet binary
const spriteResult = await client.gameCms.getGenericWaypointFile(spritePath);
const b64 = Buffer.from(spriteResult.result).toString('base64');
const dataUrl = `data:image/png;base64,${b64}`;
```

**Rendering a medal sprite in the UI** — use CSS `background-position`:

```typescript
function MedalSprite({ dataUrl, spriteIndex, columns, displaySize }) {
  const col = spriteIndex % columns;
  const row = Math.floor(spriteIndex / columns);
  return (
    <div style={{
      width: displaySize,
      height: displaySize,
      backgroundImage: `url(${dataUrl})`,
      backgroundPosition: `-${col * displaySize}px -${row * displaySize}px`,
      backgroundSize: `${columns * displaySize}px auto`,
      backgroundRepeat: 'no-repeat',
    }} />
  );
}
```

### Medal Enrichment

Earned medals from match stats only have `NameId` and `Count`. Join with medal definitions for names and display info:

```typescript
const medalDefs = meta?.Medals ?? [];
const enriched = earnedMedals.map(m => {
  const def = medalDefs.find(d => d.NameId != null && String(d.NameId) === String(m.NameId));
  return {
    nameId: m.NameId ?? 0,
    count: m.Count ?? 0,
    name: def?.Name?.Value || `Medal ${m.NameId}`,
    description: def?.Description?.Value ?? '',
    difficulty: def?.DifficultyIndex ?? 0,  // 0=Normal, 1=Heroic, 2=Legendary, 3=Mythic
    type: def?.TypeIndex ?? 0,
    spriteIndex: def?.SpriteIndex ?? -1,
  };
});
```

### Multi-Tool Single-Resource Pattern

Multiple tools can share one UI resource. The UI switches views based on which data is present in the payload:

```typescript
// Server: all tools point to the same resourceUri
const resourceUri = 'ui://halo-stats/mcp-app.html';
registerAppTool(server, 'halo_match_stats', { _meta: { ui: { resourceUri } } }, handler);
registerAppTool(server, 'halo_career',      { _meta: { ui: { resourceUri } } }, handler);
registerAppTool(server, 'halo_service_record', { _meta: { ui: { resourceUri } } }, handler);

// Each tool returns a payload with nullable sections
const payload = {
  match: matchData | null,
  player: playerStats | null,
  career: careerProgression | null,
  serviceRecord: serviceRecordData | null,
  spriteSheet: spriteSheetInfo | null,
};

// UI: build tabs from whichever sections are present
const tabs = [];
if (data?.match || data?.player) tabs.push({ id: 'match', label: 'LAST MATCH' });
if (data?.serviceRecord) tabs.push({ id: 'serviceRecord', label: 'SERVICE RECORD' });
if (data?.career && !data?.serviceRecord) tabs.push({ id: 'career', label: 'CAREER' });
```
